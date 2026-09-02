import type { ExtractedRecord, FieldDef } from '../electron/types';

export interface CellIssue {
  recordIdx: number;
  fieldKey: string;
  message: string;
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Đoán trường là ngày / năm sinh dựa trên key + label để validate mềm.
function looksLikeDate(f: FieldDef): boolean {
  const s = (f.key + ' ' + f.label).toLowerCase();
  return /ngay|ngày|date/.test(s) && !/nam sinh|năm sinh/.test(s);
}
function looksLikeBirthYear(f: FieldDef): boolean {
  const s = (f.key + ' ' + f.label).toLowerCase();
  return /nam sinh|năm sinh|birth|yob/.test(s);
}

function validDate(v: string): boolean {
  const m = v.match(DATE_RE);
  if (!m) return false;
  const d = +m[1],
    mo = +m[2],
    y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** Trả về danh sách vấn đề định dạng (không chặn, chỉ cảnh báo). */
export function validateRecords(
  records: ExtractedRecord[],
  fields: FieldDef[]
): CellIssue[] {
  const issues: CellIssue[] = [];
  const thisYear = new Date().getFullYear();

  records.forEach((r, ri) => {
    if (r.error) return;
    fields.forEach((f) => {
      const v = (r.values[f.key] ?? '').trim();

      if (looksLikeDate(f) && v && !validDate(v)) {
        issues.push({
          recordIdx: ri,
          fieldKey: f.key,
          message: `"${f.label}" không đúng định dạng ngày dd/mm/yyyy`,
        });
      }

      if (looksLikeBirthYear(f) && v) {
        const y = Number(v.match(/\d{4}/)?.[0] ?? v);
        if (!Number.isFinite(y) || y < 1900 || y > thisYear) {
          issues.push({
            recordIdx: ri,
            fieldKey: f.key,
            message: `"${f.label}" (${v}) không phải năm sinh hợp lệ`,
          });
        }
      }
    });
  });

  return issues;
}

/** Đếm số ô AI đánh dấu không chắc chắn (uncertain), bỏ qua record lỗi. */
export function countUncertain(records: ExtractedRecord[]): {
  cells: number;
  records: number;
} {
  let cells = 0;
  let recs = 0;
  for (const r of records) {
    if (r.error) continue;
    const n = Object.values(r.uncertain).filter(Boolean).length;
    if (n > 0) {
      cells += n;
      recs += 1;
    }
  }
  return { cells, records: recs };
}
