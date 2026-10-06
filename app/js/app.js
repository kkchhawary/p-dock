// P-Dock web app — UI. Data: device (IndexedDB) + aapka Google Drive, dono jagah encrypted.
import * as V from './vault.js';
import * as M from './model.js';
import * as drive from './drive.js';
import * as PK from './passkey.js';
import { DOC_TYPES } from './extract.js';
import { icsFile } from './calendar.js';
import { applyActions, undoAction } from './actions.js';
import * as P from './places.js';
import * as F from './facts.js';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const gate = $('#gate-card');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CAT_ICON = { identity: '🪪', vehicle: '🚗', insurance: '🛡️', education: '🎓', finance: '🧾', health: '🩺', property: '🏠', photos: '📷', other: '📄' };
const CAT_LABEL = { identity: 'Pehchaan', vehicle: 'Gaadi', insurance: 'Insurance', education: 'Padhai', finance: 'Bills / Paisa', health: 'Health', property: 'Ghar', photos: 'Photos', other: 'Baaki' };
const BILL_ICON = { food: '🍽️', grocery: '🛒', clothes: '👕', fuel: '⛽', vehicle_service: '🔧', medical: '💊', electricity: '💡', phone_internet: '📱', travel: '✈️', shopping: '🛍️', electronics: '🔌', education: '📚', home: '🏠', entertainment: '🎬', other: '🧾' };
const BILL_LABEL = { food: 'Khana', grocery: 'Ration / Grocery', clothes: 'Kapde', fuel: 'Petrol / Diesel', vehicle_service: 'Gaadi service', medical: 'Dawai / Doctor', electricity: 'Bijli', phone_internet: 'Mobile / Internet', travel: 'Safar', shopping: 'Shopping', electronics: 'Electronics', education: 'Padhai', home: 'Ghar', entertainment: 'Manoranjan', other: 'Baaki' };
const rupees = (n) => (n == null || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const IDLE_LOCK_MS = 10 * 60 * 1000;
const HIDDEN_LOCK_MS = 3 * 60 * 1000;

let chatLog = [];
const S = () => V.state;

// ---------- chhote helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const daysLeft = (iso) => Math.ceil((new Date(iso + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'abhi' : m < 60 ? `${m} min pehle` : m < 1440 ? `${Math.round(m / 60)} ghante pehle` : fmtDate(iso.slice(0, 10));
}

function expiryBadge(iso) {
  if (!iso) return '';
  const d = daysLeft(iso);
  if (d < 0) return '<span class="badge danger">Expire ho gaya</span>';
  if (d <= 30) return `<span class="badge warn">${d} din baaki</span>`;
  if (d <= 90) return `<span class="badge warn">${fmtDate(iso)}</span>`;
  return `<span class="badge">Valid: ${fmtDate(iso)}</span>`;
}
function statusBadge(s) {
  if (s === 'processing') return '<span class="badge">Padh raha hoon…</span>';
  if (s === 'error') return '<span class="badge danger">Padh nahi paya</span>';
  if (s === 'ai_failed') return '<span class="badge warn">AI fail</span>';
  return '';
}
function docItem(d) {
  const icon = d.bill ? BILL_ICON[d.bill.category] || '🧾' : CAT_ICON[d.category] || '📄';
  return `<a class="item" href="#/doc/${esc(d.id)}">
    <span class="ic">${icon}</span>
    <span class="grow"><div class="t">${esc(d.title)}</div><div class="s">${esc(d.summary || d.file_name)}</div></span>
    ${statusBadge(d.status) || ((d.questions || []).length ? '<span class="badge warn">❓ Sawaal</span>' : '') || expiryBadge(d.expiry_date) || (d.bill?.total != null ? `<span class="badge">${rupees(d.bill.total)}</span>` : '')}
  </a>`;
}

function ask({ title, body = '', input, okText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog');
    const form = $('#dialog-form');
    form.innerHTML = `<h3>${esc(title)}</h3>${body ? `<p class="muted">${esc(body)}</p>` : ''}
      ${input ? `<input name="v" type="${input.type || 'text'}" placeholder="${esc(input.placeholder || '')}" autocomplete="${input.autocomplete || 'off'}" required>` : ''}
      <div class="row end reverse"><button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(okText)}</button>
      <button value="cancel" class="btn" formnovalidate>Rehne do</button></div>`;
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? (input ? form.v.value : true) : null);
    dlg.showModal();
  });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// =====================================================================
// GATE: welcome → (Google) → naya vault / lock screen
// =====================================================================
function showGate(html, onReady) {
  $('#app').classList.add('hidden');
  $('#gate').classList.remove('hidden');
  gate.innerHTML = html;
  onReady?.();
}

// Profile feature se pehle daale gaye documents se bhi ek baar jaankari nikaalo
async function backfillFacts() {
  const s = S();
  if (s.settings.facts_backfill_v1) return;
  let n = 0;
  for (const d of M.liveDocs(s)) if (d.status !== 'processing') n += learnFromDoc(d, []);
  s.settings = { ...s.settings, facts_backfill_v1: true, updated_at: M.nowIso() };
  await V.save();
  if (n) toast(`🪪 Purane documents se ${n} jaankari Mera Profile mein judi`);
}

function showApp() {
  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  backfillFacts().catch((e) => console.warn(e));
  updateSyncPill();
  route();
  V.getMode().then((m) => { if (m === 'drive' && drive.hasToken()) V.sync().then(autoGmail).catch((e) => toast(e.message)); else autoGmail(); });
}

async function boot() {
  const header = await V.loadLocalHeader();
  if (header) return showLock();
  showWelcome();
}

function showWelcome() {
  const g = drive.driveConfigured();
  showGate(`
    <img src="icon.svg" alt="" class="logo">
    <h1>P-Dock</h1>
    <p class="lead">Your Life. Securely Docked.</p>
    <ul class="points">
      <li>Documents, bills, yaadein — sab ek jagah, poochho aur turant jawab.</li>
      <li>Data sirf aapke device aur <strong>aapke Google Drive</strong> mein — taala band (encrypted).</li>
      <li>iPhone aur Mac dono par, Face ID se.</li>
    </ul>
    ${g ? '<button class="btn primary" id="g-connect">Google Drive se jodo</button>' : '<p class="warnbox">Google Drive ka setup abhi baaki hai — tab tak "sirf is device par" chala sakte ho.</p>'}
    <button class="btn" id="local-start">Sirf is device par shuru karo</button>
    <p class="error" id="gate-err"></p>`, () => {
    $('#local-start').onclick = async () => { await V.setMode('local'); showCreate(); };
    $('#g-connect')?.addEventListener('click', async () => {
      $('#gate-err').textContent = '';
      try {
        await drive.connect();
        await V.setMode('drive');
        const remote = await V.fetchRemoteHeader();
        if (remote) { toast('Aapka vault Google Drive mein mil gaya'); showLock(); } else showCreate();
      } catch (e) { $('#gate-err').textContent = e.message; }
    });
  });
}

function showCreate() {
  showGate(`
    <img src="icon.svg" alt="" class="logo">
    <h2>Apna vault banao</h2>
    <form id="create-form">
      <label>Aapka naam<input name="name" autocomplete="name" required maxlength="40"></label>
      <label>Vault password<input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Password dobara<input name="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="muted">Kam se kam 8 akshar. Yahi password aapke data ki chaabi hai — P-Dock ya Google ke paas iski copy nahi hoti.</p>
      <button class="btn primary">Vault banao</button>
      <p class="error" id="gate-err"></p>
    </form>`, () => {
    $('#create-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.pw.value !== f.pw2.value) { $('#gate-err').textContent = 'Dono password alag hain'; return; }
      f.querySelector('button').disabled = true;
      f.querySelector('button').textContent = 'Bana raha hoon…';
      try {
        const code = await V.createVault({ password: f.pw.value, ownerName: f.name.value.trim() });
        showRecovery(code, () => showApp());
      } catch (err) {
        $('#gate-err').textContent = err.message;
        f.querySelector('button').disabled = false;
      }
    };
  });
}

function showRecovery(code, next) {
  showGate(`
    <h2>🔑 Recovery code</h2>
    <p class="lead">Password bhool gaye to sirf isi code se vault khulega. Ise kaagaz par likh lo ya kisi surakshit jagah save karo.</p>
    <div class="code">${esc(code)}</div>
    <div class="row"><button class="btn" id="rc-copy">Copy</button><button class="btn" id="rc-save">File save karo</button></div>
    <p class="warnbox">Yeh code dobara nahi dikhega. Password aur yeh code dono kho gaye to data wapas nahi aa sakta — koi bhi (main bhi) nahi khol sakta.</p>
    <label class="check"><input type="checkbox" id="rc-ok"> Maine recovery code surakshit rakh liya</label>
    <button class="btn primary" id="rc-next" disabled>Aage</button>`, () => {
    $('#rc-copy').onclick = () => navigator.clipboard.writeText(code).then(() => toast('Copy ho gaya'));
    $('#rc-save').onclick = () => download(new Blob([`P-Dock recovery code\n\n${code}\n\nIse surakshit rakho.\n`], { type: 'text/plain' }), 'P-Dock-recovery-code.txt');
    $('#rc-ok').onchange = (e) => { $('#rc-next').disabled = !e.target.checked; };
    $('#rc-next').onclick = next;
  });
}

