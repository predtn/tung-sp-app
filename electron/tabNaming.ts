/**
 * Quy ước đặt tên cho tab "tổng hợp" (lưu 1 dòng/bệnh nhân sau khi bác sĩ
 * chốt các chỉ số lọc nâng cao), đi kèm 1 tab gốc (long-format nhiều đợt khám).
 * Dùng chung giữa main process và renderer -> chỉ import type (không có logic
 * Node) để renderer (bundler khác) cũng dùng được.
 */
import type { AggregateMode, FieldDef } from './types';

export const FINAL_TAB_SUFFIX = ' - final';

export function finalTabName(tab: string): string {
  return `${tab}${FINAL_TAB_SUFFIX}`;
}

export function isFinalTab(tab: string): boolean {
  return tab.endsWith(FINAL_TAB_SUFFIX);
}

const AGGREGATE_SUFFIX_LABEL: Record<Exclude<AggregateMode, 'none'>, string> = {
  max: 'Lớn nhất',
  min: 'Nhỏ nhất',
  avg: 'Trung bình',
  // đã ngừng hỗ trợ (xem electron/types.ts) — giữ nhãn để không vỡ dữ liệu cũ
  latest: 'Mới nhất',
  earliest: 'Muộn nhất',
};

/**
 * Tên cột hiển thị trên Sheet cho 1 field khi ghi vào tab "-final": nếu field
 * có cấu hình "Lọc giá trị nâng cao" (aggregate != 'none'), thêm hậu tố cho
 * rõ (vd "BMI" -> "BMI (Lớn nhất)"). Field khác (id/fixed/visitkey, hoặc
 * varying không cấu hình lọc) giữ nguyên label.
 */
export function finalColumnLabel(field: Pick<FieldDef, 'label' | 'aggregate'>): string {
  const mode = field.aggregate;
  if (!mode || mode === 'none') return field.label;
  const suffix = AGGREGATE_SUFFIX_LABEL[mode];
  return suffix ? `${field.label} (${suffix})` : field.label;
}
