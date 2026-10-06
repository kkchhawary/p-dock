// Data model + merge. Poora vault ek encrypted "index" hai; har document ki file alag encrypted blob.
// Do devices (iPhone, Mac) alag-alag badlav karein to merge() dono ko jod deta hai:
// har record ka jo version naya (updated_at) hai woh jeetta hai; delete bhi ek "tombstone" record hai.

export const nowIso = () => new Date().toISOString();

export function newId() {
  const rand = [...globalThis.crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return Date.now().toString(36) + rand;
}

export function emptyState() {
  return {
    v: 1,
    docs: {},
    notes: {},
    reminders: {}, // { text, due_date, place: {name, lat, lon}, done }
    money: {}, // udhaar: { direction: 'lent'|'borrowed', person, amount, date, due_date, phone, note, settled }
    people: {}, // { name, phone, relation }
    facts: {}, // "Mera Profile": { key, value, sources[], observed_at, confirmed, rejected }
    gmail_seen: {}, // Gmail message id → din (dobara process na ho)
    profile: { text: '', updated_at: '' },
    settings: { owner_name: '', ai_key: '', ai_vision: false, calendar_sync: false, location_reminders: false, gmail_auto: false, gmail_last_scan: '', updated_at: '' },
    audit: [],
  };
}

// Naya version jeetta hai. Barabar time par: delete jeetta hai, phir ek fixed niyam (taaki dono devices same nateeja dein)
function newer(a, b) {
  const ta = a?.updated_at || '';
  const tb = b?.updated_at || '';
  if (ta !== tb) return ta > tb ? a : b;
  if (Boolean(a?.deleted) !== Boolean(b?.deleted)) return a?.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

// Pichhle version se hamesha aage ka time (ek hi millisecond mein do badlav ho to bhi)
function stamp(prev) {
  const now = Date.now();
  const last = prev?.updated_at ? Date.parse(prev.updated_at) : 0;
  return new Date(Math.max(now, last + 1)).toISOString();
}

function mergeRecords(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[id] = !a[id] ? b[id] : !b[id] ? a[id] : newer(a[id], b[id]);
  }
  return out;
}

export const AUDIT_LIMIT = 500;

export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const audit = new Map();
  for (const e of [...(a.audit || []), ...(b.audit || [])]) audit.set(e.id, e);
  return {
    v: 1,
    docs: mergeRecords(a.docs, b.docs),
    notes: mergeRecords(a.notes, b.notes),
    reminders: mergeRecords(a.reminders, b.reminders),
    money: mergeRecords(a.money, b.money),
    people: mergeRecords(a.people, b.people),
    facts: mergeRecords(a.facts, b.facts),
    gmail_seen: { ...(a.gmail_seen || {}), ...(b.gmail_seen || {}) },
    profile: newer(a.profile, b.profile),
    settings: newer(a.settings, b.settings),
    audit: [...audit.values()].sort((x, y) => (x.ts < y.ts ? -1 : 1)).slice(-AUDIT_LIMIT),
  };
}

// Purane vault (naye collections se pehle ke) ko naye dhaanche mein laao
export function normalize(s) {
  const base = emptyState();
  for (const k of ['docs', 'notes', 'reminders', 'money', 'people', 'facts', 'gmail_seen']) s[k] ||= {};
  s.settings = { ...base.settings, ...s.settings };
  s.profile ||= base.profile;
  s.audit ||= [];
  return s;
}

// ---------- helpers (state ko seedha badalte hain) ----------
export const liveDocs = (s) => Object.values(s.docs).filter((d) => !d.deleted).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
export const liveNotes = (s) => Object.values(s.notes).filter((n) => !n.deleted).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));

export function addAudit(s, action, detail = '', device = '') {
  s.audit.push({ id: newId(), ts: nowIso(), action, detail: String(detail || ''), device });
  if (s.audit.length > AUDIT_LIMIT) s.audit.splice(0, s.audit.length - AUDIT_LIMIT);
}

export function putDoc(s, doc) {
  s.docs[doc.id] = { ...doc, updated_at: stamp(s.docs[doc.id]) };
  return s.docs[doc.id];
}

