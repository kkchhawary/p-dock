// "Mera Profile": har document, bill, mail aur baat se aapke baare mein jaankari apne aap ikattha.
// Har jaankari ke saath source (kahan se mili). Takraar ho to chupke se overwrite nahi — dono dikhte hain.
import * as M from './model.js';

// key → [label, group, multi?]
export const FACT_KEYS = {
  full_name: ['Poora naam', 'pehchaan'],
  dob: ['Janm tithi', 'pehchaan'],
  gender: ['Ling', 'pehchaan'],
  father_name: ['Pita ka naam', 'pehchaan'],
  mother_name: ['Maa ka naam', 'pehchaan'],
  spouse_name: ['Pati / Patni', 'pehchaan'],
  marital_status: ['Vaivahik sthiti', 'pehchaan'],
  religion: ['Dharm', 'pehchaan'],
  category: ['Category (Gen/OBC/SC/ST)', 'pehchaan'],
  nationality: ['Nationality', 'pehchaan'],
  phone: ['Mobile', 'sampark', true],
  email: ['Email', 'sampark', true],
  address: ['Pata (abhi ka)', 'sampark'],
  permanent_address: ['Pata (sthayi)', 'sampark'],
  pan: ['PAN', 'number'],
  aadhaar: ['Aadhaar', 'number'],
  dl_number: ['Driving Licence no.', 'number'],
  passport_number: ['Passport no.', 'number'],
  voter_id: ['Voter ID', 'number'],
  vehicle_number: ['Gaadi number', 'number', true],
  bank_account: ['Bank account', 'paisa', true],
  upi_id: ['UPI ID', 'paisa', true],
  occupation: ['Kaam / Pesha', 'kaam'],
  employer: ['Company / Employer', 'kaam'],
  annual_income: ['Saalana aay', 'kaam'],
  education: ['Padhai', 'kaam', true],
  insurance_policy: ['Insurance policy', 'paisa', true],
  family_member: ['Parivaar', 'parivaar', true],
  blood_group: ['Blood group', 'health'],
  height: ['Lambai', 'health'],
  weight: ['Vazan', 'health'],
  allergy: ['Allergy', 'health', true],
  condition: ['Bimari / Condition', 'health', true],
  medicine: ['Dawai (chal rahi)', 'health', true],
  doctor: ['Doctor', 'health', true],
  other: ['Aur jaankari', 'aur', true],
};

export const GROUPS = [
  ['pehchaan', '🪪 Pehchaan'], ['sampark', '📞 Sampark'], ['number', '🔢 Zaroori number'], ['parivaar', '👨‍👩‍👧 Parivaar'],
  ['kaam', '💼 Kaam aur padhai'], ['paisa', '🏦 Bank aur insurance'], ['health', '🩺 Health'], ['aur', '📝 Aur'],
];

const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const isMasked = (v) => /X{3,}/i.test(String(v));

// Ek jaankari jodna. Same key + same value dobara aaye to sirf "kitni baar mili" badhta hai.
export function addFact(s, { key, value, source, observed_at = null }) {
  if (!FACT_KEYS[key]) key = 'other';
  value = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!value || value.length < 2) return null;
  s.facts ||= {};
  const existing = Object.values(s.facts).find((f) => !f.deleted && f.key === key && norm(f.value) === norm(value));
  // Masked number (XXXX 1234) tab hi rakho jab poora number na ho
  if (isMasked(value) && Object.values(s.facts).some((f) => !f.deleted && f.key === key && !isMasked(f.value))) return null;
  if (existing) {
    const sources = [...(existing.sources || [])];
    if (source && !sources.some((x) => x.kind === source.kind && x.id === source.id)) sources.push(source);
    return M.putRecord(s, 'facts', {
      id: existing.id, sources: sources.slice(-10),
      observed_at: [existing.observed_at, observed_at].filter(Boolean).sort().pop() || null,
    });
  }
  return M.putRecord(s, 'facts', {
    id: M.newId(), key, value, sources: source ? [source] : [], observed_at, confirmed: false, rejected: false,
  });
}

export function addFacts(s, list, source, observed_at = null) {
  let added = 0;
  for (const f of list || []) {
    if (f && addFact(s, { key: f.key, value: f.value, source, observed_at: f.observed_at || observed_at })) added++;
  }
  return added;
}

// Profile ka view: har key ke liye best value + baaki options (takraar)
export function profileView(s) {
  const byKey = {};
  for (const f of Object.values(s.facts || {})) {
    if (f.deleted || f.rejected) continue;
    (byKey[f.key] ||= []).push(f);
  }
  const score = (f) => [f.confirmed ? 1 : 0, f.observed_at || f.created_at || '', (f.sources || []).length];
  const cmp = (a, b) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? -1 : 1;
    return 0;
  };
  const out = {};
  for (const [key, list] of Object.entries(byKey)) {
    list.sort(cmp);
    const multi = Boolean(FACT_KEYS[key]?.[2]);
    out[key] = {
      key,
      label: FACT_KEYS[key]?.[0] || key,
      group: FACT_KEYS[key]?.[1] || 'aur',
      multi,
      values: multi ? list : [list[0]],
      // Single-value key par alag-alag values = takraar (jab tak aapne ek pakka na kiya ho)
      conflicts: !multi && !list[0].confirmed && list.length > 1 ? list.slice(1) : [],
    };
  }
  return out;
}

