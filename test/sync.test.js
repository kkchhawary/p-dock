// Google Drive sync ka end-to-end test — ek nakli Google Drive ke saath.
// Mac par vault banao → Drive → iPhone par kholo → badlav → wapas Mac. Drive par kabhi plaintext nahi.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
globalThis.sessionStorage = {
  data: { 'pdock-gtoken': JSON.stringify({ access_token: 'test-token', expires_at: Date.now() + 3600e3, scopes: SCOPE }) },
  getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; },
};

// ---------- nakli Google Drive ----------
const driveFiles = new Map(); // id -> { name, bytes }
let nextId = 1;
const requests = [];

globalThis.fetch = async (url, opts = {}) => {
  url = new URL(url);
  const method = opts.method || 'GET';
  requests.push(`${method} ${url.pathname}`);
  if (opts.headers?.Authorization !== 'Bearer test-token') return new Response('no', { status: 401 });
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  const m = url.pathname.match(/\/files\/([^/]+)$/);
  if (url.pathname === '/drive/v3/files' && method === 'GET') {
    assert.equal(url.searchParams.get('spaces'), 'appDataFolder', 'sirf appDataFolder');
    return json({ files: [...driveFiles].map(([id, f]) => ({ id, name: f.name, size: String(f.bytes.length), modifiedTime: '' })) });
  }
  if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
    const raw = Buffer.from(await new Response(opts.body).arrayBuffer());
    const boundary = opts.headers['Content-Type'].split('boundary=')[1];
    const parts = raw.toString('latin1').split(`--${boundary}`);
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    assert.deepEqual(meta.parents, ['appDataFolder']);
    const content = parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2);
    const id = `f${nextId++}`;
    driveFiles.set(id, { name: meta.name, bytes: Buffer.from(content, 'latin1') });
    return json({ id });
  }
  if (m && url.pathname.startsWith('/upload/') && method === 'PATCH') {
    driveFiles.get(m[1]).bytes = Buffer.from(await new Response(opts.body).arrayBuffer());
    return json({ id: m[1] });
  }
  if (m && method === 'GET' && url.searchParams.get('alt') === 'media') return new Response(driveFiles.get(m[1]).bytes);
  if (m && method === 'DELETE') { driveFiles.delete(m[1]); return new Response(null, { status: 204 }); }
  throw new Error(`Unexpected request ${method} ${url}`);
};

const V = await import('../app/js/vault.js');
const M = await import('../app/js/model.js');
const idb = await import('../app/js/idb.js');

const SECRET_FILE = new TextEncoder().encode('%PDF fake DL — RJ14 20190012345 — Valid till 14/03/2039');
const driveHasPlaintext = (needle) => [...driveFiles.values()].some((f) => f.bytes.includes(Buffer.from(needle)));
const byName = (name) => [...driveFiles.values()].find((f) => f.name === name);

let docId;
let macSnapshot;

test('Mac: vault banao, document + yaad daalo, Google Drive par sync', async () => {
  await V.setMode('drive');
  await V.createVault({ password: 'mac-ka-password', ownerName: 'Krishan' });
  docId = M.putDoc(V.state, { id: M.newId(), title: 'Driving Licence', doc_type: 'driving_licence', file_name: 'dl.pdf', mime: 'application/pdf', created_at: M.nowIso(), ocr_text: 'RJ14 20190012345', expiry_date: '2039-03-14', fields: [], tags: [] }).id;
  await V.putFile(docId, SECRET_FILE);
  M.addNote(V.state, 'Honda City service 45,200 km');
  await V.save();
  await V.sync();

  assert.ok(byName('vault.json') && byName('index.bin') && byName(`f_${docId}.bin`), 'teeno files Drive par');
  for (const s of ['20190012345', 'Honda', 'Krishan-secret', 'mac-ka-password', 'Driving Licence']) {
    assert.equal(driveHasPlaintext(s), false, `Drive par "${s}" plaintext nahi hona chahiye`);
  }
  // Mac ki local copy baad ke test ke liye
  macSnapshot = { header: await idb.kvGet('header'), index: await idb.kvGet('index'), file: await idb.fileGet(docId) };
  V.lock();
});

test('iPhone: naya device, Drive se vault mila, password se khula, sab data aa gaya', async () => {
  await idb.wipeDevice();
  assert.equal(await V.loadLocalHeader(), null);
  await V.setMode('drive'); // "Google Drive se jodo" button yahi karta hai
  const header = await V.fetchRemoteHeader();
  assert.equal(header.owner, 'Krishan');
  await assert.rejects(V.unlockPassword('galat'), /Password galat/);
  await V.unlockPassword('mac-ka-password');
  await V.sync();
  assert.equal(M.liveDocs(V.state)[0].title, 'Driving Licence');
  assert.equal(M.liveNotes(V.state)[0].text, 'Honda City service 45,200 km');
  assert.deepEqual(await V.getFile(docId), SECRET_FILE);
});

test('iPhone: document delete + nayi yaad + password badla → Drive par bhi', async () => {
  M.deleteDoc(V.state, docId);
  M.addNote(V.state, 'iPhone se: PUC 12 Nov tak');
  await V.changePassword('naya-password-123');
  await V.sync();
  assert.equal(byName(`f_${docId}.bin`), undefined, 'delete hui file Drive se bhi mitni chahiye');
  V.lock();
});

test('Mac wapas aaya (purani copy + offline badlav): delete wapas nahi aata, dono yaadein bachti hain, naya password chalta hai', async () => {
  await idb.wipeDevice();
  await idb.kvSet('mode', 'drive');
  await idb.kvSet('header', macSnapshot.header);
  await idb.kvSet('index', macSnapshot.index);
  await idb.fileSet(docId, macSnapshot.file);
  await V.loadLocalHeader();
  await V.unlockPassword('mac-ka-password'); // Mac ke paas abhi purana header hai
  M.addNote(V.state, 'Mac se offline: bijli bill ₹1,240');
  await V.save();
  await V.sync();

  assert.equal(M.liveDocs(V.state).length, 0, 'iPhone par delete hua document wapas nahi aana chahiye');
  assert.equal(byName(`f_${docId}.bin`), undefined, 'Mac ki purani file dobara upload nahi honi chahiye');
  assert.equal(await idb.fileGet(docId), undefined, 'Mac se bhi file mit jaani chahiye');
  assert.deepEqual(M.liveNotes(V.state).map((n) => n.text).sort(),
    ['Honda City service 45,200 km', 'Mac se offline: bijli bill ₹1,240', 'iPhone se: PUC 12 Nov tak'].sort());

  V.lock();
  await assert.rejects(V.unlockPassword('mac-ka-password'), /Password galat/);
  await V.unlockPassword('naya-password-123');
  assert.equal(M.liveNotes(V.state).length, 3);
  V.lock();
});

test('"sirf is device par" mode mein Drive par kuch nahi jaata, Google login hone par bhi', async () => {
  await idb.wipeDevice();
  await V.loadLocalHeader();
  await V.setMode('local');
  const before = requests.length;
  await V.createVault({ password: 'local-pass-123', ownerName: 'K' });
  M.addNote(V.state, 'sirf mere phone par');
  await V.save();
  await V.sync();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests.length, before, 'koi Drive request nahi honi chahiye');
  V.lock();
});

test('sirf Drive ke P-Dock folder (appDataFolder) ko chhua', () => {
  assert.ok(requests.every((r) => r.includes('/drive/v3/files')), requests.join('\n'));
});
