import type { ExtractedRecord, FieldDef } from '../electron/types';

export interface PatientGroup {
  /** giá trị mã BN (khoá gộp); '' nếu không có trường id hoặc AI không đọc được */
  idValue: string;
  /** các bản ghi (mỗi bản ghi = 1 đợt khám), giữ nguyên thứ tự quét */
  records: ExtractedRecord[];
  /** chỉ số toàn cục của record trong mảng gốc, để onChange map ngược */
  indices: number[];
}

export function idField(fields: FieldDef[]): FieldDef | undefined {
  return fields.find((f) => f.role === 'id');
}
export function visitKeyField(fields: FieldDef[]): FieldDef | undefined {
  return fields.find((f) => f.role === 'visitkey');
}
export function fixedFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => f.role === 'fixed');
}
export function varyingFields(fields: FieldDef[]): FieldDef[] {
  // 'visitkey' và không set role đều hiển thị như cột biến thiên theo đợt
  return fields.filter(
    (f) => !f.role || f.role === 'varying' || f.role === 'visitkey'
  );
}

/**
 * Gom records theo mã BN. Record lỗi hoặc không có mã BN -> mỗi cái 1 nhóm riêng.
 */
export function groupByPatient(
  records: ExtractedRecord[],
  fields: FieldDef[]
): PatientGroup[] {
  const idf = idField(fields);
  if (!idf) {
    // không có trường định danh -> không gộp, mỗi record 1 nhóm
    return records.map((r, i) => ({
      idValue: '',
      records: [r],
      indices: [i],
    }));
  }

  const groups = new Map<string, PatientGroup>();
  const singles: PatientGroup[] = [];

  records.forEach((r, i) => {
    const id = (r.values[idf.key] ?? '').trim();
    if (r.error || !id) {
      singles.push({ idValue: id, records: [r], indices: [i] });
      return;
    }
    const g = groups.get(id);
    if (g) {
      g.records.push(r);
      g.indices.push(i);
    } else {
      groups.set(id, { idValue: id, records: [r], indices: [i] });
    }
  });

  return [...groups.values(), ...singles];
}

/** Trong 1 nhóm, các trường 'fixed' có giá trị khác nhau giữa các đợt -> mâu thuẫn. */
export function fixedConflicts(
  group: PatientGroup,
  fields: FieldDef[]
): Set<string> {
  const conflicts = new Set<string>();
  if (group.records.length < 2) return conflicts;
  for (const f of fixedFields(fields)) {
    const vals = new Set(
      group.records.map((r) => (r.values[f.key] ?? '').trim()).filter((v) => v !== '')
    );
    if (vals.size > 1) conflicts.add(f.key);
  }
  return conflicts;
}

/**
 * So sánh chỉ số biến thiên số học giữa đợt liền trước.
 * Trả về map: "recordIndexTrongNhom:fieldKey" -> 'up' | 'down' | 'same'
 */
export function trendMarks(
  group: PatientGroup,
  fields: FieldDef[]
): Map<string, 'up' | 'down' | 'same'> {
  const marks = new Map<string, 'up' | 'down' | 'same'>();
  const vf = varyingFields(fields);
  for (let i = 1; i < group.records.length; i++) {
    for (const f of vf) {
      const prev = parseNum(group.records[i - 1].values[f.key]);
      const cur = parseNum(group.records[i].values[f.key]);
      if (prev === null || cur === null) continue;
      marks.set(
        `${i}:${f.key}`,
        cur > prev ? 'up' : cur < prev ? 'down' : 'same'
      );
    }
  }
  return marks;
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  // lấy số đầu tiên trong chuỗi (vd "45 U/L" -> 45)
  const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Khoá đợt khám trùng nhau trong cùng nhóm -> có thể quét trùng file. */
export function duplicateVisits(
  group: PatientGroup,
  fields: FieldDef[]
): number[] {
  const vkF = visitKeyField(fields);
  if (!vkF) return [];
  const seen = new Map<string, number>();
  const dupIdx: number[] = [];
  group.records.forEach((r, i) => {
    const d = (r.values[vkF.key] ?? '').trim().toLowerCase();
    if (!d) return;
    if (seen.has(d)) dupIdx.push(i);
    else seen.set(d, i);
  });
  return dupIdx;
}
