// Vault: kholna, save karna, aur Google Drive ke saath sync.
// Device par (IndexedDB) aur Drive par — dono jagah sirf encrypted data.
import * as C from './crypto.js';
import * as M from './model.js';
import * as idb from './idb.js';
import * as drive from './drive.js';
import { syncCalendar } from './calendar.js';

const HEADER_FILE = 'vault.json';
const INDEX_FILE = 'index.bin';
const fileName = (docId) => `f_${docId}.bin`;

let header = null;
let key = null;
export let state = null;
let syncTimer = null;
let syncing = null;
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
const emit = (what) => listeners.forEach((fn) => fn(what));

export const isUnlocked = () => Boolean(key);
export const getHeader = () => header;
export const device = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Browser');

// ---------- shuruaat ----------
let mode = null; // 'drive' | 'local' — local mode mein Drive par kabhi kuch nahi jaata

export async function loadLocalHeader() {
  header = (await idb.kvGet('header')) || null;
  mode = (await idb.kvGet('mode')) || null;
  return header;
}

export async function setMode(m) { mode = m; await idb.kvSet('mode', m); }
export const getMode = async () => (mode ??= (await idb.kvGet('mode')) || null);

// Naye device par: Drive mein pehle se vault hai?
export async function fetchRemoteHeader() {
  const files = await drive.listFiles();
  const f = files.find((x) => x.name === HEADER_FILE);
  if (!f) return null;
  const remote = JSON.parse(new TextDecoder().decode(await drive.download(f.id)));
  header = remote;
  await idb.kvSet('header', header);
  return header;
}

export async function createVault({ password, ownerName }) {
  const vaultKey = await C.newVaultKey();
  const recoveryCode = C.newRecoveryCode();
  header = await C.createVaultHeader(vaultKey, password, recoveryCode);
  header.password.changed = M.nowIso();
  header.owner = ownerName; // sirf naam — lock screen par dikhane ke liye
  key = vaultKey;
  state = M.emptyState();
  state.settings.owner_name = ownerName;
  state.settings.updated_at = M.nowIso();
  M.addAudit(state, 'vault_created', '', device());
  await idb.kvSet('header', header);
  await persist();
  return recoveryCode;
}

async function afterUnlock(k, how) {
  key = k;
  const blob = await idb.kvGet('index');
  state = M.normalize(blob ? await C.decryptJson(key, blob) : M.emptyState());
  M.addAudit(state, 'unlock', how, device());
  await persist();
}

export async function unlockPassword(pw) { await afterUnlock(await C.unlockWithPassword(header, pw), 'password'); }
export async function unlockRecovery(code) { await afterUnlock(await C.unlockWithRecovery(header, code), 'recovery code'); }
export async function unlockPasskey(credId, prfOutput) {
  const pk = header.passkeys.find((p) => p.id === credId);
  if (!pk) throw new Error('Yeh Face ID is vault ka nahi hai');
  await afterUnlock(await C.unlockWithPasskey(pk.key, prfOutput), `Face ID (${pk.name})`);
}

export function lock() {
  key = null;
  state = null;
  clearTimeout(syncTimer);
  emit('lock');
}

// ---------- save ----------
async function persist() {
  await idb.kvSet('index', await C.encryptJson(key, state));
}

// Har badlav ke baad: device par turant save, Drive par thodi der baad
export async function save() {
  await persist();
  emit('data');
  scheduleSync();
}

export function audit(action, detail = '') {
  M.addAudit(state, action, detail, device());
}

export async function putFile(docId, bytes) {
  await idb.fileSet(docId, await C.encryptBytes(key, bytes));
}

export async function getFile(docId) {
  let blob = await idb.fileGet(docId);
  if (!blob && drive.hasToken()) {
    const f = (await drive.listFiles()).find((x) => x.name === fileName(docId));
    if (f) {
      blob = await drive.download(f.id);
      await idb.fileSet(docId, blob);
    }
  }
  if (!blob) throw new Error('File abhi is device par nahi hai — Google se sync karo');
  return C.decryptBytes(key, blob);
}

// ---------- header badlav (password, Face ID, naam, recovery) ----------
export async function setOwner(name) {
  header = { ...header, owner: name };
  await idb.kvSet('header', header);
  state.settings = { ...state.settings, owner_name: name, updated_at: M.nowIso() };
  await save();
}

