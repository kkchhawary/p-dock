// Bina AI ke basic samajh: document type, dates, aur sensitive numbers ki masking.

export const DOC_TYPES = {
  aadhaar: { label: 'Aadhaar', category: 'identity' },
  pan: { label: 'PAN Card', category: 'identity' },
  driving_licence: { label: 'Driving Licence', category: 'identity' },
  passport: { label: 'Passport', category: 'identity' },
  voter_id: { label: 'Voter ID', category: 'identity' },
  vehicle_rc: { label: 'Vehicle RC', category: 'vehicle' },
  vehicle_service: { label: 'Vehicle Service', category: 'vehicle' },
  fuel: { label: 'Petrol / Fuel', category: 'vehicle' },
  puc: { label: 'PUC Certificate', category: 'vehicle' },
  insurance: { label: 'Insurance', category: 'insurance' },
  marksheet: { label: 'Marksheet', category: 'education' },
  certificate: { label: 'Certificate', category: 'education' },
  bill: { label: 'Bill / Invoice', category: 'finance' },
  bank: { label: 'Bank Document', category: 'finance' },
  tax: { label: 'Tax Document', category: 'finance' },
  medical: { label: 'Medical', category: 'health' },
  property: { label: 'Property / Rent', category: 'property' },
  warranty: { label: 'Warranty', category: 'finance' },
  photo: { label: 'Photo', category: 'photos' },
  other: { label: 'Other', category: 'other' },
};

const RULES = [
  ['aadhaar', /aadhaar|unique identification authority|आधार/i],
  ['pan', /permanent account number|income tax department.*\b[A-Z]{5}\d{4}[A-Z]\b/is],
  ['driving_licence', /driving licen[cs]e|\bDL\s*No\b|transport department/i],
  ['passport', /\bpassport\b|republic of india.*P<IND/is],
  ['voter_id', /election commission|elector'?s photo identity/i],
  ['vehicle_rc', /registration certificate|\bchassis\b.*\bengine\b/is],
  ['vehicle_service', /\b(job card|service invoice|odometer|kms? reading|next service)\b/i],
  ['puc', /pollution under control|\bPUC\b/i],
  ['fuel', /\b(petrol|diesel|fuel|HSD|MS)\b.*\b(litre|ltr|rate|nozzle|pump)\b|\b(indian oil|bharat petroleum|hindustan petroleum|HPCL|BPCL|IOCL)\b/is],
  ['insurance', /\b(policy (no|number)|insured|premium|insurance)\b/i],
  ['marksheet', /\b(marks? ?sheet|statement of marks|grade sheet|cbse|board of secondary)\b/i],
  ['medical', /\b(prescription|diagnosis|patient|hospital|pathology|\bRx\b|lab report)\b/i],
  ['tax', /\b(form 16|itr|income tax return|gstin)\b/i],
  ['bank', /\b(bank statement|ifsc|account statement|passbook)\b/i],
  ['warranty', /\bwarranty\b/i],
  ['property', /\b(rent agreement|sale deed|lease)\b/i],
  ['bill', /\b(invoice|bill (no|date|amount)|amount due|total amount|grand total|electricity bill)\b/i],
  ['certificate', /\bcertificate\b/i],
];

// Pehle heading (shuru ki lines) dekho — DL mein "Aadhaar" likha ho to bhi woh DL hi hai
// Heading (shuru ki lines) mein jo type sabse pehle likha hai, wahi — DL mein "Aadhaar" bhi likha ho to woh DL hi hai
const squash = (t) => String(t || '').replace(/[ \t]+/g, ' ');

export function guessType(text) {
  text = squash(text);
  const head = String(text).split('\n').slice(0, 6).join('\n');
  let best = null;
  for (const [type, re] of RULES) {
    const i = head.search(re);
    if (i >= 0 && (!best || i < best.i)) best = { type, i };
  }
  if (best) return best.type;
  for (const [type, re] of RULES) if (re.test(text)) return type;
  return 'other';
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toIso(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Indian format pehle: DD/MM/YYYY, DD-MM-YYYY, DD Mon YYYY, YYYY-MM-DD
export function findDates(text) {
  const out = [];
  const re = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    let iso = null;
    if (m[1]) iso = toIso(m[3], m[2], m[1]);
    else if (m[4]) iso = toIso(m[4], m[5], m[6]);
    else if (m[7] && MONTHS[m[8].toLowerCase()]) iso = toIso(m[9], MONTHS[m[8].toLowerCase()], m[7]);
    if (iso) out.push({ iso, index: m.index });
  }
  return out;
}

const EXPIRY_HINT = /(valid\s*(till|upto|up to|until|thru)|expir\w*|date of expiry|valid to|renewal date|policy end|end date|NT\s*:|validity)/gi;

export function guessExpiry(text) {
  text = squash(text);
  const dates = findDates(text);
  if (!dates.length) return null;
  let best = null;
  let m;
  EXPIRY_HINT.lastIndex = 0;
  while ((m = EXPIRY_HINT.exec(text))) {
    const after = dates.find((d) => d.index >= m.index && d.index - m.index < 80);
    if (after && (!best || after.iso > best)) best = after.iso;
  }
  return best;
}

// AI ko bhejne se pehle Aadhaar aur PAN numbers chhupa do (last 4 dikhte hain)
export function maskSensitive(text) {
  return String(text || '')
    .replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, (_, a, b, c) => `XXXX XXXX ${c}`)
    .replace(/\b[A-Z]{5}(\d{4})[A-Z]\b/g, (_, d) => `XXXXX${d}X`);
}

export function heuristicExtract(text, fileName) {
  const doc_type = guessType(text);
  const title = DOC_TYPES[doc_type] && doc_type !== 'other'
    ? DOC_TYPES[doc_type].label
    : fileName.replace(/\.[^.]+$/, '');
  return {
    title,
    doc_type,
    category: DOC_TYPES[doc_type].category,
    expiry_date: guessExpiry(text),
    issue_date: null,
    summary: '',
    fields: [],
    tags: [],
    owner: '',
  };
}
