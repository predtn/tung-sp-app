import { app } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ExtractedRecord, FieldDef, CellNote } from './types';

/**
 * Cache kết quả quét AI theo nội dung file PDF + TAB đích đang quét.
 * Cùng 1 file (dù đổi tên / copy) + cùng tab -> cùng khoá -> không gọi AI lại,
 * không mất phí. Khoá ghép theo cả tab (không chỉ hash file) vì 1 file PDF có
 * thể được quét cho nhiều tab khác nhau (mỗi tab có bộ trường/mục đích riêng)
 * — nếu chỉ khoá theo hash, quét file đó ở tab B sẽ GHI ĐÈ mất cache của tab A,
 * lần quay lại tab A phải quét lại từ đầu dù không có gì thay đổi.
 */

interface CacheEntry {
  values: Record<string, string>;
  notes: Record<string, CellNote>;
  // chữ ký bộ trường lúc quét — đổi trường thì cache cũ không dùng được
  fieldsSig: string;
  model: string;
  at: string; // ISO
}

const MAX_ENTRIES = 1000;
// khoá cho lượt quét không gắn tab cụ thể (dùng bộ trường chung) — chuỗi cố
// định không đụng tên tab thật nào (tên tab Google Sheet không chứa "::").
const NO_TAB_KEY = '__no_tab__';

function cachePath(): string {
  return path.join(app.getPath('userData'), 'scan-cache.json');
}

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Khoá cache ghép hash file + tab đích — xem giải thích ở đầu file. */
function cacheKey(hash: string, tab?: string): string {
  return `${hash}::${tab || NO_TAB_KEY}`;
}

/** Chữ ký bộ trường: key + role + mode, để phát hiện thay đổi cấu trúc. */
export function fieldsSignature(fields: FieldDef[]): string {
  return fields
    .map((f) => `${f.key}:${f.role ?? 'varying'}:${f.mode ?? 'extract'}`)
    .join('|');
}

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(data: Record<string, CacheEntry>): void {
  // giữ MAX_ENTRIES entry mới nhất theo 'at'
  const entries = Object.entries(data);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
    data = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }
  fs.writeFileSync(cachePath(), JSON.stringify(data, null, 2), 'utf-8');
}

/** Lấy kết quả đã cache cho file này ở ĐÚNG tab, nếu hợp lệ (cùng bộ trường). */
export function getCached(
  hash: string,
  fields: FieldDef[],
  tab?: string
):
  | {
      values: Record<string, string>;
      notes: Record<string, CellNote>;
      at: string;
      model: string;
    }
  | null {
  const cache = readCache();
  const e = cache[cacheKey(hash, tab)];
  if (!e) return null;
  if (e.fieldsSig !== fieldsSignature(fields)) return null;
  return { values: e.values, notes: e.notes, at: e.at, model: e.model };
}

/** Kiểm tra nhanh: file này đã có cache hợp lệ CHO TAB NÀY chưa (dùng để hỏi bác sĩ trước khi quét). */
export function peekCache(
  filePath: string,
  fields: FieldDef[],
  tab?: string
): { hash: string; cached: boolean; at?: string; model?: string } {
  try {
    const hash = hashFile(filePath);
    const hit = getCached(hash, fields, tab);
    return hit
      ? { hash, cached: true, at: hit.at, model: hit.model }
      : { hash, cached: false };
  } catch {
    return { hash: '', cached: false };
  }
}

export function putCached(
  hash: string,
  rec: ExtractedRecord,
  fields: FieldDef[],
  model: string,
  tab?: string
): void {
  if (rec.error) return; // không cache kết quả lỗi
  const cache = readCache();
  cache[cacheKey(hash, tab)] = {
    values: rec.values,
    notes: rec.notes,
    fieldsSig: fieldsSignature(fields),
    model,
    at: new Date().toISOString(),
  };
  writeCache(cache);
}

/**
 * Ghi đè values/notes của 1 entry cache ĐÃ CÓ SẴN (không tạo entry mới) —
 * dùng khi bác sĩ sửa tay 1 ô trong bảng review rồi bấm "Lưu cache", để lần
 * sau quét lại ĐÚNG file này (cùng tab) trả về giá trị đã sửa thay vì giá trị
 * AI đọc gốc lúc quét lần đầu. Không đổi 'model'/'fieldsSig' — vẫn là kết quả
 * của lần quét gốc, chỉ values/notes được cập nhật theo tay bác sĩ.
 * Trả về false nếu file chưa từng được quét/cache CHO TAB NÀY (không có gì để
 * ghi đè — xảy ra khi chưa bao giờ cache thành công, hoặc cache đã bị xoá).
 */
export function updateCachedValues(
  hash: string,
  values: Record<string, string>,
  notes: Record<string, CellNote>,
  tab?: string
): boolean {
  const cache = readCache();
  const key = cacheKey(hash, tab);
  const entry = cache[key];
  if (!entry) return false;
  entry.values = values;
  entry.notes = notes;
  entry.at = new Date().toISOString();
  writeCache(cache);
  return true;
}

export function clearCache(): void {
  try {
    fs.unlinkSync(cachePath());
  } catch {
    // ignore
  }
}

export function cacheStats(): { count: number } {
  return { count: Object.keys(readCache()).length };
}
