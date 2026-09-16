import { app } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ExtractedRecord, FieldDef, CellNote } from './types';

/**
 * Cache kết quả quét AI theo nội dung file PDF.
 * Cùng 1 file (dù đổi tên / copy) -> cùng hash -> không gọi AI lại, không mất phí.
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

function cachePath(): string {
  return path.join(app.getPath('userData'), 'scan-cache.json');
}

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
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

/** Lấy kết quả đã cache cho file này, nếu hợp lệ (cùng bộ trường). */
export function getCached(
  hash: string,
  fields: FieldDef[]
):
  | {
      values: Record<string, string>;
      notes: Record<string, CellNote>;
      at: string;
      model: string;
    }
  | null {
  const cache = readCache();
  const e = cache[hash];
  if (!e) return null;
  if (e.fieldsSig !== fieldsSignature(fields)) return null;
  return { values: e.values, notes: e.notes, at: e.at, model: e.model };
}

/** Kiểm tra nhanh: file này đã có cache hợp lệ chưa (dùng để hỏi bác sĩ trước khi quét). */
export function peekCache(
  filePath: string,
  fields: FieldDef[]
): { hash: string; cached: boolean; at?: string; model?: string } {
  try {
    const hash = hashFile(filePath);
    const hit = getCached(hash, fields);
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
  model: string
): void {
  if (rec.error) return; // không cache kết quả lỗi
  const cache = readCache();
  cache[hash] = {
    values: rec.values,
    notes: rec.notes,
    fieldsSig: fieldsSignature(fields),
    model,
    at: new Date().toISOString(),
  };
  writeCache(cache);
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