async function showLock(msg = '') {
  const header = V.getHeader();
  const owner = header.owner || 'malik';
  const canBio = header.passkeys?.length && (await PK.passkeySupported());
  showGate(`
    <img src="icon.svg" alt="" class="logo">
    <h1>P-Dock</h1>
    <p class="guard">🔒 Yeh ${esc(owner)} ka P-Dock hai. Main sirf ${esc(owner)} ya mere boss ko bataunga.</p>
    ${canBio ? '<button class="btn primary" id="bio">🔓 Face ID / Touch ID se kholo</button><p class="or">ya</p>' : ''}
    <form id="pw-form">
      <input name="pw" type="password" autocomplete="current-password" placeholder="Vault password" required>
      <button class="btn ${canBio ? '' : 'primary'}">Kholo</button>
    </form>
    <button class="linkbtn" id="forgot">Password bhool gaye?</button>
    <p class="error" id="gate-err">${esc(msg)}</p>`, () => {
    const err = (m) => { $('#gate-err').textContent = m; };
    $('#pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try { await V.unlockPassword(e.target.pw.value); showApp(); } catch (x) { err(x.message); btn.disabled = false; }
    };
    $('#bio')?.addEventListener('click', async () => {
      err('');
      try {
        const r = await PK.authenticate(header.passkeys.map((p) => p.id));
        await V.unlockPasskey(r.id, r.prfOutput);
        showApp();
      } catch (x) { err(x.name === 'NotAllowedError' ? 'Cancel ho gaya — dobara try karo ya password daalo' : x.message); }
    });
    $('#forgot').onclick = async () => {
      const code = await ask({ title: 'Recovery code daalo', body: 'Vault banate waqt jo 24 akshar ka code mila tha.', input: { placeholder: 'XXXX-XXXX-…' }, okText: 'Kholo' });
      if (!code) return;
      try {
        await V.unlockRecovery(code);
        const pw = await ask({ title: 'Naya password banao', input: { type: 'password', placeholder: 'Kam se kam 8 akshar', autocomplete: 'new-password' }, okText: 'Save' });
        if (pw && pw.length >= 8) { await V.changePassword(pw); toast('Naya password set ho gaya'); }
        showApp();
      } catch (x) { err(x.message); }
    };
    if (canBio) $('#bio').focus(); else $('#pw-form input').focus();
  });
}

// ---------- auto-lock ----------
let lastActive = Date.now();
let hiddenAt = 0;
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => { if (V.isUnlocked() && Date.now() - lastActive > IDLE_LOCK_MS) doLock(); }, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (V.isUnlocked() && hiddenAt && Date.now() - hiddenAt > HIDDEN_LOCK_MS) doLock();
});

function doLock() {
  V.lock();
  chatLog = [];
  view.innerHTML = '';
  showLock();
}
$('#lock-btn').onclick = doLock;
$('#lock-btn-m').onclick = doLock;

// ---------- sync status ----------
async function updateSyncPill(state = {}) {
  const mode = await V.getMode();
  let text, cls = '';
  if (mode !== 'drive') { text = '📱 Sirf is device par'; }
  else if (state.syncing) { text = '☁️ Sync ho raha hai…'; }
  else if (state.syncError) { text = '⚠️ Sync nahi hua — tap karo'; cls = 'warn'; }
  else if (!drive.hasToken()) { text = '☁️ Google se jodo (tap)'; cls = 'warn'; }
  else { text = `☁️ Synced ${ago(await V.lastSync())}`; cls = 'ok'; }
  for (const el of [$('#sync-pill'), $('#sync-pill-m')]) { el.textContent = text; el.className = `sync-pill ${cls}`; }
}
async function syncNow() {
  if ((await V.getMode()) !== 'drive') { location.hash = '#/settings'; return; }
  try {
    if (!drive.hasToken()) await drive.connect({ calendar: S().settings.calendar_sync, gmail: S().settings.gmail_auto });
    await V.sync();
    toast('Sync ho gaya');
    autoGmail();
  } catch (e) { toast(e.message); updateSyncPill({ syncError: e.message }); }
}
$('#sync-pill').onclick = syncNow;
$('#sync-pill-m').onclick = syncNow;

V.onChange((what) => {
  if (what === 'lock') return;
  if (typeof what === 'object') {
    updateSyncPill(what);
    if (what.syncError) console.warn(what.syncError);
  }
  if (what === 'data' || what?.synced) refreshIfListing(Boolean(what?.synced));
});
// Documents list hamesha taaza; Yaadein page sirf doosre device se badlav aane par (taaki form mein likha mite nahi)
function refreshIfListing(fromSync) {
  if (!V.isUnlocked()) return;
  const h = location.hash || '#/';
  if (h === '#/docs') loadDocs();
  else if (fromSync && h.startsWith('#/notes')) renderNotes(h.split('/')[2] || '');
}

