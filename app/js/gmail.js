// Gmail se bills: sirf PADHNE ki permission (gmail.readonly). Mail bhejna/mitana kabhi nahi.
// Sab kuch browser ke andar — mail kisi aur server par nahi jaate.
// Sirf bill/invoice/receipt jaise mail dhoondhe jaate hain, aur sirf unke PDF/photo attachment.
import { gfetch, SCOPE_GMAIL } from './drive.js';

export { SCOPE_GMAIL };
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const KEYWORDS = ['bill', 'invoice', 'receipt', 'statement', 'policy', '"tax invoice"', 'e-bill', 'ebill', 'ticket', 'challan', 'premium', 'certificate', 'payment'];
const ATTACH_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function buildQuery(days = 365) {
  return `has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) (${KEYWORDS.join(' OR ')}) newer_than:${Math.round(days)}d -in:chats -in:spam -in:trash`;
}

const header = (payload, name) => payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

// Mail ke andar ke saare attachments (nested parts bhi)
export function findAttachments(payload) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const name = part.filename || '';
    const looksPdf = mime === 'application/octet-stream' && /\.pdf$/i.test(name);
    if (name && part.body?.attachmentId && (ATTACH_TYPES.includes(mime) || looksPdf)) {
      // Chhote images (logo, signature) chhod do
      if (!(mime.startsWith('image/') && (part.body.size || 0) < 30_000)) {
        out.push({ attachmentId: part.body.attachmentId, filename: name, mimeType: looksPdf ? 'application/pdf' : mime, size: part.body.size || 0 });
      }
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

export function summarizeMessage(msg) {
  return {
    id: msg.id,
    subject: header(msg.payload, 'Subject') || '(bina subject)',
    from: header(msg.payload, 'From').replace(/<[^>]+>/, '').replace(/"/g, '').trim(),
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString().slice(0, 10) : '',
    attachments: findAttachments(msg.payload),
  };
}

export function decodeBase64Url(data) {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Bills wale mail dhoondo → [{ id, subject, from, date, attachments }]
export async function findBills({ days = 365, max = 60, onProgress } = {}) {
  const q = new URLSearchParams({ q: buildQuery(days), maxResults: String(max) });
  const list = await (await gfetch(`${API}/messages?${q}`)).json();
  const ids = (list.messages || []).map((m) => m.id);
  const results = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i + 1, ids.length);
    const fields = 'id,internalDate,payload(headers,filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size)))))';
    const msg = await (await gfetch(`${API}/messages/${ids[i]}?format=full&fields=${encodeURIComponent(fields)}`)).json();
    const s = summarizeMessage(msg);
    if (s.attachments.length) results.push(s);
  }
  return results;
}

export async function downloadAttachment(messageId, attachmentId) {
  const data = await (await gfetch(`${API}/messages/${messageId}/attachments/${attachmentId}`)).json();
  return decodeBase64Url(data.data);
}

// ---------- mail se seekhna (AI ke saath) ----------
const LEARN_WORDS = ['order', 'booking', 'booked', 'ticket', 'invoice', 'receipt', 'policy', 'premium', 'salary', 'payslip', 'appointment',
  'report', 'statement', 'confirmed', 'delivered', 'registration', 'admission', 'renewal', 'due', 'PNR', 'itinerary', 'prescription'];

export function buildLearnQuery(days = 30) {
  return `newer_than:${Math.round(days)}d (${LEARN_WORDS.join(' OR ')}) -category:promotions -category:social -category:forums -in:chats -in:spam -in:trash`;
}

export async function listMessageIds(query, max = 25) {
  const q = new URLSearchParams({ q: query, maxResults: String(max) });
  const list = await (await gfetch(`${API}/messages?${q}`)).json();
  return (list.messages || []).map((m) => m.id);
}

// HTML ko saaf text mein (script/style hata ke)
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function bodyText(payload) {
  let plain = '';
  let html = '';
  const dec = new TextDecoder();
  const walk = (p) => {
    if (!p) return;
    if (p.body?.data) {
      const text = dec.decode(decodeBase64Url(p.body.data));
      if (p.mimeType === 'text/plain' && !plain) plain = text;
      else if (p.mimeType === 'text/html' && !html) html = text;
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return (plain || htmlToText(html)).slice(0, 12000);
}

export async function readMessage(id) {
  const msg = await (await gfetch(`${API}/messages/${id}?format=full`)).json();
  return { ...summarizeMessage(msg), text: bodyText(msg.payload) };
}
