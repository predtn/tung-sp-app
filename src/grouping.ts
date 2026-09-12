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

/** khoá override cho 1 ô "Lọc nâng cao" (bác sĩ sửa tay): theo mã BN + trường. */
export function aggOverrideKey(
  g: Pick<PatientGroup, 'idValue' | 'indices'>,
  fieldKey: string
): string {
  const groupId = g.idValue || `row${g.indices[0]}`;
  return `${groupId}:${fieldKey}`;
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

/**
 * Tách số ở ĐẦU chuỗi + phần đơn vị còn lại (nếu có). Chấp nhận "53.2 kg",
 * "820.5 ng/mL", "45"... nhưng TỪ CHỐI chuỗi bắt đầu bằng ký tự so sánh
 * ("< 20", "> 100", "~ 5") vì giá trị thực sự mơ hồ, không thể lấy đại diện
 * để tính max/min/avg một cách đáng tin cậy — để trống cho bác sĩ tự điền.
 * Dùng cho tính năng lọc nâng cao (max/min/avg).
 */
function parseLeadingNum(
  v: string | undefined
): { num: number; unit: string } | null {
  if (!v) return null;
  const s = v.trim().replace(',', '.');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  const unit = m[2].trim();
  // đuôi bắt đầu bằng "x"/"×" + số -> dạng ký hiệu khoa học (vd "4.5 x 10^4
  // IU/mL"). Số thật là num * 10^mũ, không phải num -> lấy riêng num là SAI
  // lệch nghiêm trọng. Coi là không parse được, để bác sĩ tự tính/nhập tay.
  if (/^[x×]\s*10/i.test(unit)) return null;
  return { num: Number(m[1]), unit };
}

export interface AggregateResult {
  value: string;
  /** true nếu không tính được (giá trị không phải số thuần / thiếu dữ liệu) */
  unavailable: boolean;
}

/**
 * Tính giá trị tổng hợp của 1 trường 'varying' qua các đợt khám trong nhóm,
 * theo `mode` (aggregate đã cấu hình cho trường đó).
 */
export function computeAggregate(
  group: PatientGroup,
  field: FieldDef
): AggregateResult {
  const mode = field.aggregate ?? 'none';
  // 'latest'/'earliest' đã bị bỏ khỏi lựa chọn UI (thứ tự đợt khám không tất
  // định khi thiếu Khoá đợt khám) -> coi như 'none' nếu còn sót trong dữ liệu cũ.
  if (mode === 'none' || mode === 'latest' || mode === 'earliest') {
    return { value: '', unavailable: false };
  }

  // max / min / avg -> tách số ở đầu chuỗi (đơn vị phía sau bị bỏ khi tính,
  // giữ lại để hiển thị kết quả cho đúng ngữ cảnh)
  const parsed = group.records.map((r) => parseLeadingNum(r.values[field.key]));
  if (parsed.some((p) => p === null) || parsed.length === 0) {
    return { value: '', unavailable: true };
  }
  const valid = parsed as { num: number; unit: string }[];
  // đơn vị hiển thị: lấy đơn vị xuất hiện nhiều nhất trong các đợt (đa số thắng)
  const unitCounts = new Map<string, number>();
  for (const p of valid) unitCounts.set(p.unit, (unitCounts.get(p.unit) ?? 0) + 1);
  const commonUnit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  let result: number;
  if (mode === 'max') result = Math.max(...valid.map((p) => p.num));
  else if (mode === 'min') result = Math.min(...valid.map((p) => p.num));
  else result = valid.reduce((a, p) => a + p.num, 0) / valid.length; // avg

  // làm tròn 2 chữ số thập phân, bỏ .00 thừa
  const rounded = Math.round(result * 100) / 100;
  const value = commonUnit ? `${rounded} ${commonUnit}` : String(rounded);
  return { value, unavailable: false };
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
