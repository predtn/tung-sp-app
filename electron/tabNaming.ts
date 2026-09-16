/**
 * Quy ước đặt tên cho tab "tổng hợp" (lưu 1 dòng/bệnh nhân sau khi bác sĩ
 * chốt các chỉ số lọc nâng cao), đi kèm 1 tab gốc (long-format nhiều đợt khám).
 * Dùng chung giữa main process và renderer -> chỉ import type (không có logic
 * Node) để renderer (bundler khác) cũng dùng được.
 */
import type { FieldDef } from './types';

export const FINAL_TAB_SUFFIX = ' - final';

export function finalTabName(tab: string): string {
  return `${tab}${FINAL_TAB_SUFFIX}`;
}

export function isFinalTab(tab: string): boolean {
  return tab.endsWith(FINAL_TAB_SUFFIX);
}

// Độ dài tối đa của mô tả khi nhét vào hậu tố tên cột — dài hơn thì cắt bớt +
// "…" để tên cột Sheet không quá dài/xấu.
const AGG_LABEL_MAX_LEN = 40;

/**
 * Tên cột hiển thị trên Sheet cho 1 field khi ghi vào tab "-final": nếu field
 * có cấu hình "Lọc giá trị nâng cao" (aggregateDescription khác rỗng), thêm
 * chính mô tả đó làm hậu tố (rút gọn nếu quá dài) để biết ngay cột được lọc
 * theo tiêu chí gì mà không cần mở Cài đặt, vd "Cân nặng" ->
 * "Cân nặng (Lấy giá trị lớn nhất trong các đợt)". Field khác (id/fixed/
 * visitkey, hoặc varying không cấu hình lọc) giữ nguyên label.
 */
export function finalColumnLabel(
  field: Pick<FieldDef, 'label' | 'aggregateDescription'>
): string {
  const desc = field.aggregateDescription?.trim();
  if (!desc) return field.label;
  const short =
    desc.length > AGG_LABEL_MAX_LEN
      ? desc.slice(0, AGG_LABEL_MAX_LEN).trimEnd() + '…'
      : desc;
  return `${field.label} (${short})`;
}