// =====================================================================
// ROUTER
// =====================================================================
const routes = [
  [/^#?\/?$/, 'home', renderHome],
  [/^#\/docs$/, 'docs', renderDocs],
  [/^#\/doc\/([\w-]+)$/, 'docs', renderDoc],
  [/^#\/notes(?:\/(\w+))?$/, 'notes', (tab) => renderNotes(tab || '')],
  [/^#\/me$/, 'me', renderMe],
  [/^#\/settings$/, 'settings', renderSettings],
  [/^#\/gmail$/, 'settings', renderGmail],
];
async function route() {
  if (!V.isUnlocked()) return;
  const hash = location.hash || '#/';
  for (const [re, nav, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      try { await fn(...m.slice(1)); } catch (e) { console.error(e); view.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
addEventListener('hashchange', route);

// =====================================================================
// HOME / CHAT
// =====================================================================
// ---------- jagah wale reminders (location sirf phone ke andar) ----------
let nearbyPlaceName = null;
let nearbyReminders = [];
let lastPlaceCheck = 0;

async function checkPlaces(force = false) {
  const s = S();
  if (!s?.settings.location_reminders) { nearbyPlaceName = null; nearbyReminders = []; return; }
  if (!force && Date.now() - lastPlaceCheck < 10 * 60 * 1000) return;
  lastPlaceCheck = Date.now();
  try {
    const here = await P.currentPosition();
    nearbyReminders = P.remindersNear(M.liveReminders(S()), here);
    let best = null;
    for (const [name, [lat, lon]] of Object.entries(P.CITIES)) {
      const d = P.distanceKm(here, { lat, lon });
      if (d < 40 && (!best || d < best.d)) best = { name, d };
    }
    nearbyPlaceName = best ? best.name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
    if (nearbyReminders.length && (location.hash || '#/') === '#/' && !chatLog.length) renderHome();
  } catch (e) { console.warn(e.message); }
}

function attentionHtml(s) {
  const att = M.attentionItems(s);
  const expiries = M.upcomingExpiries(s, 90);
  const rows = [];
  for (const r of nearbyReminders) rows.push(`<a class="item" href="#/notes/reminders"><span class="ic">📍</span><span class="grow"><div class="t">${esc(r.text)}</div><div class="s">Aap ${esc(r.place.name)} mein ho!</div></span></a>`);
  for (const r of att.reminders) rows.push(`<a class="item" href="#/notes/reminders"><span class="ic">🔔</span><span class="grow"><div class="t">${esc(r.text)}</div><div class="s">${esc(fmtDate(r.due_date))}</div></span>${r.due_date < M.nowIso().slice(0, 10) ? '<span class="badge danger">Beet gaya</span>' : '<span class="badge warn">Jaldi</span>'}</a>`);
  for (const m of att.money) rows.push(`<a class="item" href="#/notes/money"><span class="ic">💰</span><span class="grow"><div class="t">${m.direction === 'lent' ? `${esc(m.person)} se ${rupees(m.amount)} lene hain` : `${esc(m.person)} ko ${rupees(m.amount)} dene hain`}</div><div class="s">Wapsi: ${esc(fmtDate(m.due_date))}${m.phone ? ` · ${esc(m.phone)}` : ''}</div></span></a>`);
  for (const d of att.questions.slice(0, 3)) rows.push(`<a class="item" href="#/doc/${esc(d.id)}"><span class="ic">❓</span><span class="grow"><div class="t">${esc(d.questions[0])}</div><div class="s">${esc(d.title)}</div></span></a>`);
  rows.push(...expiries.slice(0, 5).map(docItem));
  return rows.length ? `<h3 class="section-h">⏰ Dhyaan do</h3><div class="list">${rows.join('')}</div>` : '';
}

function renderHome() {
  const s = S();
  const docs = M.liveDocs(s);
  const notes = M.liveNotes(s);
  checkPlaces();
  view.innerHTML = `
    ${!s.settings.ai_key ? '<div class="banner">AI abhi band hai — sirf keyword search chalega. <a href="#/settings">Settings</a> mein AI key daalo.</div>' : ''}
    <div id="chat-top"></div>
    <div class="chat" id="chat"></div>
    <form class="ask-bar" id="ask-form">
      <input id="q" placeholder="Kuch bhi poochho… ya batao, main yaad rakhunga" autocomplete="off">
      <button type="button" class="btn mic hidden" id="mic" title="Bolkar poochho">🎙️</button>
      <button class="btn primary">Bhejo</button>
    </form>`;
  if (!chatLog.length) {
    const name = s.settings.owner_name ? `, ${esc(s.settings.owner_name)}` : '';
    $('#chat-top').innerHTML = `
      <div class="hero"><h2>Namaste${name}! Kya jaanna hai?</h2>
      <p class="muted">${docs.length} documents · ${notes.length} yaadein · ${M.liveReminders(s).filter((r) => !r.done).length} reminders</p></div>
      <div class="suggest" id="suggest">
        ${['Mera DL kab expire hoga?', 'Is mahine khane pe kitna kharch hua?', 'Gaadi ki last service kitne km par hui?', 'Kisne mujhse udhaar liya hai?']
          .map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join('')}
      </div>
      ${attentionHtml(s)}
      ${!docs.length ? '<div class="card"><h3>Shuruaat karo</h3><p class="muted">Apna pehla document daalo — DL, Aadhaar, koi bill. <a href="#/docs">Documents mein jao →</a></p></div>' : ''}`;
    $('#chat-top').querySelectorAll('#suggest .chip').forEach((b) => (b.onclick = () => { $('#q').value = b.textContent; $('#ask-form').requestSubmit(); }));
  }
  chatLog.forEach(renderMsg);
  $('#ask-form').onsubmit = onAsk;
  setupMic();
}

function renderMsg(m) {
  const chat = $('#chat');
  if (!chat) return null;
  const el = document.createElement('div');
  el.className = `msg ${m.role}${m.pending ? ' thinking' : ''}`;
  el.textContent = m.text;
  if (m.sources?.length) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const src of m.sources) {
      const id = src.slice(1);
      if (src[0] === 'D' && S().docs[id] && !S().docs[id].deleted) chips.insertAdjacentHTML('beforeend', `<a class="chip" href="#/doc/${esc(id)}">📄 ${esc(S().docs[id].title)}</a>`);
      else if (src[0] === 'N' && S().notes[id] && !S().notes[id].deleted) chips.insertAdjacentHTML('beforeend', '<a class="chip" href="#/notes">🧠 Yaad</a>');
      else if (src[0] === 'R' && S().reminders?.[id] && !S().reminders[id].deleted) chips.insertAdjacentHTML('beforeend', '<a class="chip" href="#/notes/reminders">⏰ Reminder</a>');
      else if (src[0] === 'M' && S().money?.[id] && !S().money[id].deleted) chips.insertAdjacentHTML('beforeend', '<a class="chip" href="#/notes/money">💰 Udhaar</a>');
    }
    if (chips.children.length) el.append(chips);
  }
  if (m.saved?.length) {
    const box = document.createElement('div');
    box.className = 'saved';
    box.innerHTML = 'Save kar liya:' + m.saved.map((x, i) => `<div><span>${esc(x.label)}</span>${x.undo ? `<button data-i="${i}" type="button">hatao</button>` : ''}</div>`).join('');
    box.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
      const item = m.saved[Number(b.dataset.i)];
      undoAction(S(), item.undo);
      V.audit('undo', item.label.slice(0, 60));
      await V.save();
      item.undo = null;
      b.parentElement.style.textDecoration = 'line-through';
      b.remove();
      toast('Hata diya');
    }));
    el.append(box);
  }
  chat.append(el);
  el.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return el;
}

const REMEMBER = /^\s*(yaad rakh(o|na|lo|iye)?|remember( this| that)?|note (karo|kar lo)|save karo)\s*[:,\-–]?\s*/i;

async function onAsk(e) {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#q').value = '';
  $('#chat-top').innerHTML = '';
  const history = chatLog.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
  const userMsg = { role: 'user', text: q };
  chatLog.push(userMsg);
  renderMsg(userMsg);
  const pending = renderMsg({ role: 'bot', text: 'Soch raha hoon…', pending: true });
  const s = S();
  try {
    let reply;
    if (!s.settings.ai_key && REMEMBER.test(q) && q.replace(REMEMBER, '').trim()) {
      const saved = applyActions(s, [{ type: 'note', text: q.replace(REMEMBER, '').trim() }]);
      V.audit('note_create', 'chat');
      reply = { text: 'Theek hai, yaad rakh liya.', saved };
    } else {
      const hits = M.search(s, q, 8);
      V.audit('ask');
      if (!s.settings.ai_key) {
        reply = {
          text: hits.length
            ? ['AI abhi band hai, keyword se yeh mila:', ...hits.slice(0, 5).map((h) => `• ${h.kind === 'note' ? h.item.text : h.item.title}`)].join('\n')
            : 'AI abhi band hai aur keyword se kuch nahi mila. Doosre shabdon mein dhoondo.',
          sources: hits.map((h) => (h.kind === 'doc' ? 'D' : 'N') + h.id),
        };
      } else {
        const { answerQuestion } = await import('./ai.js');
        const r = await answerQuestion(s.settings.ai_key, {
          question: q,
          history,
          docs: M.liveDocs(s).filter((d) => d.status !== 'processing'),
          notes: M.liveNotes(s),
          reminders: M.liveReminders(s),
          money: M.liveMoney(s),
          people: M.livePeople(s),
          relevantDocIds: hits.filter((h) => h.kind === 'doc').slice(0, 5).map((h) => h.id),
          profile: s.profile.text,
          facts: F.profileText(s),
          here: nearbyPlaceName,
        });
        const saved = applyActions(s, r.actions || [], { kind: 'chat', id: null, label: 'Aapne bataya' });
        if (saved.length) V.audit('chat_saved', saved.map((x) => x.label.split(' ')[0]).join(' '));
        reply = { text: r.answer, sources: r.sources || [], saved };
      }
    }
    await V.save();
    const botMsg = { role: 'bot', ...reply };
    chatLog.push(botMsg);
    pending.remove();
    renderMsg(botMsg);
  } catch (err) {
    pending.textContent = err.message;
    pending.classList.remove('thinking');
  }
}

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#mic');
  if (!SR || !mic) return;
  mic.classList.remove('hidden');
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'hi-IN';
    rec.interimResults = true;
    rec.onresult = (ev) => { $('#q').value = Array.from(ev.results).map((r) => r[0].transcript).join(''); };
    rec.onend = () => {
      mic.classList.remove('listening');
      rec = null;
      if ($('#q')?.value.trim()) $('#ask-form').requestSubmit();
    };
    rec.onerror = () => toast('Mic se sun nahi paya');
    mic.classList.add('listening');
    rec.start();
  };
}

// =====================================================================
// DOCUMENTS
// =====================================================================
let docFilter = 'all';
const progress = new Map(); // docId -> text

function renderDocs() {
  view.innerHTML = `
    <div class="head"><h2>Documents</h2></div>
    <div class="stack">
      <label class="drop" id="drop">
        <input type="file" id="file" multiple accept="application/pdf,image/*" class="hidden">
        <strong>+ Document daalo</strong><br><span>PDF ya photo — yahan chhodo, ya tap karke chuno (iPhone par camera bhi)</span>
      </label>
      <input id="search" placeholder="Dhoondo… (jaise: insurance, bijli, DL)" autocomplete="off">
      <div class="filters" id="filters"></div>
      <div class="list" id="doc-list"></div>
    </div>`;
  const drop = $('#drop');
  $('#file').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); };
  $('#search').oninput = loadDocs;
  loadDocs();
}

function loadDocs() {
  const list = $('#doc-list');
  if (!list) return;
  const q = $('#search').value.trim();
  const docs = q ? M.search(S(), q, 200).filter((r) => r.kind === 'doc').map((r) => r.item) : M.liveDocs(S());
  const cats = [...new Set(docs.map((d) => d.category))];
  if (docFilter !== 'all' && !cats.includes(docFilter)) docFilter = 'all';
  $('#filters').innerHTML = cats.length > 1
    ? [`<button class="btn small ${docFilter === 'all' ? 'on' : ''}" data-c="all">Sab (${docs.length})</button>`,
      ...cats.map((c) => `<button class="btn small ${docFilter === c ? 'on' : ''}" data-c="${esc(c)}">${CAT_ICON[c] || ''} ${esc(CAT_LABEL[c] || c)}</button>`)].join('')
    : '';
  $('#filters').querySelectorAll('button').forEach((b) => (b.onclick = () => { docFilter = b.dataset.c; loadDocs(); }));
  const shown = docs.filter((d) => docFilter === 'all' || d.category === docFilter);
  list.innerHTML = shown.length
    ? shown.map((d) => docItem(progress.has(d.id) ? { ...d, summary: progress.get(d.id) } : d)).join('')
    : `<p class="muted">${q ? 'Kuch nahi mila.' : 'Abhi koi document nahi hai. Upar se pehla document daalo.'}</p>`;
}

async function uploadFiles(files) {
  const ok = files.filter((f) => ALLOWED.includes(f.type) || /\.(pdf|jpe?g|png|heic|webp)$/i.test(f.name));
  if (ok.length < files.length) toast('Sirf PDF ya photo (JPG/PNG/HEIC) chalegi');
  for (const f of ok) {
    if (f.size > 25 * 1024 * 1024) { toast(`${f.name}: 25MB se badi file`); continue; }
    const mime = f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    await addDocument(new Uint8Array(await f.arrayBuffer()), f.name, mime);
  }
}

// Naya document vault mein: encrypt karke save, phir background mein padhna
async function addDocument(bytes, fileName, mime, source = null) {
  const doc = M.putDoc(S(), {
    id: M.newId(), title: fileName.replace(/\.[^.]+$/, ''), doc_type: 'other', category: 'other',
    file_name: fileName, mime, size: bytes.length, status: 'processing', created_at: M.nowIso(), fields: [], tags: [], source,
  });
  await V.putFile(doc.id, bytes);
  V.audit('document_upload', source?.gmail ? `${fileName} (Gmail)` : fileName);
  await V.save();
  runPipeline(doc.id, bytes);
  return doc;
}

async function runPipeline(id, bytes) {
  const { processDocument } = await import('./pipeline.js');
  const d = S().docs[id];
  try {
    const info = await processDocument({
      bytes, mime: d.mime, fileName: d.file_name, settings: S().settings, profile: ownerInfo(),
      onProgress: (t) => { progress.set(id, t); if (location.hash === '#/docs') loadDocs(); },
    });
    if (!V.isUnlocked()) return;
    const { profile_facts: aiFacts, ...docInfo } = info;
    const doc = M.putDoc(S(), { ...S().docs[id], ...docInfo, error: null });
    learnFromDoc(doc, aiFacts);
  } catch (e) {
    console.error(e);
    if (!V.isUnlocked()) return;
    M.putDoc(S(), { ...S().docs[id], status: 'error', error: String(e.message || e).slice(0, 200) });
  } finally {
    progress.delete(id);
  }
  await V.save();
  if (location.hash === `#/doc/${id}`) renderDoc(id);
}

function billHtml(b) {
  const items = b.items || [];
  return `<div class="stack">
    <div class="row wrap"><span class="badge ok">${BILL_ICON[b.category] || '🧾'} ${esc(BILL_LABEL[b.category] || b.category)}</span>
      ${b.for_whom ? `<span class="badge">👤 ${esc(b.for_whom)}</span>` : ''}${b.payment_mode ? `<span class="badge">💳 ${esc(b.payment_mode)}</span>` : ''}</div>
    ${b.merchant || b.date ? `<div class="muted">${esc(b.merchant || '')}${b.date ? ` · ${esc(fmtDate(b.date))}` : ''}</div>` : ''}
    ${b.for_whom_reason ? `<div class="muted">Kyun lagta hai: ${esc(b.for_whom_reason)}</div>` : ''}
    ${items.length || b.total != null ? `<table class="items-table">${items.map((i) => `<tr><td>${esc(i.name)}${i.qty ? ` <span class="muted">× ${esc(i.qty)}</span>` : ''}</td><td>${rupees(i.amount)}</td></tr>`).join('')}
      ${b.total != null ? `<tr class="total"><td>Total</td><td>${rupees(b.total)}</td></tr>` : ''}</table>` : ''}
  </div>`;
}

// Owner kaun hai — AI ko batane ke liye (profile + "Mere baare mein" text)
function ownerInfo() {
  const s = S();
  return [s.settings.owner_name && `Owner name: ${s.settings.owner_name}`, F.profileText(s, { maskIds: true }), s.profile.text].filter(Boolean).join('\n');
}

// Document se profile mein jaankari (bina AI: number/naam; AI ho to aur bhi)
function learnFromDoc(doc, aiFacts = []) {
  const s = S();
  const source = { kind: 'doc', id: doc.id, label: doc.title };
  const observed = doc.issue_date || doc.bill?.date || doc.created_at?.slice(0, 10);
  const n = F.addFacts(s, F.localFacts(doc, s.settings.owner_name), source, observed) + F.ingestFacts(s, aiFacts, source, observed);
  if (n) V.audit('profile_learned', `${n} · ${doc.title}`);
  return n;
}

let previewUrl = null;
async function renderDoc(id) {
  const d = S().docs[id];
  if (!d || d.deleted) { view.innerHTML = '<p class="muted">Document nahi mila. <a href="#/docs">Wapas</a></p>'; return; }
  V.audit('document_view', d.title);
  view.innerHTML = `
    <div class="head"><div><a href="#/docs">← Documents</a><h2>${esc(d.title)}</h2></div>
      <div class="row"><button class="btn" id="dl">⬇︎ Download</button><button class="btn danger" id="del">Delete</button></div></div>
    <div class="grid2">
      <div id="preview"><div class="card muted">File khul rahi hai…</div></div>
      <div class="stack">
        <div class="card stack">
          <div class="row wrap">${statusBadge(d.status)}${!progress.has(id) ? `<button class="btn small" id="reprocess">🔄 Dobara padho${S().settings.ai_key ? ' (AI se)' : ''}</button>` : ''}</div>
          ${d.status === 'error' && d.error ? `<p class="muted">⚠️ ${esc(d.error)}</p>` : ''}
          ${d.summary ? `<p>${esc(d.summary)}</p>` : ''}
          ${d.source?.gmail ? `<p class="muted">📧 Gmail se: ${esc(d.source.subject || '')}${d.source.from ? ` — ${esc(d.source.from)}` : ''}</p>` : ''}
          ${(d.questions || []).map((q, i) => `<form class="qbox" data-q="${i}"><div class="q">❓ ${esc(q)}</div>
            <div class="row"><input name="a" placeholder="Jawab likho…" required autocomplete="off"><button class="btn small primary">Batao</button></div></form>`).join('')}
          ${d.bill ? billHtml(d.bill) : ''}
          ${d.photo_description ? `<p>📷 ${esc(d.photo_description)}</p>` : ''}
          <dl class="kv">
            <dt>Type</dt><dd>${esc(DOC_TYPES[d.doc_type]?.label || d.doc_type)}</dd>
            ${d.owner ? `<dt>Kiska</dt><dd>${esc(d.owner)}</dd>` : ''}
            ${d.issue_date ? `<dt>Issue</dt><dd>${fmtDate(d.issue_date)}</dd>` : ''}
            ${d.expiry_date ? `<dt>Expiry</dt><dd>${fmtDate(d.expiry_date)} ${daysLeft(d.expiry_date) <= 90 ? expiryBadge(d.expiry_date) : ''}</dd>` : ''}
            ${(d.fields || []).map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}
            <dt>File</dt><dd>${esc(d.file_name)}</dd>
          </dl>
          <button class="btn" id="edit">✏️ Sahi karo</button>
        </div>
        <form class="card stack hidden" id="edit-form">
          <label>Naam<input name="title" value="${esc(d.title)}" required></label>
          <label>Type<select name="doc_type">${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}" ${k === d.doc_type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
          <div class="grid2"><label>Issue date<input type="date" name="issue_date" value="${esc(d.issue_date || '')}"></label>
          <label>Expiry date<input type="date" name="expiry_date" value="${esc(d.expiry_date || '')}"></label></div>
          <div><strong>Jaankari</strong><div class="fields" id="fields"></div><button type="button" class="btn small" id="add-field">+ Aur jodo</button></div>
          <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="cancel-edit">Rehne do</button></div>
        </form>
        ${d.ocr_text ? `<details><summary>Document ka poora text</summary><pre class="ocr">${esc(d.ocr_text)}</pre></details>` : ''}
      </div>
    </div>`;

  // Preview: decrypt karke sirf memory mein (blob URL)
  let bytes = null;
  try {
    bytes = await V.getFile(id);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
    const isImg = d.mime.startsWith('image/');
    $('#preview').innerHTML = isImg ? `<img class="preview" src="${previewUrl}" alt="">`
      : `<iframe class="preview" src="${previewUrl}" title="${esc(d.title)}"></iframe>`;
  } catch (e) {
    $('#preview').innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
  }

  view.querySelectorAll('form.qbox').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    const cur = S().docs[id];
    const i = Number(f.dataset.q);
    const q = cur.questions[i];
    const a = f.a.value.trim().slice(0, 500);
    const forWhom = /kiske liye|kiska|kiski|for whom/i.test(q);
    const label = forWhom ? 'Kiske liye' : q.replace(/[?？]\s*$/, '').slice(0, 60);
    const patch = {
      questions: cur.questions.filter((_, j) => j !== i),
      fields: [...(cur.fields || []), { label, value: a }],
    };
    // "Kiske liye" wala jawab bill mein bhi
    if (cur.bill && forWhom) patch.bill = { ...cur.bill, for_whom: a, for_whom_reason: 'aapne bataya' };
    M.putDoc(S(), { ...cur, ...patch });
    V.audit('document_answer', cur.title);
    await V.save();
    toast('Yaad rakh liya');
    renderDoc(id);
  }));

  $('#dl').onclick = async () => {
    try { download(new Blob([bytes || await V.getFile(id)], { type: d.mime }), d.file_name); V.audit('document_download', d.title); V.save(); } catch (e) { toast(e.message); }
  };
  $('#reprocess')?.addEventListener('click', async () => {
    try {
      const b = bytes || await V.getFile(id);
      M.putDoc(S(), { ...S().docs[id], status: 'processing' });
      await V.save();
      renderDoc(id);
      runPipeline(id, b);
    } catch (e) { toast(e.message); }
  });

  const fieldRow = (f = { label: '', value: '' }) => {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<input placeholder="Naam (jaise Amount)" value="${esc(f.label)}"><input placeholder="Value" value="${esc(f.value)}"><button type="button" class="btn small">✕</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('#fields').append(row);
  };
  $('#edit').onclick = () => { $('#edit-form').classList.remove('hidden'); $('#fields').innerHTML = ''; (d.fields || []).forEach(fieldRow); };
  $('#add-field').onclick = () => fieldRow();
  $('#cancel-edit').onclick = () => $('#edit-form').classList.add('hidden');
  $('#edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const fields = [...$('#fields').children].map((r) => ({ label: r.children[0].value.trim().slice(0, 100), value: r.children[1].value.trim().slice(0, 1000) })).filter((x) => x.label);
    const type = DOC_TYPES[f.doc_type.value] ? f.doc_type.value : 'other';
    M.putDoc(S(), {
      ...S().docs[id], title: f.title.value.trim().slice(0, 200) || d.title, doc_type: type, category: DOC_TYPES[type].category,
      issue_date: f.issue_date.value || null, expiry_date: f.expiry_date.value || null, fields,
    });
    V.audit('document_edit', d.title);
    await V.save();
    toast('Save ho gaya');
    renderDoc(id);
  };
  $('#del').onclick = async () => {
    if (!(await ask({ title: 'Hamesha ke liye delete karein?', body: `"${d.title}" har device aur Google Drive se mit jaayega.`, okText: 'Delete', danger: true }))) return;
    M.deleteDoc(S(), id);
    V.audit('document_delete', d.title);
    await V.save();
    toast('Delete ho gaya');
    location.hash = '#/docs';
  };
}

