import fs from 'node:fs';
import path from 'node:path';

// pdfjs-dist v4 chỉ có ESM -> nạp bằng dynamic import trong CJS main process
let pdfjsPromise: Promise<any> | null = null;
function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    pdfjsPromise = (Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')() as Promise<any>);
  }
  return pdfjsPromise;
}

export interface PdfContent {
  file: string;
  text: string;
  // true nếu PDF gần như không có text -> có thể là bản scan, cần OCR bằng ảnh
  looksScanned: boolean;
  // ảnh PNG base64 của tối đa N trang đầu (dùng khi looksScanned)
  pageImages: string[];
}

const MAX_PAGES = 4;

export async function extractPdf(filePath: string): Promise<PdfContent> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  let fullText = '';
  const numPages = Math.min(doc.numPages, MAX_PAGES);

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: any) => ('str' in it ? it.str : ''))
      .join(' ');
    fullText += pageText + '\n';
  }

  const trimmed = fullText.replace(/\s+/g, ' ').trim();
  const looksScanned = trimmed.length < 40;

  let pageImages: string[] = [];
  if (looksScanned) {
    pageImages = await renderPagesToPng(doc, numPages);
  }

  await doc.cleanup();

  return {
    file: path.basename(filePath),
    text: trimmed,
    looksScanned,
    pageImages,
  };
}

async function renderPagesToPng(doc: any, numPages: number): Promise<string[]> {
  // Render bằng canvas của Node thông qua @napi-rs/canvas nếu có,
  // nếu không có thì bỏ qua (sẽ báo lỗi để người dùng cài).
  let createCanvas: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ createCanvas } = require('@napi-rs/canvas'));
  } catch {
    throw new Error(
      'PDF này là bản scan (không có text). Cần cài thêm @napi-rs/canvas để chuyển trang thành ảnh cho AI đọc. Chạy: npm i @napi-rs/canvas'
    );
  }

  const images: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
  }
  return images;
}
