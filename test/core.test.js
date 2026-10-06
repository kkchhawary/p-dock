import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/js/crypto.js';
import * as M from '../app/js/model.js';
import { maskSensitive, guessType, guessExpiry } from '../app/js/extract.js';

globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { mergeHeaders } = await import('../app/js/vault.js');

// ---------- encryption ----------
test('data encrypt/decrypt; tampering and wrong key rejected', async () => {
  const key = await C.newVaultKey();
  const plain = new TextEncoder().encode('DL No RJ14 20190012345');
  const blob = await C.encryptBytes(key, plain);
  assert.ok(!Buffer.from(blob).includes(Buffer.from('RJ14')), 'ciphertext mein plaintext nahi');
  assert.deepEqual(await C.decryptBytes(key, blob), plain);
  const bad = blob.slice(); bad[bad.length - 1] ^= 1;
  await assert.rejects(C.decryptBytes(key, bad));
  await assert.rejects(C.decryptBytes(await C.newVaultKey(), blob));
});

test('vault opens with password or recovery code, not with wrong ones', async () => {
  const key = await C.newVaultKey();
  const code = C.newRecoveryCode();
  assert.match(code, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  const header = await C.createVaultHeader(key, 'meri-maa-ka-ghar', code);
  const json = JSON.stringify(header);
  assert.ok(!json.includes('meri-maa-ka-ghar'), 'password header mein nahi hona chahiye');

  const secret = await C.encryptJson(key, { hello: 'P-Dock' });
  const k1 = await C.unlockWithPassword(header, 'meri-maa-ka-ghar');
  assert.deepEqual(await C.decryptJson(k1, secret), { hello: 'P-Dock' });
  const k2 = await C.unlockWithRecovery(header, code.toLowerCase().replace(/-/g, ' '));
  assert.deepEqual(await C.decryptJson(k2, secret), { hello: 'P-Dock' });

  await assert.rejects(C.unlockWithPassword(header, 'galat'), /Password galat/);
  await assert.rejects(C.unlockWithRecovery(header, C.newRecoveryCode()), /Recovery code galat/);
});

test('password change keeps the same data readable', async () => {
  const key = await C.newVaultKey();
  const header = await C.createVaultHeader(key, 'purana-pass', C.newRecoveryCode());
  const secret = await C.encryptJson(key, [1, 2, 3]);
  const h2 = await C.changePassword(header, key, 'naya-pass-123');
  await assert.rejects(C.unlockWithPassword(h2, 'purana-pass'));
  assert.deepEqual(await C.decryptJson(await C.unlockWithPassword(h2, 'naya-pass-123'), secret), [1, 2, 3]);
});

test('Face ID (PRF) secret unlocks; a different secret does not', async () => {
  const key = await C.newVaultKey();
  const prf = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await C.wrapForPasskey(key, prf);
  const secret = await C.encryptJson(key, 'ok');
  assert.equal(await C.decryptJson(await C.unlockWithPasskey(wrapped, prf), secret), 'ok');
  await assert.rejects(C.unlockWithPasskey(wrapped, crypto.getRandomValues(new Uint8Array(32))));
});

// ---------- merge (iPhone + Mac) ----------
const at = (iso) => ({ updated_at: iso });

test('merge keeps edits from both devices; newest version wins', () => {
  const a = M.emptyState();
  const b = M.emptyState();
  a.docs.x = { id: 'x', title: 'DL (iPhone)', ...at('2026-10-01T10:00:00Z') };
  b.docs.x = { id: 'x', title: 'DL (Mac, baad mein)', ...at('2026-10-01T11:00:00Z') };
  a.docs.y = { id: 'y', title: 'Sirf iPhone wala', ...at('2026-10-01T09:00:00Z') };
  b.notes.n = { id: 'n', text: 'Sirf Mac wali yaad', ...at('2026-10-01T09:00:00Z') };
  const m = M.merge(a, b);
  assert.equal(m.docs.x.title, 'DL (Mac, baad mein)');
  assert.equal(m.docs.y.title, 'Sirf iPhone wala');
  assert.equal(m.notes.n.text, 'Sirf Mac wali yaad');
  assert.deepEqual(M.merge(a, b), M.merge(b, a), 'order se farak nahi padna chahiye');
});

test('delete on one device is not undone by the other', () => {
  const s = M.emptyState();
  M.putDoc(s, { id: 'd1', title: 'Bill', created_at: M.nowIso() });
  const old = structuredClone(s);
  M.deleteDoc(s, 'd1');
  const m = M.merge(old, s);
  assert.equal(m.docs.d1.deleted, true);
  assert.equal(m.docs.d1.ocr_text, undefined, 'tombstone mein data nahi bachna chahiye');
  assert.equal(M.liveDocs(m).length, 0);
});

test('audit logs from both devices are combined without duplicates', () => {
  const a = M.emptyState();
  M.addAudit(a, 'unlock', '', 'iPhone');
  const b = structuredClone(a);
  M.addAudit(b, 'document_upload', 'x', 'Mac');
  const m = M.merge(a, b);
  assert.deepEqual(m.audit.map((e) => e.action), ['unlock', 'document_upload']);
});

test('header merge: newest password wins, removed Face ID stays removed', () => {
  const base = { v: 1, password: { key: 'old', changed: '2026-01-01' }, passkeys: [{ id: 'mac' }, { id: 'iphone' }] };
  const mac = { ...base, password: { key: 'new', changed: '2026-02-01' } };
  const phone = { ...base, passkeys: [{ id: 'iphone' }], removed: ['mac'] };
  const m = mergeHeaders(mac, phone);
  assert.equal(m.password.key, 'new');
  assert.deepEqual(m.passkeys.map((p) => p.id), ['iphone']);
  assert.deepEqual(mergeHeaders(phone, mac).passkeys.map((p) => p.id), ['iphone']);
});

// ---------- search & detection ----------
test('search finds documents and notes; expiry list', () => {
  const s = M.emptyState();
  M.putDoc(s, { id: 'a', title: 'Driving Licence', doc_type: 'driving_licence', fields: [], tags: ['gaadi'], ocr_text: 'RJ14', expiry_date: '2020-01-01', created_at: M.nowIso() });
  M.addNote(s, 'Gaadi ki service 45,200 km par hui');
  const r = M.search(s, 'gaadi');
  assert.deepEqual(r.map((x) => x.kind).sort(), ['doc', 'note']);
  assert.equal(M.upcomingExpiries(s, 90).length, 1);
});

test('masking and detection still work', () => {
  assert.equal(maskSensitive('1234 5678 9012 ABCDE1234F'), 'XXXX XXXX 9012 XXXXX1234X');
  assert.equal(guessType('TRANSPORT DEPARTMENT\nDRIVING LICENCE\nAadhaar: 1234'), 'driving_licence');
  assert.equal(guessExpiry('Valid Till: 14/03/2039'), '2039-03-14');
  // PDF se aaye text mein kai space hote hain
  assert.equal(guessType('JAIPUR   VIDYUT\nElectricity   Bill\nAmount   Due:   Rs 1,240'), 'bill');
  assert.equal(guessExpiry('Valid   Till:   14/03/2039'), '2039-03-14');
});