// =====================================================================
// YAADEIN: yaadein · reminders · udhaar · log
// =====================================================================
const LIFE_TABS = [['', '🧠 Yaadein'], ['reminders', '⏰ Reminders'], ['money', '💰 Udhaar'], ['people', '👤 Log']];

function renderNotes(tab = '') {
  const s = S();
  view.innerHTML = `
    <div class="head"><h2>Yaadein</h2></div>
    <div class="filters tabs">${LIFE_TABS.map(([t, l]) => `<a class="btn small ${t === tab ? 'on' : ''}" href="#/notes${t ? '/' + t : ''}">${l}</a>`).join('')}</div>
    <div id="life"></div>`;
  ({ '': lifeNotes, reminders: lifeReminders, money: lifeMoney, people: lifePeople }[tab] || lifeNotes)(s, $('#life'));
}

const delBtn = (coll, id) => `<button class="btn small danger" data-del="${coll}:${esc(id)}" title="Hatao">✕</button>`;
function wireDeletes(box, rerender) {
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await ask({ title: 'Hata dein?', okText: 'Hatao', danger: true }))) return;
    const [coll, id] = b.dataset.del.split(':');
    if (coll === 'notes') M.deleteNote(S(), id); else M.deleteRecord(S(), coll, id);
    V.audit(`${coll}_delete`);
    await V.save();
    rerender();
  }));
}

