import type { ExtractedRecord, FieldDef, CellNote } from '../electron/types';
import { groupByPatient, varyingFields, aggOverrideKey, type PatientGroup } from './grouping';
import { isPlaceholderValue } from '../electron/noteValues';

// Gọi song song KHÔNG giới hạn (1 request/bệnh nhân) từng khiến OpenAI trả
// lỗi rate-limit/timeout khi lô có nhiều bệnh nhân cùng lúc -> bác sĩ thấy ô
// trống, phải tự bấm "Quét lại" nhiều lần. Giới hạn concurrency để giảm khả
// năng dội request. Lỗi 429 (rate limit) đã được retry đúng thời gian OpenAI
// yêu cầu ở main process (electron/extract.ts -> withRateLimitRetry) trước
// khi trả kết quả về đây, nên retry ở đây chỉ còn xử lý các lỗi KHÁC (network
// chập chờn, timeout...) với backoff ngắn — không lặp lại retry rate limit.
//
// LƯU Ý: main process (electron/extract.ts -> aggregateFilter) tự bắt lỗi và
// trả về {values, notes, error} thay vì throw -> promise ở đây LUÔN resolve
// thành công. Phải retry dựa vào field `error` trong kết quả, không phải dựa
// vào exception (nếu không code retry sẽ không bao giờ chạy).
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

async function callWithRetry(
  payload: Parameters<typeof window.api.aggregateFilter>[0]
): Promise<Awaited<ReturnType<typeof window.api.aggregateFilter>>> {
  let last: Awaited<ReturnType<typeof window.api.aggregateFilter>> | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await window.api.aggregateFilter(payload);
      if (!out.error) return out;
      last = out;
    } catch (err) {
      last = {
        values: {},
        notes: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
    // chờ ngắn rồi thử lại — tránh dội thêm request ngay lập tức vào lúc
    // đang bị rate-limit
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return last!;
}

/**
 * Chạy "Lọc giá trị nâng cao" bằng AI cho TOÀN BỘ bệnh nhân trong `records`,
 * ngay sau khi quét xong cả lô file — không cần đợi bác sĩ mở preview tổng hợp.
 * Gộp 1 lần gọi/bệnh nhân cho mọi trường có `aggregateDescription`.
 * Trả về map dùng chung khoá với `aggOverrideKey` (groupId:fieldKey -> value),
 * để hiển thị ngay ở cột "Lọc nâng cao" và dùng lại khi ghi bản tổng hợp.
 *
 * `onGroupDone` (tuỳ chọn) được gọi ngay sau khi 1 bệnh nhân xử lý xong (kể cả
 * khi đã hết lượt retry), kèm SNAPSHOT hiện tại của results/notes (đã có kết
 * quả của bệnh nhân vừa xong, cộng dồn các bệnh nhân xong trước đó) — cho phép
 * UI hiện kết quả từng bệnh nhân ngay, thay vì phải đợi TOÀN BỘ lô xong mới
 * thấy bất kỳ ô nào (bệnh nhân nào đó bị dữ liệu mơ hồ, tốn nhiều vòng retry,
 * sẽ kéo dài "AI đang lọc…" cho mọi ô khác nếu chỉ có 1 cờ loading dùng chung
 * cho cả lô).
 */
export async function runAggregateFilter(
  records: ExtractedRecord[],
  fields: FieldDef[],
  onGroupDone?: (
    groupKey: string,
    snapshot: { results: Record<string, string>; notes: Record<string, CellNote> }
  ) => void
): Promise<{
  results: Record<string, string>;
  notes: Record<string, CellNote>;
}> {
  const varyF = varyingFields(fields).filter((f) => f.aggregateDescription?.trim());
  const results: Record<string, string> = {};
  const notes: Record<string, CellNote> = {};
  if (varyF.length === 0) return { results, notes };

  const good = records.filter((r) => !r.error);
  const groups = groupByPatient(good, fields);

  // Số lần gọi lại RIÊNG cho các field còn note (warning) trong 1 batch —
  // khác với callWithRetry (retry lỗi API), đây là retry vì model TỰ ĐÁNH
  // GIÁ "không đủ căn cứ" cho 1 vài field cụ thể (thường do dữ liệu mơ hồ,
  // vd kích thước dạng "106 x 88 mm" khó so sánh) dù request thành công bình
  // thường — hành vi không tất định của LLM, không phải lỗi mạng. Gọi lại
  // hẹp (chỉ đúng field còn thiếu) rẻ hơn nhiều so với gọi lại cả batch.
  const MAX_WARNING_RETRIES = 2;

  function fieldsOf(keys: string[]) {
    const set = new Set(keys);
    return varyF.filter((f) => set.has(f.key));
  }

  async function runOne(g: PatientGroup) {
    // Field không còn đợt nào có giá trị hợp lệ -> không có gì để AI chọn,
    // khỏi tốn 1 lượt gọi vô ích, gán thẳng missing_info. "Hợp lệ" ở đây loại
    // cả chuỗi rỗng LẪN các giá trị placeholder ("Không tìm thấy", "Sai định
    // dạng", "Thiếu thông tin để kết luận") — đây không phải dữ liệu thật, gửi
    // cho AI lọc nâng cao chỉ gây nhiễu và khiến model liên tục trả về note
    // "thiếu căn cứ", kích hoạt retry vô ích khiến cột kẹt mãi ở "AI đang lọc…".
    const emptyKeys: string[] = [];
    let pending = varyF.filter((f) => {
      const hasValue = g.records.some((r) => {
        const v = (r.values[f.key] ?? '').trim();
        return v !== '' && !isPlaceholderValue(v);
      });
      if (!hasValue) emptyKeys.push(f.key);
      return hasValue;
    });
    for (const fkey of emptyKeys) {
      const key = aggOverrideKey(g, fkey);
      results[key] = '';
      notes[key] = { type: 'missing_info', text: 'Không có đợt nào có giá trị cho trường này.' };
    }

    for (let round = 0; round <= MAX_WARNING_RETRIES && pending.length > 0; round++) {
      const payload = pending.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.aggregateDescription!.trim(),
        // Lọc bỏ giá trị rỗng VÀ giá trị placeholder (đợt AI đọc lỗi/không có/
        // sai định dạng) trước khi gửi — chỉ đưa AI xem các đợt CÓ dữ liệu
        // thật, tránh nhiễu khiến AI trả về missing_info dù thừa đủ căn cứ để
        // chọn từ các đợt hợp lệ còn lại.
        values: g.records
          .map((r) => (r.values[f.key] ?? '').trim())
          .filter((v) => v !== '' && !isPlaceholderValue(v)),
      }));
      const out = await callWithRetry(payload);
      if (out.error) {
        console.error(
          `aggregateFilter thất bại cho bệnh nhân "${g.idValue}" sau ${MAX_RETRIES + 1} lần thử:`,
          out.error
        );
      }
      const stillWarning: string[] = [];
      for (const f of pending) {
        const key = aggOverrideKey(g, f.key);
        results[key] = out.values[f.key] ?? '';
        const note = out.notes[f.key];
        if (note) {
          notes[key] = note;
          stillWarning.push(f.key);
        } else {
          delete notes[key];
        }
      }
      if (stillWarning.length === 0 || round === MAX_WARNING_RETRIES) break;
      pending = fieldsOf(stillWarning);
    }
    onGroupDone?.(g.idValue || g.records[0]?.sourcePath || '', { results, notes });
  }

  let next = 0;
  async function worker() {
    while (next < groups.length) {
      const g = groups[next++];
      await runOne(g);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker)
  );

  return { results, notes };
}
