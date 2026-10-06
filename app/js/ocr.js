// Document padhna (OCR) — poora browser ke andar. File kahin nahi jaati.
// Libraries pehli baar CDN se aati hain (sirf code / language data), phir browser cache mein rehti hain.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

let pdfjs = null;
let workerPromise = null;

async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return pdfjs;
}

function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = import(TESSERACT).then(({ default: T }) =>
      (T?.createWorker ? T : globalThis.Tesseract).createWorker('eng+hin', 1, {
        logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
      }));
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function ocrCanvas(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text.trim();
}

// Badi photo ko chhota karke canvas par (OCR ke liye 2400px kaafi hai)
async function imageToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

export async function readDocument(bytes, mime, onProgress) {
  if (mime === 'application/pdf') {
    const lib = await getPdfjs();
    let pdf;
    try {
      pdf = await lib.getDocument({ data: bytes.slice() }).promise;
    } catch (e) {
      if (e?.name === 'PasswordException') throw new Error('Is PDF par password hai (jaise bank statement) — file khul jaayegi, par P-Dock iska text nahi padh sakta');
      throw e;
    }
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
      if (text.length > 40) {
        pages.push(text);
      } else {
        // Scan kiya hua page — image banake OCR
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.push(await ocrCanvas(canvas, onProgress));
      }
    }
    return pages.join('\n\n');
  }
  return ocrCanvas(await imageToCanvas(new Blob([bytes], { type: mime })), onProgress);
}

// Chhota preview (list mein dikhane ke liye nahi — sirf AI vision option ke liye JPEG)
export async function toJpegBase64(bytes, mime, maxSide = 1600) {
  let canvas;
  if (mime === 'application/pdf') {
    const lib = await getPdfjs();
    const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, maxSide / Math.max(vp1.width, vp1.height)) });
    canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  } else {
    canvas = await imageToCanvas(new Blob([bytes], { type: mime }));
  }
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}
