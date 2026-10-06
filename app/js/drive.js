// Google Drive: sirf "appDataFolder" — Drive ka ek chhupa folder jo sirf P-Dock dekh sakta hai.
// Aapki baaki Drive files tak P-Dock ki koi pahunch nahi (scope: drive.appdata).
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let token = null; // { access_token, expires_at, scopes }
let gisReady = null;

export const driveConfigured = () => Boolean(GOOGLE_CLIENT_ID);

try {
  const saved = JSON.parse(sessionStorage.getItem('pdock-gtoken') || 'null');
  if (saved && saved.expires_at > Date.now()) token = saved;
} catch {}

export const hasToken = (scope = SCOPE_DRIVE) =>
  Boolean(token && token.expires_at > Date.now() + 60_000 && token.scopes.includes(scope));

function loadGis() {
  if (!gisReady) {
    gisReady = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => { gisReady = null; reject(new Error('Google se connect nahi ho paya — internet check karo')); };
      document.head.append(s);
    });
  }
  return gisReady;
}

// Button dabane par hi bulana (popup ke liye user ka tap zaroori hai)
export async function connect({ calendar = false } = {}) {
  if (!driveConfigured()) throw new Error('Google setup abhi baaki hai');
  await loadGis();
  const scopes = [SCOPE_DRIVE, ...(calendar ? [SCOPE_CALENDAR] : [])];
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: scopes.join(' '),
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) return reject(new Error('Google ne permission nahi di'));
        const granted = resp.scope || '';
        if (!granted.includes(SCOPE_DRIVE)) return reject(new Error('Drive ki permission zaroori hai'));
        token = { access_token: resp.access_token, expires_at: Date.now() + resp.expires_in * 1000, scopes: granted };
        try { sessionStorage.setItem('pdock-gtoken', JSON.stringify(token)); } catch {}
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Google window band ho gayi' : 'Google login nahi hua')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  try { sessionStorage.removeItem('pdock-gtoken'); } catch {}
}

export async function gfetch(url, opts = {}) {
  if (!token) throw new Error('Google se connect karo');
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token.access_token}`, ...(opts.headers || {}) } });
  if (res.status === 401) {
    token = null;
    throw new Error('Google session khatam — dobara connect karo');
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
  return res;
}

export async function listFiles() {
  const files = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken, files(id, name, modifiedTime, size)', pageSize: '1000' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await (await gfetch(`${API}/files?${q}`)).json();
    files.push(...data.files);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

export async function download(id) {
  return new Uint8Array(await (await gfetch(`${API}/files/${id}?alt=media`)).arrayBuffer());
}

export async function upload(name, bytes, existingId = null, mime = 'application/octet-stream') {
  if (existingId) {
    const res = await gfetch(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: bytes });
    return (await res.json()).id;
  }
  const boundary = 'pdock' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, bytes, `\r\n--${boundary}--`,
  ]);
  const res = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return (await res.json()).id;
}

export async function remove(id) {
  await gfetch(`${API}/files/${id}`, { method: 'DELETE' }).catch(() => {});
}
