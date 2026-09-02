import type { ExtractedRecord, FieldDef } from '../electron/types';

export interface PatientGroup {
  /** giá trị mã BN (khoá gộp); '' nếu không có trường id hoặc AI không đọc được */
  idValue: string;
  /** các bản ghi (mỗi bản ghi = 1 đợt khám), đã sắp theo Khoá đợt khám */
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

  // Sắp các đợt trong mỗi nhóm theo giá trị "Khoá đợt khám" (mã đợt / ngày khám).
  const vkf = visitKeyField(fields);
  if (vkf) {
    for (const g of groups.values()) {
      const order = g.records
        .map((r, pos) => ({ pos, key: (r.values[vkf.key] ?? '').trim() }))
        .sort((a, b) => compareVisitKey(a.key, b.key))
        .map((x) => x.pos);
      g.records = order.map((p) => g.records[p]);
      g.indices = order.map((p) => g.indices[p]);
    }
  }

  return [...groups.values(), ...singles];
}

/**
 * So sánh 2 khoá đợt khám: ưu tiên số nếu cả hai chứa số (DK-1, DK-2, DK-10 đúng thứ tự),
 * dạng ngày dd/mm/yyyy so theo mốc thời gian, còn lại so chuỗi.
 */
function compareVisitKey(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (da !== null && db !== null) return da - db;

  const na = firstNumber(a);
  const nb = firstNumber(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;

  return a.localeCompare(b, 'vi', { numeric: true });
}

function parseDate(s: string): number | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
}
function firstNumber(s: string): number | null {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
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