export function deleteDoc(s, id) {
  const d = s.docs[id];
  if (!d) return;
  // Tombstone: sirf id + title (audit ke liye) bachta hai, baaki sab mit jaata hai
  s.docs[id] = { id, deleted: true, title: d.title, created_at: d.created_at, updated_at: stamp(d) };
}

export function addNote(s, text, event_date = null) {
  const n = { id: newId(), text, event_date, created_at: nowIso(), updated_at: nowIso() };
  s.notes[n.id] = n;
  return n;
}

export function deleteNote(s, id) {
  const n = s.notes[id];
  if (!n) return;
  s.notes[id] = { id, deleted: true, created_at: n.created_at, updated_at: stamp(n) };
}

// ---------- search (keyword) ----------
const norm = (x) => String(x || '').toLowerCase();
export const tokenize = (q) => norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

export function search(s, q, limit = 20) {
  const words = tokenize(q);
  if (!words.length) return [];
  const results = [];
  for (const d of liveDocs(s)) {
    const head = norm([d.title, d.doc_type, d.category, d.owner, (d.tags || []).join(' ')].join(' '));
    const body = norm([d.summary, (d.fields || []).map((f) => `${f.label} ${f.value}`).join(' '), d.ocr_text].join(' '));
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 3;
      if (body.includes(w)) score += 1;
    }
    if (score) results.push({ kind: 'doc', id: d.id, score, item: d });
  }
  for (const n of liveNotes(s)) {
    const t = norm(n.text);
    const score = words.reduce((acc, w) => acc + (t.includes(w) ? 2 : 0), 0);
    if (score) results.push({ kind: 'note', id: n.id, score, item: n });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function upcomingExpiries(s, days = 90) {
  const until = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return liveDocs(s).filter((d) => d.expiry_date && d.expiry_date <= until).sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1));
}

// ---------- reminders, udhaar, log (sab ek hi tarah: put / delete) ----------
const live = (coll) => Object.values(coll || {}).filter((x) => !x.deleted);

export function putRecord(s, coll, rec) {
  s[coll] ||= {};
  const prev = s[coll][rec.id];
  s[coll][rec.id] = { created_at: prev?.created_at || nowIso(), ...prev, ...rec, updated_at: stamp(prev) };
  return s[coll][rec.id];
}

export function deleteRecord(s, coll, id) {
  const r = s[coll]?.[id];
  if (!r) return;
  // Calendar event id bachao taaki sync use Google Calendar se bhi mita sake
  s[coll][id] = { id, deleted: true, created_at: r.created_at, calendar_event_id: r.calendar_event_id || null, updated_at: stamp(r) };
}

export const liveReminders = (s) => live(s.reminders).sort((a, b) => (Number(!!a.done) - Number(!!b.done)) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
export const liveMoney = (s) => live(s.money).sort((a, b) => (Number(!!a.settled) - Number(!!b.settled)) || String(b.date || '').localeCompare(String(a.date || '')));
export const livePeople = (s) => live(s.people).sort((a, b) => a.name.localeCompare(b.name));

export function findPerson(s, name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? livePeople(s).find((p) => p.name.toLowerCase() === n) : null;
}

// Kiske paas kitna baaki (lent = unhe dena hai mujhe, borrowed = mujhe dena hai unhe)
export function moneySummary(s) {
  const open = liveMoney(s).filter((m) => !m.settled);
  const sum = (dir) => open.filter((m) => m.direction === dir).reduce((t, m) => t + (Number(m.amount) || 0), 0);
  return { toReceive: sum('lent'), toPay: sum('borrowed'), open };
}

// Aaj tak jo karna/milna hai: due reminders, due udhaar, aur docs ke sawaal
export function attentionItems(s, today = nowIso().slice(0, 10), soonDays = 3) {
  const soon = new Date(Date.parse(today + 'T00:00:00Z') + soonDays * 864e5).toISOString().slice(0, 10);
  return {
    reminders: liveReminders(s).filter((r) => !r.done && r.due_date && r.due_date <= soon),
    money: liveMoney(s).filter((m) => !m.settled && m.due_date && m.due_date <= soon),
    questions: liveDocs(s).filter((d) => (d.questions || []).length),
  };
}
