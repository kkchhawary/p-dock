// Chat se aaye "actions" ko vault mein lagana: yaad, reminder, udhaar, log (contact).
// Har action ke saath undo ki jaankari lautata hai, taaki UI mein "hatao" ho sake.
import * as M from './model.js';
import { resolvePlace } from './places.js';
import { ingestFacts, FACT_KEYS } from './facts.js';

export const ACTION_TYPES = ['note', 'reminder', 'money', 'person', 'settle_money', 'complete_reminder', 'profile_fact'];

const isoDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const clean = (t, n = 2000) => String(t ?? '').trim().slice(0, n);
const cleanPhone = (p) => {
  const digits = String(p ?? '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? digits.slice(0, 16) : '';
};
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

function upsertPerson(s, name, phone, relation) {
  name = clean(name, 60);
  if (!name) return null;
  const existing = M.findPerson(s, name);
  if (existing && !phone && !relation) return existing;
  return M.putRecord(s, 'people', {
    id: existing?.id || M.newId(),
    name: existing?.name || name,
    phone: cleanPhone(phone) || existing?.phone || '',
    relation: clean(relation, 40) || existing?.relation || '',
  });
}

export function applyActions(s, actions = [], source = { kind: 'chat', id: null, label: 'Chat' }) {
  const done = [];
  for (const a of actions.slice(0, 20)) {
    if (!a || !ACTION_TYPES.includes(a.type)) continue;

    if (a.type === 'note' && clean(a.text)) {
      const n = M.addNote(s, clean(a.text), isoDate(a.date));
      done.push({ label: `🧠 ${n.text}`, undo: { coll: 'notes', id: n.id, op: 'delete' } });
    }

    if (a.type === 'reminder' && clean(a.text)) {
      const place = resolvePlace(a.place);
      const due = isoDate(a.due_date);
      if (!due && !place) {
        // Na tareekh na jagah — kam se kam yaad to rahe
        const n = M.addNote(s, clean(a.text));
        done.push({ label: `🧠 ${n.text}`, undo: { coll: 'notes', id: n.id, op: 'delete' } });
        continue;
      }
      const r = M.putRecord(s, 'reminders', { id: M.newId(), text: clean(a.text, 500), due_date: due, place, done: false });
      const when = [due && `📅 ${due}`, place && `📍 ${place.name}`].filter(Boolean).join(' · ');
      done.push({ label: `⏰ ${r.text} (${when})`, undo: { coll: 'reminders', id: r.id, op: 'delete' } });
      if (a.person) upsertPerson(s, a.person, a.phone, a.relation);
    }

    if (a.type === 'money') {
      const amount = Number(a.amount);
      const direction = a.direction === 'borrowed' ? 'borrowed' : a.direction === 'lent' ? 'lent' : null;
      if (!direction || !(amount > 0) || !clean(a.person)) continue;
      const person = upsertPerson(s, a.person, a.phone, a.relation);
      const m = M.putRecord(s, 'money', {
        id: M.newId(), direction, person: person.name, phone: person.phone, amount,
        date: isoDate(a.date) || M.nowIso().slice(0, 10), due_date: isoDate(a.due_date), note: clean(a.text, 300), settled: false,
      });
      const what = direction === 'lent' ? `${m.person} ko ${rupees(amount)} udhaar diye` : `${m.person} se ${rupees(amount)} udhaar liye`;
      done.push({ label: `💰 ${what}${m.due_date ? ` · wapsi ${m.due_date}` : ''}`, undo: { coll: 'money', id: m.id, op: 'delete' } });
    }

    if (a.type === 'person' && clean(a.person)) {
      const before = M.findPerson(s, a.person);
      const p = upsertPerson(s, a.person, a.phone, a.relation);
      done.push({ label: `👤 ${p.name}${p.phone ? ` · ${p.phone}` : ''}${p.relation ? ` (${p.relation})` : ''}`, undo: before ? null : { coll: 'people', id: p.id, op: 'delete' } });
    }

    if (a.type === 'profile_fact' && clean(a.text) && a.key) {
      const before = new Set(Object.keys(s.facts || {}));
      ingestFacts(s, [{ key: a.key, value: clean(a.text, 300), about: a.about }], source, isoDate(a.date));
      const created = Object.keys(s.facts || {}).find((id) => !before.has(id));
      if (created) done.push({ label: `🪪 ${FACT_KEYS[a.key]?.[0] || a.key}: ${clean(a.text, 80)}`, undo: { coll: 'facts', id: created, op: 'delete' } });
    }

    if (a.type === 'settle_money') {
      const id = String(a.ref_id || '').replace(/^M/, '');
      const m = s.money?.[id];
      if (!m || m.deleted || m.settled) continue;
      M.putRecord(s, 'money', { id, settled: true, settled_on: M.nowIso().slice(0, 10) });
      done.push({ label: `✅ ${m.person} ka ${rupees(m.amount)} hisaab poora`, undo: { coll: 'money', id, op: 'unsettle' } });
    }

    if (a.type === 'complete_reminder') {
      const id = String(a.ref_id || '').replace(/^R/, '');
      const r = s.reminders?.[id];
      if (!r || r.deleted || r.done) continue;
      M.putRecord(s, 'reminders', { id, done: true });
      done.push({ label: `✅ ${r.text} — ho gaya`, undo: { coll: 'reminders', id, op: 'undone' } });
    }
  }
  return done;
}

export function undoAction(s, undo) {
  if (!undo) return;
  if (undo.op === 'delete') {
    if (undo.coll === 'notes') M.deleteNote(s, undo.id);
    else M.deleteRecord(s, undo.coll, undo.id);
  } else if (undo.op === 'unsettle') {
    M.putRecord(s, 'money', { id: undo.id, settled: false, settled_on: null });
  } else if (undo.op === 'undone') {
    M.putRecord(s, 'reminders', { id: undo.id, done: false });
  }
}