function lifeNotes(s, box) {
  const notes = M.liveNotes(s);
  box.innerHTML = `
    <p class="muted">Chhoti-chhoti baatein. Chat mein jo batate ho, woh bhi apne aap yahan aa jaati hain.</p>
    <form class="card stack" id="note-form">
      <textarea name="text" rows="2" placeholder="Jaise: Aaj Honda City ki service hui, 45,200 km, ₹4,850" required></textarea>
      <div class="row"><input type="date" name="event_date" title="Kab hua (optional)"><button class="btn primary">Yaad rakho</button></div>
    </form>
    <input id="note-search" class="spaced" placeholder="Yaadon mein dhoondo…" autocomplete="off">
    <div class="list" id="note-list"></div>`;
  const draw = () => {
    const q = $('#note-search').value.toLowerCase();
    const shown = notes.filter((n) => n.text.toLowerCase().includes(q));
    $('#note-list').innerHTML = shown.length ? shown.map((n) => `
      <div class="item"><span class="ic">🧠</span><span class="grow"><div>${esc(n.text)}</div>
      <div class="s">${fmtDate(n.event_date || n.created_at.slice(0, 10))}</div></span>${delBtn('notes', n.id)}</div>`).join('')
      : '<p class="muted">Abhi koi yaad nahi.</p>';
    wireDeletes($('#note-list'), () => renderNotes(''));
  };
  $('#note-search').oninput = draw;
  draw();
  $('#note-form').onsubmit = async (e) => {
    e.preventDefault();
    M.addNote(S(), e.target.text.value.trim().slice(0, 5000), e.target.event_date.value || null);
    V.audit('note_create');
    await V.save();
    toast('Yaad rakh liya');
    renderNotes('');
  };
}

function lifeReminders(s, box) {
  const list = M.liveReminders(s);
  box.innerHTML = `
    <p class="muted">Tareekh wale reminder Google Calendar se phone par bajte hain. Jagah wale tab dikhte hain jab aap us shehar mein app kholte ho${s.settings.location_reminders ? '' : ' — <a href="#/settings">Settings</a> mein "Location se yaad dilao" chalu karo'}.</p>
    <form class="card stack" id="rem-form">
      <input name="text" placeholder="Kya yaad dilana hai? (jaise: Lal Qila ghumna)" required maxlength="300">
      <div class="grid2"><label>Tareekh (optional)<input type="date" name="due"></label>
      <label>Jagah (optional)<input name="place" list="cities" placeholder="Jaise: Delhi" autocomplete="off"></label></div>
      <datalist id="cities">${Object.keys(P.CITIES).map((c) => `<option value="${esc(c.replace(/\b\w/g, (x) => x.toUpperCase()))}">`).join('')}</datalist>
      <div><button class="btn primary">Reminder lagao</button></div>
    </form>
    <div class="list spaced-top" id="rem-list">${list.length ? list.map((r) => `
      <div class="item ${r.done ? 'faded' : ''}"><input type="checkbox" class="tick" data-done="${esc(r.id)}" ${r.done ? 'checked' : ''} title="Ho gaya">
      <span class="grow"><div class="t">${esc(r.text)}</div><div class="s">${[r.due_date && `📅 ${esc(fmtDate(r.due_date))}`, r.place && `📍 ${esc(r.place.name)}`].filter(Boolean).join(' · ')}</div></span>
      ${delBtn('reminders', r.id)}</div>`).join('') : '<p class="muted">Koi reminder nahi.</p>'}</div>`;
  wireDeletes(box, () => renderNotes('reminders'));
  box.querySelectorAll('[data-done]').forEach((c) => (c.onchange = async () => {
    M.putRecord(S(), 'reminders', { id: c.dataset.done, done: c.checked });
    await V.save();
    renderNotes('reminders');
  }));
  $('#rem-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const placeName = f.place.value.trim();
    if (!f.due.value && !placeName) { toast('Tareekh ya jagah — kam se kam ek chahiye'); return; }
    const place = placeName ? P.resolvePlace({ name: placeName }) : null;
    if (place && place.lat == null) toast(`"${placeName}" ki location nahi mili — AI chalu ho to woh dhoondh lega`);
    M.putRecord(S(), 'reminders', { id: M.newId(), text: f.text.value.trim(), due_date: f.due.value || null, place, done: false });
    V.audit('reminder_create');
    await V.save();
    toast('Reminder lag gaya');
    renderNotes('reminders');
  };
}

function lifeMoney(s, box) {
  const sum = M.moneySummary(s);
  const list = M.liveMoney(s);
  box.innerHTML = `
    <div class="grid2">
      <div class="card"><div class="muted">Mujhe milne hain</div><div class="big ok">${rupees(sum.toReceive) || '₹0'}</div></div>
      <div class="card"><div class="muted">Mujhe dene hain</div><div class="big warn">${rupees(sum.toPay) || '₹0'}</div></div>
    </div>
    <form class="card stack spaced-top" id="money-form">
      <div class="grid2"><label>Kya hua<select name="dir"><option value="lent">Maine udhaar diya</option><option value="borrowed">Maine udhaar liya</option></select></label>
      <label>Kisko / kisse<input name="person" required maxlength="60" list="people"></label></div>
      <datalist id="people">${M.livePeople(s).map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <div class="grid2"><label>Kitna (₹)<input name="amount" type="number" min="1" step="1" required inputmode="numeric"></label>
      <label>Mobile (optional)<input name="phone" type="tel" inputmode="tel"></label></div>
      <div class="grid2"><label>Kab diya/liya<input name="date" type="date"></label><label>Wapsi kab (optional)<input name="due" type="date"></label></div>
      <div><button class="btn primary">Save</button></div>
    </form>
    <div class="list spaced-top">${list.length ? list.map((m) => `
      <div class="item ${m.settled ? 'faded' : ''}"><span class="ic">${m.direction === 'lent' ? '⬆️' : '⬇️'}</span>
      <span class="grow"><div class="t">${m.direction === 'lent' ? `${esc(m.person)} ko diye` : `${esc(m.person)} se liye`} · ${rupees(m.amount)}</div>
      <div class="s">${esc(fmtDate(m.date))}${m.due_date ? ` · wapsi ${esc(fmtDate(m.due_date))}` : ''}${m.settled ? ` · ✅ hisaab poora` : ''}${m.note ? ` · ${esc(m.note)}` : ''}</div></span>
      ${m.phone ? `<a class="btn small" href="tel:${esc(m.phone)}" title="Call">📞</a>` : ''}
      ${m.settled ? '' : `<button class="btn small" data-settle="${esc(m.id)}">${m.direction === 'lent' ? 'Mil gaya' : 'Lauta diya'}</button>`}
      ${delBtn('money', m.id)}</div>`).join('') : '<p class="muted">Koi udhaar nahi. Chat mein bhi bol sakte ho: "Naresh ko 500 diye, 15 tareekh ko lautayega".</p>'}</div>`;
  wireDeletes(box, () => renderNotes('money'));
  box.querySelectorAll('[data-settle]').forEach((b) => (b.onclick = async () => {
    M.putRecord(S(), 'money', { id: b.dataset.settle, settled: true, settled_on: M.nowIso().slice(0, 10) });
    V.audit('money_settled');
    await V.save();
    toast('Hisaab poora');
    renderNotes('money');
  }));
  $('#money-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    applyActions(S(), [{
      type: 'money', direction: f.dir.value, person: f.person.value, amount: Number(f.amount.value),
      phone: f.phone.value, date: f.date.value || null, due_date: f.due.value || null,
    }]);
    V.audit('money_create');
    await V.save();
    toast('Save ho gaya');
    renderNotes('money');
  };
}

