import type { ExtractedRecord, FieldDef, CellNote } from '../electron/types';
import { groupByPatient, varyingFields, aggOverrideKey } from './grouping';
import { isPlaceholderValue } from '../electron/noteValues';

/**
 * Dựng 1 dòng tổng hợp (ExtractedRecord) cho mỗi bệnh nhân từ các đợt khám đã
 * quét, dùng cấu hình "Lọc giá trị (nâng cao)" của từng trường biến thiên.
 * - id/fixed: lấy theo record đầu tiên trong nhóm (đã sắp theo Khoá đợt khám).
 * - varying : ưu tiên giá trị bác sĩ đã sửa tay (aggOverrides, khoá theo
 *   aggOverrideKey), rồi đến kết quả AI đã tính sẵn (aggResults, do
 *   runAggregateFilter chạy tự động ngay sau khi quét xong lô file — xem
 *   src/aggregateAi.ts). Không có gì -> để trống, note cảnh báo để bác sĩ tự
 *   điền/soát trước khi ghi Sheet. Nếu AI đã tính nhưng không đủ căn cứ, value
 *   là 1 trong các chuỗi placeholder (vd "Thiếu thông tin để kết luận") kèm
 *   note giải thích trong aggNotes — phải giữ nguyên note đó (không phải chuỗi
 *   rỗng nên không được để lọt qua mà thiếu cảnh báo).
 */
export function buildFinalRows(
  records: ExtractedRecord[],
  fields: FieldDef[],
  aggOverrides: Record<string, string>,
  aggResults: Record<string, string> = {},
  aggNotes: Record<string, CellNote> = {}
): ExtractedRecord[] {
  const good = records.filter((r) => !r.error);
  const groups = groupByPatient(good, fields);
  const varyF = varyingFields(fields);

  return groups.map((g) => {
    const first = g.records[0];
    const values: Record<string, string> = {};
    const notes: Record<string, CellNote> = {};

    for (const f of fields) {
      if (varyF.some((v) => v.key === f.key)) {
        const key = aggOverrideKey(g, f.key);
        const overridden = aggOverrides[key];
        const value = overridden ?? aggResults[key] ?? '';
        values[f.key] = value;
        // bác sĩ đã tự sửa tay -> coi như đã soát xong, không gắn note
        if (overridden !== undefined) continue;
        if (value === '') {
          notes[f.key] = {
            type: 'missing_info',
            text: 'Chưa có giá trị tổng hợp cho trường này.',
          };
        } else if (aggNotes[key]) {
          notes[f.key] = aggNotes[key];
        } else if (isPlaceholderValue(value)) {
          notes[f.key] = {
            type: 'missing_info',
            text: 'AI không đủ căn cứ để chốt giá trị cho trường này.',
          };
        }
      } else {
        // id / fixed / visitkey -> giữ nguyên theo đợt đầu tiên
        values[f.key] = first.values[f.key] ?? '';
      }
    }

    const files = g.records.map((r) => r.sourceFile).join(', ');
    return {
      values,
      notes,
      sourceFile: files,
      sourcePath: first.sourcePath,
    };
  });
}
