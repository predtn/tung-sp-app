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
  // ảnh PNG base64 của tất cả các trang (dùng khi looksScanned)
  pageImages: string[];
  // tổng số trang thực tế của file (để cảnh báo khi file rất dài)
  totalPages: number;
}

// Không giới hạn cứng số trang quét — hồ sơ bệnh nhân dài (nhiều đợt khám gộp
// 1 file) cần đọc hết. Chỉ dùng ngưỡng này để CẢNH BÁO khi file quá dài
// (PDF scan nhiều trang tốn rất nhiều token ảnh), không chặn.
export const LONG_FILE_WARNING_PAGES = 20;

export async function extractPdf(filePath: string): Promise<PdfContent> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  let fullText = '';
  const numPages = doc.numPages;

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
    totalPages: numPages,
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

  // scale 1.5 (đủ đọc chữ) + JPEG q80 -> nhẹ hơn nhiều so với PNG 2x, tiết kiệm token.
  // Giới hạn cạnh dài ~1600px: OpenAI vision resize về 768/2048 nên vượt mức này là phí.
  const SCALE = 1.5;
  const MAX_EDGE = 1600;

  const images: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    let viewport = page.getViewport({ scale: SCALE });
    const longEdge = Math.max(viewport.width, viewport.height);
    if (longEdge > MAX_EDGE) {
      viewport = page.getViewport({ scale: (SCALE * MAX_EDGE) / longEdge });
    }
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    // nền trắng để JPEG không ra viền đen ở vùng trong suốt
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.8));
  }
  return images;
}
