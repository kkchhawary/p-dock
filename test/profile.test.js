// "Mera Profile": apne aap jaankari ikattha karna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/model.js';
import * as F from '../app/js/facts.js';
import { applyActions, undoAction } from '../app/js/actions.js';

globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const G = await import('../app/js/gmail.js');

const src = (label) => ({ kind: 'doc', id: label, label });

test('DL se bina AI ke: naam, DOB, pita, DL number', () => {
  const doc = { doc_type: 'driving_licence', ocr_text: 'TRANSPORT DEPARTMENT\nDRIVING LICENCE\nDL No: RJ14 20190012345\nName: KRISHAN KUMAR\nS/O: RAMESH KUMAR\nDate of Birth: 02/04/1992\nBlood Group: B+\nValid Till: 14/03/2039' };
  const facts = Object.fromEntries(F.localFacts(doc, 'Krishan').map((f) => [f.key, f.value]));
  assert.equal(facts.full_name, 'KRISHAN KUMAR');
  assert.equal(facts.dob, '1992-04-02');
  assert.equal(facts.father_name, 'RAMESH KUMAR');
  assert.equal(facts.dl_number, 'RJ14 20190012345');
  assert.equal(facts.blood_group, 'B+');
});

test('PAN aur Aadhaar ke poore number (sirf vault mein), gaadi number', () => {
  const pan = F.localFacts({ doc_type: 'pan', ocr_text: 'INCOME TAX DEPARTMENT\nName: KRISHAN KUMAR\nPermanent Account Number\nABCDE1234F' }, 'Krishan');
  assert.deepEqual(pan.find((f) => f.key === 'pan').value, 'ABCDE1234F');
  const aad = F.localFacts({ doc_type: 'aadhaar', ocr_text: 'Government of India\nName: Krishan Kumar\n1234 5678 9012' }, 'Krishan');
  assert.equal(aad.find((f) => f.key === 'aadhaar').value, '1234 5678 9012');
  const rc = F.localFacts({ doc_type: 'vehicle_service', ocr_text: 'Job Card\nVehicle No: RJ14CX4521\nOdometer 45200' }, 'Krishan');
  assert.equal(rc.find((f) => f.key === 'vehicle_number').value, 'RJ 14 CX 4521');
});

test('kisi aur ka document (patni ka Aadhaar) owner ke profile mein nahi jaata', () => {
  const facts = F.localFacts({ doc_type: 'aadhaar', ocr_text: 'Name: Sunita Devi\nDOB: 01/01/1994\n9876 5432 1098' }, 'Krishan');
  assert.equal(facts.length, 0);
});

test('same jaankari dobara aaye to ek hi rehti hai (sources judte hain); masked number poore ko nahi hataata', () => {
  const s = M.emptyState();
  F.addFact(s, { key: 'blood_group', value: 'B+', source: src('DL') });
  F.addFact(s, { key: 'blood_group', value: 'b+', source: src('Report') });
  const v = F.profileView(s).blood_group;
  assert.equal(v.values.length, 1);
  assert.equal(v.values[0].sources.length, 2);
  F.addFact(s, { key: 'aadhaar', value: '1234 5678 9012', source: src('Aadhaar') });
  assert.equal(F.addFact(s, { key: 'aadhaar', value: 'XXXX XXXX 9012', source: src('Bank') }), null);
});

test('takraar: alag pata mila to dono dikhte hain; "yeh sahi hai" se ek pakka', () => {
  const s = M.emptyState();
  const a = F.addFact(s, { key: 'address', value: '12 Ganesh Nagar, Jaipur', source: src('Aadhaar'), observed_at: '2020-01-01' });
  const b = F.addFact(s, { key: 'address', value: '45 Malviya Nagar, Jaipur', source: src('Bijli bill'), observed_at: '2026-09-01' });
  let v = F.profileView(s).address;
  assert.equal(v.values[0].id, b.id, 'naya wala upar');
  assert.equal(v.conflicts[0].id, a.id);
  F.confirmFact(s, a.id);
  v = F.profileView(s).address;
  assert.equal(v.values[0].id, a.id);
  assert.equal(v.conflicts.length, 0);
  F.rejectFact(s, b.id);
  assert.equal(Object.values(s.facts).find((f) => f.id === b.id).rejected, true);
});

test('multi-value (gaadiyan, phone) sab dikhte hain, takraar nahi', () => {
  const s = M.emptyState();
  F.addFact(s, { key: 'vehicle_number', value: 'RJ 14 CX 4521', source: src('RC') });
  F.addFact(s, { key: 'vehicle_number', value: 'RJ 14 AB 1111', source: src('Bike RC') });
  const v = F.profileView(s).vehicle_number;
  assert.equal(v.values.length, 2);
  assert.equal(v.conflicts.length, 0);
});

test('AI facts: owner ke profile mein, parivaar ke "Parivaar" mein', () => {
  const s = M.emptyState();
  F.ingestFacts(s, [
    { key: 'blood_group', value: 'B+', about: 'owner' },
    { key: 'dob', value: '2019-04-02', about: 'beti Riya' },
  ], src('Report'));
  const view = F.profileView(s);
  assert.equal(view.blood_group.values[0].value, 'B+');
  assert.equal(view.dob, undefined, 'beti ki DOB owner ki DOB nahi banni chahiye');
  assert.match(view.family_member.values[0].value, /beti Riya: Janm tithi 2019-04-02/);
});

test('chat: "mera blood group B+ hai" → profile; hatao se undo', () => {
  const s = M.emptyState();
  const done = applyActions(s, [{ type: 'profile_fact', key: 'blood_group', text: 'B+', about: 'owner' }]);
  assert.match(done[0].label, /Blood group: B\+/);
  assert.equal(F.profileView(s).blood_group.values[0].sources[0].kind, 'chat');
  undoAction(s, done[0].undo);
  assert.equal(F.profileView(s).blood_group, undefined);
});

test('profile do devices par merge hota hai; poora text form ke liye', () => {
  const a = M.emptyState();
  const b = M.emptyState();
  F.addFact(a, { key: 'pan', value: 'ABCDE1234F', source: src('PAN') });
  F.addFact(b, { key: 'phone', value: '9800000001', source: src('Chat') });
  const m = M.normalize(M.merge(a, b));
  const text = F.profileText(m);
  assert.match(text, /PAN: ABCDE1234F/);
  assert.match(text, /Mobile: 9800000001/);
  assert.match(F.profileText(m, { maskIds: true }), /PAN: XXXXXX234F|PAN: X+\d*F/);
});

test('Gmail: HTML mail ka saaf text; promotions/social nahi dekhe jaate', () => {
  const html = '<html><head><style>.x{}</style></head><body><p>Order <b>#123</b> delivered</p><div>Ship to: 45 Malviya Nagar&nbsp;Jaipur</div><script>evil()</script></body></html>';
  const t = G.htmlToText(html);
  assert.match(t, /Order #123 delivered/);
  assert.match(t, /Ship to: 45 Malviya Nagar Jaipur/);
  assert.doesNotMatch(t, /evil|\.x/);
  const payload = { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }] };
  assert.match(G.bodyText(payload), /Malviya Nagar/);
  const q = G.buildLearnQuery(30);
  assert.match(q, /-category:promotions -category:social/);
  assert.match(q, /newer_than:30d/);
});
