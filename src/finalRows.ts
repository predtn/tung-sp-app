import type { ExtractedRecord, FieldDef } from '../electron/types';
import {
  groupByPatient,
  varyingFields,
  computeAggregate,
  aggOverrideKey,
} from './grouping';

/**
 * Dựng 1 dòng tổng hợp (ExtractedRecord) cho mỗi bệnh nhân từ các đợt khám đã
 * quét, dùng cấu hình "Lọc giá trị (nâng cao)" của từng trường biến thiên.
 * - id/fixed: lấy theo record đầu tiên trong nhóm (đã sắp theo Khoá đợt khám).
 * - varying : ưu tiên giá trị bác sĩ đã sửa tay (aggOverrides, khoá theo
 *   aggOverrideKey — cùng cách tính với bảng review chính); nếu chưa sửa thì
 *   tính theo field.aggregate. Không có gì -> để trống, uncertain=true để bác
 *   sĩ tự điền/soát trước khi ghi Sheet.
 */
export function buildFinalRows(
  records: ExtractedRecord[],
  fields: FieldDef[],
  aggOverrides: Record<string, string>
): ExtractedRecord[] {
  const good = records.filter((r) => !r.error);
  const groups = groupByPatient(good, fields);
  const varyF = varyingFields(fields);

  return groups.map((g) => {
    const first = g.records[0];
    const values: Record<string, string> = {};
    const uncertain: Record<string, boolean> = {};

    for (const f of fields) {
      if (varyF.some((v) => v.key === f.key)) {
        const overridden = aggOverrides[aggOverrideKey(g, f.key)];
        const value =
          overridden ?? (f.aggregate && f.aggregate !== 'none'
            ? computeAggregate(g, f).value
            : '');
        values[f.key] = value;
        uncertain[f.key] = value === '';
      } else {
        // id / fixed / visitkey -> giữ nguyên theo đợt đầu tiên
        values[f.key] = first.values[f.key] ?? '';
        uncertain[f.key] = false;
      }
    }

    const files = g.records.map((r) => r.sourceFile).join(', ');
    return {
      values,
      uncertain,
      sourceFile: files,
      sourcePath: first.sourcePath,
    };
  });
}