function lifePeople(s, box) {
  const people = M.livePeople(s);
  box.innerHTML = `
    <form class="card stack" id="person-form">
      <div class="grid2"><label>Naam<input name="name" required maxlength="60"></label><label>Rishta (optional)<input name="relation" placeholder="dost, bhai, doctor…" maxlength="40"></label></div>
      <div class="row"><input name="phone" type="tel" inputmode="tel" placeholder="Mobile (optional)"><button class="btn primary">Save</button></div>
    </form>
    <div class="list spaced-top">${people.length ? people.map((p) => {
      const open = M.liveMoney(s).filter((m) => !m.settled && m.person.toLowerCase() === p.name.toLowerCase());
      const bal = open.reduce((t, m) => t + (m.direction === 'lent' ? 1 : -1) * Number(m.amount), 0);
      return `<div class="item"><span class="ic">👤</span><span class="grow"><div class="t">${esc(p.name)}${p.relation ? ` <span class="muted">(${esc(p.relation)})</span>` : ''}</div>
        <div class="s">${esc(p.phone || '—')}${bal ? ` · ${bal > 0 ? `${rupees(bal)} lene hain` : `${rupees(-bal)} dene hain`}` : ''}</div></span>
        ${p.phone ? `<a class="btn small" href="tel:${esc(p.phone)}">📞</a>` : ''}${delBtn('people', p.id)}</div>`;
    }).join('') : '<p class="muted">Abhi koi naam nahi. Chat mein bata do: "Naresh mera dost hai, number 98…".</p>'}</div>`;
  wireDeletes(box, () => renderNotes('people'));
  $('#person-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    applyActions(S(), [{ type: 'person', person: f.name.value, phone: f.phone.value, relation: f.relation.value }]);
    V.audit('person_save');
    await V.save();
    toast('Save ho gaya');
    renderNotes('people');
  };
}

// =====================================================================
// GMAIL SE BILLS
// =====================================================================
let gmailResults = null;
let gmailRunning = false;

// Din mein ek baar (jab Google juda ho): naye bills laao + AI ho to kaam ke mails se seekho
async function autoGmail(force = false) {
  const s = S();
  if (!s?.settings.gmail_auto || gmailRunning || !drive.hasToken(drive.SCOPE_GMAIL)) return;
  const last = s.settings.gmail_last_scan;
  if (!force && last && Date.now() - Date.parse(last) < 20 * 3600e3) return;
  gmailRunning = true;
  const today = M.nowIso().slice(0, 10);
  try {
    const G = await import('./gmail.js');
    const days = last ? Math.min(400, Math.ceil((Date.now() - Date.parse(last)) / 864e5) + 2) : 60;
    const have = new Set(M.liveDocs(S()).filter((d) => d.source?.gmail).map((d) => `${d.source.gmail}|${d.file_name}`));
    let bills = 0;
    let learned = 0;
    for (const m of await G.findBills({ days, max: 40 })) {
      for (const a of m.attachments) {
        if (have.has(`${m.id}|${a.filename}`)) continue;
        const bytes = await G.downloadAttachment(m.id, a.attachmentId);
        await addDocument(bytes, a.filename, a.mimeType, { gmail: m.id, subject: m.subject.slice(0, 150), from: m.from.slice(0, 80), date: m.date });
        bills++;
      }
      S().gmail_seen[m.id] = today;
    }
    if (S().settings.ai_key) {
      const { learnFromEmail } = await import('./ai.js');
      for (const id of await G.listMessageIds(G.buildLearnQuery(days), 25)) {
        if (S().gmail_seen[id]) continue;
        const msg = await G.readMessage(id);
        const r = await learnFromEmail(S().settings.ai_key, { ...msg, ownerInfo: ownerInfo() });
        if (r.useful) learned += applyActions(S(), r.actions || [], { kind: 'gmail', id, label: msg.subject.slice(0, 100) }).length;
        S().gmail_seen[id] = today;
      }
    }
    S().settings = { ...S().settings, gmail_last_scan: M.nowIso(), updated_at: M.nowIso() };
    V.audit('gmail_auto', `${bills} bills, ${learned} nayi jaankari`);
    await V.save();
    if (bills || learned) toast(`📧 Gmail se ${bills} naye bills${learned ? `, ${learned} nayi jaankari` : ''}`);
  } catch (e) {
    console.warn(e);
    toast(`Gmail: ${e.message}`);
  } finally {
    gmailRunning = false;
  }
}

async function renderGmail() {
  const { hasToken, SCOPE_GMAIL } = drive;
  view.innerHTML = `
    <div class="head"><div><a href="#/settings">← Settings</a><h2>📧 Gmail se bills</h2></div></div>
    <div class="card stack">
      <p class="muted">P-Dock aapke Gmail mein sirf bill, invoice, receipt, policy, ticket jaise mail dhoondhega aur unke PDF/photo dikhayega.
      Aap chunoge kaunse laane hain. Gmail ki permission sirf <strong>padhne</strong> ki hai — koi mail bheja ya mitaya nahi jaata, aur mail kisi server par nahi jaate.</p>
      <div class="row wrap"><label class="row">Kitne purane<select id="gm-days"><option value="90">3 mahine</option><option value="365" selected>1 saal</option><option value="1095">3 saal</option></select></label>
      <button class="btn primary" id="gm-scan">🔍 Gmail mein bills dhoondo</button></div>
      <p class="progress" id="gm-progress"></p>
    </div>
    <div id="gm-results" class="spaced-top"></div>`;

  const drawResults = () => {
    const box = $('#gm-results');
    if (!gmailResults) return;
    if (!gmailResults.length) { box.innerHTML = '<p class="muted">Koi bill wala mail nahi mila.</p>'; return; }
    const imported = new Set(M.liveDocs(S()).filter((d) => d.source?.gmail).map((d) => `${d.source.gmail}|${d.file_name}`));
    let fresh = 0;
    box.innerHTML = `<form id="gm-form" class="stack">
      <div class="list">${gmailResults.map((m, mi) => m.attachments.map((a, ai) => {
        const done = imported.has(`${m.id}|${a.filename}`);
        if (!done) fresh++;
        return `<label class="item ${done ? 'faded' : ''}"><input type="checkbox" class="tick" name="pick" value="${mi}:${ai}" ${done ? 'disabled' : 'checked'}>
          <span class="grow"><div class="t">${esc(a.filename)}</div><div class="s">${esc(m.date)} · ${esc(m.from)} · ${esc(m.subject)}</div></span>
          ${done ? '<span class="badge ok">Pehle se hai</span>' : `<span class="badge">${Math.max(1, Math.round(a.size / 1024))} KB</span>`}</label>`;
      }).join('')).join('')}</div>
      ${fresh ? `<div class="row ask-bar"><button class="btn primary" id="gm-import">⬇︎ Chune hue P-Dock mein lao</button><button type="button" class="btn" id="gm-none">Sab hatao</button></div>` : '<p class="muted">Saare bills pehle se P-Dock mein hain. 👍</p>'}
    </form>`;
    $('#gm-none')?.addEventListener('click', () => box.querySelectorAll('input[name=pick]:not(:disabled)').forEach((c) => { c.checked = false; }));
    $('#gm-form').onsubmit = async (e) => {
      e.preventDefault();
      const picks = [...box.querySelectorAll('input[name=pick]:checked')].map((c) => c.value.split(':').map(Number));
      if (!picks.length) { toast('Kuch chuna nahi'); return; }
      const { downloadAttachment } = await import('./gmail.js');
      const btn = $('#gm-import');
      btn.disabled = true;
      let n = 0;
      for (const [mi, ai] of picks) {
        const m = gmailResults[mi];
        const a = m.attachments[ai];
        btn.textContent = `Laa raha hoon… ${++n}/${picks.length}`;
        try {
          const bytes = await downloadAttachment(m.id, a.attachmentId);
          await addDocument(bytes, a.filename, a.mimeType, { gmail: m.id, subject: m.subject.slice(0, 150), from: m.from.slice(0, 80), date: m.date });
          S().gmail_seen[m.id] = M.nowIso().slice(0, 10);
        } catch (x) { toast(`${a.filename}: ${x.message}`); }
      }
      V.audit('gmail_import', `${n} files`);
      await V.save();
      toast(`${n} bills aa gaye — ab padh raha hoon`);
      location.hash = '#/docs';
    };
  };

  $('#gm-scan').onclick = async () => {
    try {
      if (!hasToken(SCOPE_GMAIL)) await drive.connect({ gmail: true, calendar: S().settings.calendar_sync });
      const { findBills } = await import('./gmail.js');
      $('#gm-scan').disabled = true;
      gmailResults = await findBills({
        days: Number($('#gm-days').value),
        onProgress: (i, n) => { $('#gm-progress').textContent = `Mail dekh raha hoon… ${i}/${n}`; },
      });
      $('#gm-progress').textContent = `${gmailResults.length} mail mile jinmein bill/document hai.`;
      V.audit('gmail_scan', `${gmailResults.length} mail`);
      drawResults();
    } catch (x) {
      toast(x.message);
      $('#gm-progress').textContent = '';
    } finally {
      const b = $('#gm-scan');
      if (b) b.disabled = false;
    }
  };
  drawResults();
}