export function confirmFact(s, id) {
  const f = s.facts?.[id];
  if (!f) return;
  // Single-value key: baaki values "rejected" nahi, bas yeh jeet jaati hai
  for (const o of Object.values(s.facts)) {
    if (o.key === f.key && o.id !== id && o.confirmed && !FACT_KEYS[f.key]?.[2]) M.putRecord(s, 'facts', { id: o.id, confirmed: false });
  }
  M.putRecord(s, 'facts', { id, confirmed: true, rejected: false });
}

export const rejectFact = (s, id) => M.putRecord(s, 'facts', { id, rejected: true, confirmed: false });

// Poora profile text — AI ko context ke liye, aur "sab copy karo" ke liye
export function profileText(s, { maskIds = false } = {}) {
  const view = profileView(s);
  const lines = [];
  for (const [g, title] of GROUPS) {
    const items = Object.values(view).filter((v) => v.group === g);
    if (!items.length) continue;
    lines.push(title.replace(/^\S+\s/, '') + ':');
    for (const it of items) {
      for (const f of it.values) {
        let v = f.value;
        if (maskIds && ['aadhaar', 'pan', 'passport_number', 'bank_account'].includes(it.key)) v = v.replace(/[A-Z0-9](?=[A-Z0-9 ]{4})/gi, 'X');
        lines.push(`- ${it.label}: ${v}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------- bina AI ke: document se seedhe number/naam ----------
const DATE_RE = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/;
const toIso = (m) => (m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null);

function lineAfter(text, labelRe) {
  const m = text.match(new RegExp(`(?:${labelRe.source})\\s*[:\\-]?\\s*([^\\n]{2,60})`, 'i'));
  return m ? m[1].trim() : null;
}

// Document kiska hai? Naam owner se milta ho (ya naam hi na mile) tabhi owner ki jaankari maano
function belongsToOwner(text, ownerName) {
  const name = lineAfter(text, /\bname\b|नाम/);
  if (!name || !ownerName) return { owner: true, name };
  const first = ownerName.trim().split(/\s+/)[0].toLowerCase();
  return { owner: name.toLowerCase().includes(first), name };
}

export function localFacts(doc, ownerName = '') {
  const text = String(doc.ocr_text || '').replace(/[ \t]+/g, ' ');
  if (!text) return [];
  const t = doc.doc_type;
  const out = [];
  const add = (key, value) => value && out.push({ key, value });
  const identity = ['aadhaar', 'pan', 'driving_licence', 'passport', 'voter_id'].includes(t);
  const { owner, name } = belongsToOwner(text, ownerName);

  if (identity && owner) {
    if (name && !/father|pita/i.test(name)) add('full_name', name.replace(/[^\p{L} .]/gu, '').trim());
    add('dob', toIso(text.match(new RegExp(`(?:DOB|Date of Birth|D\\.O\\.B|जन्म तिथि|Year of Birth)[^\\d]{0,20}${DATE_RE.source}`, 'i'))));
    add('father_name', lineAfter(text, /father'?s? name|s\/o|son of|पिता/)?.replace(/[^\p{L} .]/gu, '').trim());
    add('blood_group', text.match(/blood\s*group\s*[:\-]?\s*((?:A|B|AB|O)\s*[+-](?:ve)?)/i)?.[1]?.replace(/\s/g, '').toUpperCase());
  }
  if (t === 'pan' && owner) add('pan', text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/)?.[0]);
  if (t === 'aadhaar' && owner) add('aadhaar', text.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/)?.[0]?.replace(/\s/g, '').replace(/(\d{4})(?=\d)/g, '$1 '));
  if (t === 'driving_licence' && owner) add('dl_number', lineAfter(text, /DL\s*No\.?|Licen[cs]e\s*No\.?/)?.match(/[A-Z]{2}[\s-]?\d{2}[\s-]?\d{4,11}/i)?.[0]?.toUpperCase());
  if (t === 'passport' && owner) add('passport_number', text.match(/\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/)?.[0]);
  if (['vehicle_rc', 'vehicle_service', 'insurance', 'puc', 'fuel'].includes(t)) {
    const v = text.match(/\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{4})\b/);
    if (v) add('vehicle_number', `${v[1]} ${v[2].padStart(2, '0')} ${v[3]} ${v[4]}`);
  }
  return out;
}

// AI se aaye facts: owner ke → seedhe profile; parivaar ke → "Parivaar" mein (naam/rishta ke saath)
const isOwner = (about) => !about || /^(owner|self|me|main|khud|mera|meri)$/i.test(String(about).trim());

export function ingestFacts(s, list, source, observed_at = null) {
  let added = 0;
  for (const f of list || []) {
    if (!f?.value) continue;
    if (isOwner(f.about)) {
      if (addFact(s, { key: f.key, value: f.value, source, observed_at })) added++;
    } else {
      const label = FACT_KEYS[f.key]?.[0] || '';
      const value = f.key === 'family_member' ? f.value : `${f.about}: ${label ? `${label} ` : ''}${f.value}`;
      if (addFact(s, { key: 'family_member', value, source, observed_at })) added++;
    }
  }
  return added;
}
