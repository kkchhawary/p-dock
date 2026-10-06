// Naya document: padhna (OCR) → type/expiry pehchaanna → AI se details (agar key hai).
import { readDocument, toJpegBase64 } from './ocr.js';
import { heuristicExtract } from './extract.js';
import { extractDocument } from './ai.js';

export async function processDocument({ bytes, mime, fileName, settings, profile = '', onProgress }) {
  onProgress?.('Padh raha hoon…');
  let text = '';
  try {
    text = await readDocument(bytes, mime, (p) => onProgress?.(`Padh raha hoon… ${Math.round(p * 100)}%`));
  } catch (e) {
    if (!settings.ai_key || !settings.ai_vision) throw e;
  }
  let info = heuristicExtract(text, fileName);
  // Photo jismein lagbhag koi text nahi — aam photo hai, document nahi
  if (mime.startsWith('image/') && text.replace(/\s/g, '').length < 25 && info.doc_type === 'other') {
    info = { ...info, doc_type: 'photo', category: 'photos', title: fileName.replace(/\.[^.]+$/, '') };
  }
  let status = 'ready';

  if (settings.ai_key) {
    onProgress?.('AI samajh raha hai…');
    try {
      const image = settings.ai_vision ? await toJpegBase64(bytes, mime) : null;
      const ai = await extractDocument(settings.ai_key, text, fileName, image, profile);
      if (ai.text) text = ai.text;
      delete ai.text;
      info = { ...info, ...ai, expiry_date: ai.expiry_date || info.expiry_date };
    } catch (e) {
      console.warn('AI extract:', e);
      status = 'ai_failed';
    }
  }
  return { ...info, ocr_text: text, status };
}