// =====================================================================
// ABOUT ME
// =====================================================================
function sourceLabel(src) {
  if (!src) return '';
  if (src.kind === 'doc') return S().docs[src.id] && !S().docs[src.id].deleted ? `<a href="#/doc/${esc(src.id)}">📄 ${esc(src.label)}</a>` : `📄 ${esc(src.label)}`;
  if (src.kind === 'gmail') return `📧 ${esc(src.label)}`;
  if (src.kind === 'manual') return '✍️ Aapne likha';
  return `💬 ${esc(src.label || 'Chat')}`;
}

function renderMe() {
  const s = S();
  const view_ = F.profileView(s);
  const items = Object.values(view_);
  const total = items.reduce((t, it) => t + it.values.length, 0);
  const conflicts = items.filter((it) => it.conflicts.length).length;
  const factRow = (it, f) => `
    <div class="fact">
      <div class="fact-main"><div class="fact-label">${esc(it.label)}${f.confirmed ? ' <span class="badge ok">✓ pakka</span>' : ''}</div>
        <div class="fact-value">${esc(f.value)}</div>
        <div class="fact-src">${(f.sources || []).slice(-3).map(sourceLabel).join(' · ')}</div></div>
      <div class="fact-actions"><button class="btn small" data-copy="${esc(f.value)}" title="Copy">📋</button>
        <button class="btn small danger" data-reject="${esc(f.id)}" title="Galat hai">✕</button></div>
    </div>`;
  view.innerHTML = `
    <div class="head"><h2>🪪 Mera Profile</h2>${total ? '<button class="btn" id="copy-all">📋 Sab copy karo</button>' : ''}</div>
    <p class="muted">Documents, bills, Gmail aur aapki baaton se P-Dock yeh jaankari <strong>apne aap</strong> ikattha karta hai — form bharte waqt 📋 dabao aur paste karo.
    ${total ? `Abhi ${total} jaankari${conflicts ? ` · <span class="warn-text">${conflicts} jagah alag-alag value mili — sahi wali chuno</span>` : ''}.` : ''}</p>
    ${!total ? '<div class="card"><p>Abhi profile khaali hai. Aadhaar, PAN, DL jaise documents daalo, ya chat mein batao ("mera blood group B+ hai") — P-Dock khud bhar dega.</p></div>' : ''}
    <div class="stack">
    ${F.GROUPS.map(([g, title]) => {
      const list = items.filter((it) => it.group === g);
      if (!list.length) return '';
      return `<div class="card sect"><h3>${esc(title)}</h3>${list.map((it) => `
        ${it.values.map((f) => factRow(it, f)).join('')}
        ${it.conflicts.length ? `<div class="conflict">⚠️ ${esc(it.label)} — alag value bhi mili:
          ${it.conflicts.map((c) => `<div class="row wrap"><span>${esc(c.value)}</span><span class="fact-src">${(c.sources || []).slice(-2).map(sourceLabel).join(' · ')}</span>
            <button class="btn small" data-confirm="${esc(c.id)}">Yeh sahi hai</button><button class="btn small" data-confirm="${esc(it.values[0].id)}">Upar wala sahi</button></div>`).join('')}</div>` : ''}`).join('')}</div>`;
    }).join('')}
    </div>

    <form class="card stack spaced-top" id="fact-form">
      <h3>+ Khud jodo</h3>
      <div class="grid2"><select name="key">${Object.entries(F.FACT_KEYS).map(([k, [label]]) => `<option value="${k}">${esc(label)}</option>`).join('')}</select>
      <input name="value" placeholder="Value" required maxlength="300"></div>
      <div><button class="btn primary">Jodo</button></div>
    </form>

    <form class="card stack spaced-top" id="me-form">
      <h3>📝 Aur baatein (khud likho)</h3>
      <p class="muted">Jo kahin documents mein nahi — pasand/napasand, aadatein, family ki baatein. AI har jawab mein inhe dhyaan rakhega.</p>
      <textarea name="text" rows="8" placeholder="Jaise: Beti: <naam>, 6 saal · Chai bina cheeni · Har Sunday mandir">${esc(s.profile.text)}</textarea>
      <div><button class="btn primary">Save</button></div>
    </form>`;

  view.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copy ho gaya'))));
  $('#copy-all')?.addEventListener('click', () => navigator.clipboard.writeText(F.profileText(S())).then(() => toast('Poora profile copy ho gaya')));
  view.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = async () => {
    F.rejectFact(S(), b.dataset.reject);
    V.audit('fact_rejected');
    await V.save();
    renderMe();
  }));
  view.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = async () => {
    F.confirmFact(S(), b.dataset.confirm);
    V.audit('fact_confirmed');
    await V.save();
    toast('Pakka kar diya');
    renderMe();
  }));
  $('#fact-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = F.addFact(S(), { key: e.target.key.value, value: e.target.value.value, source: { kind: 'manual', id: null, label: 'Aapne likha' }, observed_at: M.nowIso().slice(0, 10) });
    if (f) F.confirmFact(S(), f.id);
    V.audit('fact_added');
    await V.save();
    toast('Jod diya');
    renderMe();
  };
  $('#me-form').onsubmit = async (e) => {
    e.preventDefault();
    S().profile = { text: e.target.text.value.slice(0, 20000), updated_at: M.nowIso() };
    V.audit('profile_edit');
    await V.save();
    toast('Save ho gaya');
  };
}

// =====================================================================
// SETTINGS
// =====================================================================
const AUDIT_LABEL = {
  vault_created: 'Vault bana', unlock: 'Khola', document_upload: 'Document upload', document_view: 'Document dekha',
  document_download: 'Download', document_edit: 'Document edit', document_delete: 'Document delete', note_create: 'Yaad save',
  note_delete: 'Yaad hatai', profile_edit: 'Profile edit', ask: 'Sawaal poochha', password_changed: 'Password badla',
  passkey_added: 'Face ID joda', passkey_removed: 'Face ID hataya', recovery_code_changed: 'Naya recovery code',
  gmail_scan: 'Gmail mein bills dhoondhe', gmail_import: 'Gmail se bills laaye', gmail_auto: 'Gmail apne aap dekha',
  profile_learned: 'Profile mein jaankari judi', fact_confirmed: 'Profile: sahi maana', fact_rejected: 'Profile: galat hataya', fact_added: 'Profile: haath se joda',
  settings_changed: 'Settings badli',
};