export async function newRecoveryCode() {
  const code = C.newRecoveryCode();
  const fresh = await C.createVaultHeader(key, 'unused-' + C.toB64(C.randomBytes(16)), code);
  header = { ...header, recovery: { ...fresh.recovery, changed: M.nowIso() } };
  await idb.kvSet('header', header);
  audit('recovery_code_changed');
  await save();
  return code;
}

export async function changePassword(newPw) {
  header = await C.changePassword(header, key, newPw);
  header.password.changed = M.nowIso();
  await idb.kvSet('header', header);
  audit('password_changed');
  await save();
}

export async function addPasskey({ id, name, prfOutput }) {
  const wrapped = await C.wrapForPasskey(key, prfOutput);
  header = { ...header, passkeys: [...header.passkeys.filter((p) => p.id !== id), { id, name, key: wrapped, added: M.nowIso() }] };
  await idb.kvSet('header', header);
  audit('passkey_added', name);
  await save();
}

export async function removePasskey(id) {
  const pk = header.passkeys.find((p) => p.id === id);
  header = { ...header, passkeys: header.passkeys.filter((p) => p.id !== id), removed: [...(header.removed || []), id] };
  await idb.kvSet('header', header);
  audit('passkey_removed', pk?.name);
  await save();
}

// Do devices ke header jodna: naya password jeetta hai, Face ID list ka union (hataye gaye wapas nahi aate)
export function mergeHeaders(a, b) {
  if (!a) return b;
  if (!b) return a;
  const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])];
  const pks = new Map();
  for (const p of [...a.passkeys, ...b.passkeys]) if (!removed.includes(p.id)) pks.set(p.id, p);
  const pick = (f) => ((a[f]?.changed || '') >= (b[f]?.changed || '') ? a[f] : b[f]);
  return { ...a, password: pick('password'), recovery: pick('recovery'), passkeys: [...pks.values()], removed };
}

// ---------- Google Drive sync ----------
export function scheduleSync(delay = 2500) {
  clearTimeout(syncTimer);
  if (!key || mode !== 'drive' || !drive.hasToken()) return;
  syncTimer = setTimeout(() => sync().catch((e) => emit({ syncError: e.message })), delay);
}

export function sync() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  if (!key || mode !== 'drive') return;
  emit({ syncing: true });
  const files = await drive.listFiles();
  const byName = new Map(files.map((f) => [f.name, f]));

  // 1. Header
  const remoteHeaderFile = byName.get(HEADER_FILE);
  const remoteHeader = remoteHeaderFile ? JSON.parse(new TextDecoder().decode(await drive.download(remoteHeaderFile.id))) : null;
  const mergedHeader = mergeHeaders(header, remoteHeader);
  if (JSON.stringify(mergedHeader) !== JSON.stringify(remoteHeader)) {
    await drive.upload(HEADER_FILE, new TextEncoder().encode(JSON.stringify(mergedHeader)), remoteHeaderFile?.id, 'application/json');
  }
  header = mergedHeader;
  await idb.kvSet('header', header);

  // 2. Index (documents ki jaankari, yaadein, settings)
  const remoteIndexFile = byName.get(INDEX_FILE);
  if (remoteIndexFile) {
    const remoteState = await C.decryptJson(key, await drive.download(remoteIndexFile.id));
    state = M.normalize(M.merge(state, M.normalize(remoteState)));
  }
  await syncCalendar(state).catch((e) => emit({ syncError: `Calendar: ${e.message}` }));
  await persist();
  await drive.upload(INDEX_FILE, await C.encryptJson(key, state), remoteIndexFile?.id);

  // 3. Files: naye upload, delete hue mitao, chhoti files pehle se le aao
  for (const d of Object.values(state.docs)) {
    const remote = byName.get(fileName(d.id));
    if (d.deleted) {
      if (remote) await drive.remove(remote.id);
      await idb.fileDel(d.id);
      continue;
    }
    const local = await idb.fileGet(d.id);
    if (local && !remote) await drive.upload(fileName(d.id), local);
    else if (!local && remote && Number(remote.size) < 3_000_000) await idb.fileSet(d.id, await drive.download(remote.id));
  }

  await idb.kvSet('lastSync', M.nowIso());
  emit({ synced: true });
  emit('data');
}

export const lastSync = () => idb.kvGet('lastSync');

// "Is device se mitao" — Drive ka data bacha rehta hai
export async function forgetDevice() {
  lock();
  drive.disconnect();
  await idb.wipeDevice();
  header = null;
  mode = null;
}
