// Gmail se bills: mail ke andar se sahi attachments nikalna.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const G = await import('../app/js/gmail.js');

const msg = {
  id: 'm1',
  internalDate: String(Date.parse('2026-09-05T10:00:00Z')),
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'Your Airtel bill for Sep 2026' }, { name: 'From', value: '"Airtel" <ebill@airtel.com>' }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { size: 900 } }, { mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'logo', size: 4000 } }] },
      { mimeType: 'application/pdf', filename: 'Airtel_Bill_Sep.pdf', body: { attachmentId: 'a1', size: 120000 } },
      { mimeType: 'application/octet-stream', filename: 'Receipt.PDF', body: { attachmentId: 'a2', size: 50000 } },
      { mimeType: 'image/jpeg', filename: 'scan.jpg', body: { attachmentId: 'a3', size: 400000 } },
      { mimeType: 'application/zip', filename: 'data.zip', body: { attachmentId: 'a4', size: 9000 } },
    ],
  },
};

test('mail se bill ke PDF/photo nikalte hain; logo aur zip nahi', () => {
  const s = G.summarizeMessage(msg);
  assert.equal(s.subject, 'Your Airtel bill for Sep 2026');
  assert.equal(s.from, 'Airtel');
  assert.equal(s.date, '2026-09-05');
  assert.deepEqual(s.attachments.map((a) => [a.filename, a.mimeType]), [
    ['Airtel_Bill_Sep.pdf', 'application/pdf'],
    ['Receipt.PDF', 'application/pdf'],
    ['scan.jpg', 'image/jpeg'],
  ]);
});

test('search sirf bills wale mail, spam/trash nahi, din ke hisaab se', () => {
  const q = G.buildQuery(90);
  assert.match(q, /has:attachment/);
  assert.match(q, /newer_than:90d/);
  assert.match(q, /-in:spam -in:trash/);
  assert.match(q, /invoice/);
});

test('attachment ka base64url data sahi bytes banta hai', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x3e]);
  const b64url = Buffer.from(bytes).toString('base64url');
  assert.deepEqual(G.decodeBase64Url(b64url), bytes);
});

test('sirf padhne ki permission maangi jaati hai', () => {
  assert.equal(G.SCOPE_GMAIL, 'https://www.googleapis.com/auth/gmail.readonly');
});