async function renderSettings() {
  const s = S();
  const header = V.getHeader();
  const mode = await V.getMode();
  const bioOk = await PK.passkeySupported();
  view.innerHTML = `
    <div class="head"><h2>Settings</h2><div class="row"><button class="btn" id="theme">🌓 Theme</button><button class="btn" id="lock2">🔐 Lock</button></div></div>
    <div class="stack">
      <div class="card sect">
        <h3>☁️ Google Drive</h3>
        ${mode === 'drive'
          ? `<p class="muted">Data aapke Google Drive ke ek chhupe P-Dock folder mein, encrypted. Google bhi nahi padh sakta.</p>
             <p>${drive.hasToken() ? `✅ Juda hua · last sync ${esc(ago(await V.lastSync()) || '—')}` : '⚠️ Abhi juda nahi (har baar app kholne par ek tap)'}</p>
             <div><button class="btn primary" id="sync-now">Abhi sync karo</button></div>`
          : drive.driveConfigured()
            ? '<p class="muted">Abhi data sirf is device par hai. Google Drive se jodo taaki iPhone aur Mac dono par mile, aur phone kho jaaye to bhi data bacha rahe.</p><div><button class="btn primary" id="go-drive">Google Drive se jodo</button></div>'
            : '<p class="muted">Abhi data sirf is device par hai. Google Drive ka setup baaki hai.</p>'}
      </div>

      <div class="card sect">
        <h3>📧 Gmail se bills</h3>
        <p class="muted">Mail mein aaye bills, invoices, policies, tickets ke PDF P-Dock mein. Sirf padhne ki permission — koi mail bheja ya mitaya nahi jaata.</p>
        <label class="switch"><span>Roz apne aap Gmail dekho<br><span class="muted">Din mein ek baar (jab app kholo aur Google juda ho): naye bills apne aap aa jaayenge${s.settings.ai_key ? ', aur order / booking / policy / salary jaise mails se aapki jaankari, reminders aur yaadein bhi' : '. AI key lagao to mails se aapki jaankari bhi seekhega'}. Promotions aur social mail nahi dekhe jaate.</span></span>
          <input type="checkbox" id="gm-auto" ${s.settings.gmail_auto ? 'checked' : ''}></label>
        <div class="row wrap"><a class="btn" href="#/gmail">Haath se bills chuno</a>${s.settings.gmail_auto ? `<button class="btn" id="gm-now">Abhi dekho</button><span class="muted">Last: ${esc(ago(s.settings.gmail_last_scan) || 'kabhi nahi')}</span>` : ''}</div>
      </div>

      <div class="card sect">
        <h3>⏰ Reminders</h3>
        <label class="switch"><span>Expiry dates mere Google Calendar mein daalo<br><span class="muted">4 hafte aur 1 hafte pehle phone par alert. Calendar mein sirf document ka naam jaata hai.</span></span>
          <input type="checkbox" id="cal" ${s.settings.calendar_sync ? 'checked' : ''} ${mode === 'drive' ? '' : 'disabled'}></label>
        <label class="switch"><span>Location se yaad dilao<br><span class="muted">"Delhi jaaun to yaad dilana" jaise reminder — jab aap us shehar mein app khologe. Location sirf phone ke andar check hoti hai, kahin bheji nahi jaati.</span></span>
          <input type="checkbox" id="loc" ${s.settings.location_reminders ? 'checked' : ''}></label>
        <div><button class="btn small" id="ics">📅 .ics file (iPhone Calendar ke liye)</button></div>
      </div>

      <div class="card sect">
        <h3>🤖 AI (Claude)</h3>
        <p class="muted">Key aapke encrypted vault mein rehti hai. AI ko sawaal ke saath documents ki details jaati hain (Aadhaar/PAN chhupa ke) — yeh Google/iCloud ke alawa ek teesri jagah (Anthropic) hai.</p>
        <form class="row" id="ai-form"><input name="key" type="password" placeholder="${s.settings.ai_key ? '•••••••• (set hai)' : 'sk-ant-…'}" autocomplete="off"><button class="btn">Save</button></form>
        ${s.settings.ai_key ? '<div><button class="btn small danger" id="ai-off">AI key hatao</button></div>' : ''}
        <label class="switch"><span>AI ko photo dikhao<br><span class="muted">Chalu karne par AI photo dekh kar samjhega — kiski photo hai, bill mein kya-kya hai, kapde bachchon ke hain ya bade ke, dhundhli likhai bhi. Band rehne par sirf padha hua text jaata hai (kam samajh). Chalu karne par photo Anthropic tak jaati hai.</span></span>
          <input type="checkbox" id="vision" ${s.settings.ai_vision ? 'checked' : ''}></label>
      </div>

      <div class="card sect">
        <h3>🔓 Face ID / Touch ID</h3>
        ${!bioOk ? '<p class="muted">Yeh device/browser Face ID / Touch ID support nahi karta.</p>'
          : `<p class="muted">Face ID se hi vault ki chaabi khulti hai — sirf darwaza nahi, asli taala. Password backup ke liye rahega.</p>
             <div><button class="btn primary" id="add-pk">+ Is device ka Face ID / Touch ID jodo</button></div>`}
        ${header.passkeys.length ? `<div class="list">${header.passkeys.map((p) => `<div class="item"><span class="ic">🔑</span><span class="grow"><div class="t">${esc(p.name)}</div><div class="s">Joda: ${esc(fmtDate(p.added?.slice(0, 10)))}</div></span><button class="btn small danger" data-pk="${esc(p.id)}">Hatao</button></div>`).join('')}</div>` : ''}
      </div>

      <div class="card sect">
        <h3>🔒 Suraksha</h3>
        <form class="row" id="owner-form"><input name="name" value="${esc(header.owner || '')}" placeholder="Aapka naam" required><button class="btn">Naam save</button></form>
        <p class="muted">Lock screen par: "Yeh ${esc(header.owner || '…')} ka P-Dock hai. Main sirf ${esc(header.owner || '…')} ya mere boss ko bataunga."</p>
        <div class="row wrap"><button class="btn" id="chg-pw">Password badlo</button><button class="btn" id="new-rc">Naya recovery code</button></div>
        <ul class="points">
          <li>Har cheez device par hi encrypt hoti hai (AES-256), phir Google Drive jaati hai.</li>
          <li>10 minute kuch na karo, ya app 3 minute band rahe, to apne aap lock.</li>
          <li>Password + recovery code dono kho gaye to data koi nahi khol sakta.</li>
        </ul>
        <div><button class="btn danger small" id="forget">Is device se P-Dock hatao</button></div>
      </div>

      <h3 class="section-h">Activity log</h3>
      <div class="card"><table class="audit">${[...s.audit].reverse().slice(0, 200).map((r) => `<tr><td>${esc(new Date(r.ts).toLocaleString('en-IN'))}</td>
        <td>${esc(AUDIT_LABEL[r.action] || r.action)} <span class="muted">${esc(r.detail || '')} · ${esc(r.device || '')}</span></td></tr>`).join('')}</table></div>
    </div>`;

  const settingsChanged = async (patch) => {
    s.settings = { ...s.settings, ...patch, updated_at: M.nowIso() };
    V.audit('settings_changed', Object.keys(patch).filter((k) => k !== 'ai_key').join(', ') || 'AI key');
    await V.save();
  };

  $('#lock2').onclick = doLock;
  $('#sync-now')?.addEventListener('click', syncNow);
  $('#go-drive')?.addEventListener('click', async () => {
    try {
      await drive.connect();
      await V.setMode('drive');
      await V.sync();
      toast('Google Drive se jud gaya');
      renderSettings();
    } catch (e) { toast(e.message); }
  });
  $('#cal').onchange = async (e) => {
    try {
      if (e.target.checked) await drive.connect({ calendar: true });
      await settingsChanged({ calendar_sync: e.target.checked });
      if (e.target.checked) { await V.sync(); toast('Reminders Google Calendar mein jud gaye'); }
    } catch (x) { e.target.checked = false; toast(x.message); }
  };
  $('#ics').onclick = () => download(icsFile(s), 'pdock-reminders.ics');
  $('#gm-auto').onchange = async (e) => {
    try {
      if (e.target.checked && !drive.hasToken(drive.SCOPE_GMAIL)) await drive.connect({ gmail: true, calendar: s.settings.calendar_sync });
      await settingsChanged({ gmail_auto: e.target.checked });
      if (e.target.checked) { toast('Gmail dekh raha hoon…'); await autoGmail(true); }
      renderSettings();
    } catch (x) { e.target.checked = false; toast(x.message); }
  };
  $('#gm-now')?.addEventListener('click', async () => {
    try {
      if (!drive.hasToken(drive.SCOPE_GMAIL)) await drive.connect({ gmail: true, calendar: s.settings.calendar_sync });
      toast('Gmail dekh raha hoon…');
      await autoGmail(true);
      renderSettings();
    } catch (x) { toast(x.message); }
  });
  $('#loc').onchange = async (e) => {
    if (e.target.checked) {
      try { await P.currentPosition(); } catch (x) { e.target.checked = false; toast(x.message); return; }
    }
    await settingsChanged({ location_reminders: e.target.checked });
    if (e.target.checked) { checkPlaces(true); toast('Location reminders chalu'); }
  };
  $('#ai-form').onsubmit = async (e) => {
    e.preventDefault();
    const key = e.target.key.value.trim();
    if (!/^sk-ant-/.test(key)) { toast('Yeh Claude ki key nahi lagti (sk-ant- se shuru hoti hai)'); return; }
    await settingsChanged({ ai_key: key });
    toast('AI chalu ho gaya');
    renderSettings();
  };
  $('#ai-off')?.addEventListener('click', async () => { await settingsChanged({ ai_key: '' }); renderSettings(); });
  $('#vision').onchange = (e) => settingsChanged({ ai_vision: e.target.checked });

  $('#add-pk')?.addEventListener('click', async () => {
    try {
      const r = await PK.register(header.owner);
      await V.addPasskey({ id: r.id, name: V.device(), prfOutput: r.prfOutput });
      toast('Face ID / Touch ID jud gaya 🎉');
      renderSettings();
    } catch (x) { toast(x.name === 'NotAllowedError' ? 'Cancel ho gaya' : x.name === 'InvalidStateError' ? 'Yeh device pehle se juda hai' : x.message); }
  });
  view.querySelectorAll('[data-pk]').forEach((b) => (b.onclick = async () => {
    if (!(await ask({ title: 'Yeh Face ID hata dein?', body: 'Is device se phir Face ID se nahi khulega (password se khulega).', okText: 'Hatao', danger: true }))) return;
    await V.removePasskey(b.dataset.pk);
    renderSettings();
  }));
  $('#owner-form').onsubmit = async (e) => { e.preventDefault(); await V.setOwner(e.target.name.value.trim().slice(0, 40)); toast('Save ho gaya'); renderSettings(); };
  $('#chg-pw').onclick = async () => {
    const pw = await ask({ title: 'Naya password', body: 'Kam se kam 8 akshar.', input: { type: 'password', autocomplete: 'new-password' }, okText: 'Aage' });
    if (!pw) return;
    if (pw.length < 8) { toast('Kam se kam 8 akshar'); return; }
    const pw2 = await ask({ title: 'Naya password dobara', input: { type: 'password', autocomplete: 'new-password' }, okText: 'Badlo' });
    if (pw2 !== pw) { toast('Dono password alag hain'); return; }
    await V.changePassword(pw);
    toast('Password badal gaya');
  };
  $('#new-rc').onclick = async () => {
    if (!(await ask({ title: 'Naya recovery code banayein?', body: 'Purana code kaam karna band kar dega.', okText: 'Banao' }))) return;
    const code = await V.newRecoveryCode();
    showRecovery(code, showApp);
  };
  $('#forget').onclick = async () => {
    const msg = mode === 'drive' ? 'Is device se sab mit jaayega. Google Drive mein data bacha rahega — password se wapas aa jaayega.'
      : '⚠️ Data sirf is device par hai — yeh sab hamesha ke liye mit jaayega!';
    if (!(await ask({ title: 'Is device se hatao?', body: msg, okText: 'Hatao', danger: true }))) return;
    await V.forgetDevice();
    showWelcome();
  };
  $('#theme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('pdock-theme', next); } catch {}
    toast(next ? `${next} theme` : 'System theme');
  };
}

// ---------- start ----------
try { const t = localStorage.getItem('pdock-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot().catch((e) => showGate(`<p class="error">${esc(e.message)}</p>`));
