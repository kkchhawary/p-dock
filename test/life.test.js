// Udhaar, reminders, log — chat se aaye actions ka test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/model.js';
import { applyActions, undoAction } from '../app/js/actions.js';
import { resolvePlace, remindersNear, distanceKm } from '../app/js/places.js';

globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { _test: cal } = await import('../app/js/calendar.js');

const blank = (o) => ({ type: 'note', text: null, date: null, due_date: null, place: null, person: null, phone: null, relation: null, amount: null, direction: null, ref_id: null, ...o });

test('"Naresh ko 500 udhaar diye, 15 Oct ko dega, number 98290 12345" → udhaar + log', () => {
  const s = M.emptyState();
  const done = applyActions(s, [blank({ type: 'money', direction: 'lent', person: 'Naresh', amount: 500, date: '2026-10-06', due_date: '2026-10-15', phone: '98290 12345', relation: 'dost', text: 'dost ko diye' })]);
  assert.equal(done.length, 1);
  assert.match(done[0].label, /Naresh ko ₹500 udhaar diye · wapsi 2026-10-15/);
  const m = M.liveMoney(s)[0];
  assert.deepEqual([m.person, m.amount, m.direction, m.due_date, m.phone, m.settled], ['Naresh', 500, 'lent', '2026-10-15', '9829012345', false]);
  const p = M.livePeople(s)[0];
  assert.deepEqual([p.name, p.phone, p.relation], ['Naresh', '9829012345', 'dost']);
  assert.deepEqual(M.moneySummary(s).toReceive, 500);
});

test('paise wapas mile → hisaab poora; undo se wapas khula', () => {
  const s = M.emptyState();
  applyActions(s, [blank({ type: 'money', direction: 'lent', person: 'Naresh', amount: 500 })]);
  const id = M.liveMoney(s)[0].id;
  const [settled] = applyActions(s, [blank({ type: 'settle_money', ref_id: `M${id}` })]);
  assert.equal(s.money[id].settled, true);
  assert.equal(M.moneySummary(s).toReceive, 0);
  undoAction(s, settled.undo);
  assert.equal(s.money[id].settled, false);
  // dobara settle karne par doosri baar kuch nahi
  applyActions(s, [blank({ type: 'settle_money', ref_id: `M${id}` })]);
  assert.equal(applyActions(s, [blank({ type: 'settle_money', ref_id: `M${id}` })]).length, 0);
});

test('"Delhi jaaun tab Lal Qila yaad dilana" → jagah wala reminder (AI ke lat/lon bina bhi)', () => {
  const s = M.emptyState();
  applyActions(s, [blank({ type: 'reminder', text: 'Lal Qila ghumna', place: { name: 'Delhi', lat: null, lon: null } })]);
  const r = M.liveReminders(s)[0];
  assert.equal(r.place.name, 'Delhi');
  assert.ok(Math.abs(r.place.lat - 28.61) < 0.1);
  // Connaught Place (Delhi) mein → dikhega; Jaipur mein → nahi
  assert.equal(remindersNear(M.liveReminders(s), { lat: 28.6315, lon: 77.2167 }).length, 1);
  assert.equal(remindersNear(M.liveReminders(s), { lat: 26.9124, lon: 75.7873 }).length, 0);
  assert.ok(distanceKm({ lat: 28.6139, lon: 77.209 }, { lat: 26.9124, lon: 75.7873 }) > 200);
});

test('reminder bina tareekh/jagah → yaad ban jaata hai; galat udhaar ignore', () => {
  const s = M.emptyState();
  const done = applyActions(s, [
    blank({ type: 'reminder', text: 'Mummy ki dawai' }),
    blank({ type: 'money', direction: 'lent', person: 'Ravi', amount: -5 }),
    blank({ type: 'money', direction: 'sideways', person: 'Ravi', amount: 100 }),
    blank({ type: 'hack', text: 'x' }),
  ]);
  assert.equal(done.length, 1);
  assert.equal(M.liveNotes(s)[0].text, 'Mummy ki dawai');
  assert.equal(M.liveMoney(s).length, 0);
});

test('undo se banaya hua reminder/udhaar hat jaata hai', () => {
  const s = M.emptyState();
  const done = applyActions(s, [blank({ type: 'reminder', text: 'Bijli bill bharna', due_date: '2026-10-20' })]);
  undoAction(s, done[0].undo);
  assert.equal(M.liveReminders(s).length, 0);
});

test('aaj/jaldi wale reminders aur udhaar "Dhyaan do" mein', () => {
  const s = M.emptyState();
  applyActions(s, [
    blank({ type: 'reminder', text: 'Aaj', due_date: '2026-10-06' }),
    blank({ type: 'reminder', text: 'Agle mahine', due_date: '2026-11-20' }),
    blank({ type: 'money', direction: 'borrowed', person: 'Bhaiya', amount: 2000, due_date: '2026-10-08' }),
  ]);
  const att = M.attentionItems(s, '2026-10-06');
  assert.deepEqual(att.reminders.map((r) => r.text), ['Aaj']);
  assert.equal(att.money[0].person, 'Bhaiya');
});

test('Google Calendar: expiry all-day, reminder/udhaar subah 9 baje; done/settled hat jaate hain', () => {
  const s = M.emptyState();
  M.putDoc(s, { id: 'd', title: 'DL', expiry_date: '2039-03-14', created_at: M.nowIso() });
  applyActions(s, [blank({ type: 'reminder', text: 'Lal Qila', due_date: '2026-10-20' }), blank({ type: 'money', direction: 'lent', person: 'Naresh', amount: 500, due_date: '2026-10-15' })]);
  const items = cal.calendarItems(s).filter((i) => i.want);
  assert.equal(items.length, 3);
  const doc = cal.eventBody(items.find((i) => i.coll === 'docs'));
  assert.deepEqual(doc.start, { date: '2039-03-14' });
  assert.ok(doc.reminders.overrides.every((o) => o.minutes > 0 && o.minutes <= 40320));
  const money = cal.eventBody(items.find((i) => i.coll === 'money'));
  assert.match(money.summary, /Naresh se ₹500 wapas lene hain/);
  assert.equal(money.start.dateTime, '2026-10-15T09:00:00');
  M.putRecord(s, 'money', { id: M.liveMoney(s)[0].id, settled: true });
  assert.equal(cal.calendarItems(s).find((i) => i.coll === 'money').want, false);
});

test('purana vault (bina reminders/money) bhi chalta hai aur merge hota hai', () => {
  const old = { v: 1, docs: {}, notes: {}, profile: { text: '' }, settings: { owner_name: 'K' }, audit: [] };
  const n = M.normalize(structuredClone(old));
  assert.deepEqual(n.money, {});
  assert.equal(n.settings.location_reminders, false);
  const other = M.emptyState();
  applyActions(other, [blank({ type: 'money', direction: 'lent', person: 'Naresh', amount: 500 })]);
  assert.equal(M.liveMoney(M.normalize(M.merge(n, other))).length, 1);
});

test('place resolve: AI ke coords valid ho to wahi, warna shehar list', () => {
  assert.deepEqual(resolvePlace({ name: 'Lal Qila', lat: 28.6562, lon: 77.241 }), { name: 'Lal Qila', lat: 28.6562, lon: 77.241, radius_km: 25 });
  assert.equal(resolvePlace({ name: 'Jaipur', lat: 0, lon: 0 }).lat, 26.9124);
  assert.equal(resolvePlace({ name: 'Kahin anjaan gaon', lat: null, lon: null }).lat, null);
  assert.equal(resolvePlace(null), null);
});
