/**
 * Các giá trị "value" cố định mà AI trả về khi KHÔNG ra được kết luận đáng
 * tin cậy (xem CellNoteType trong types.ts). Tách riêng file này (không import
 * gì khác, đặc biệt không import OpenAI hay bất kỳ package Node nào) để dùng
 * chung được ở cả main process (electron/extract.ts) lẫn renderer
 * (src/aggregateAi.ts — lọc bỏ các giá trị "giả" này trước khi gửi cho AI lọc
 * nâng cao, tránh coi chúng là dữ liệu thật).
 */
export const NOT_FOUND_VALUE = 'Không tìm thấy';
export const FORMAT_MISMATCH_VALUE = 'Sai định dạng';
export const INFER_MISSING_DATA_VALUE = 'Thiếu thông tin để kết luận';

/** Danh sách tất cả giá trị "giả" (không phải dữ liệu thật đọc từ hồ sơ). */
export const PLACEHOLDER_VALUES: readonly string[] = [
  NOT_FOUND_VALUE,
  FORMAT_MISMATCH_VALUE,
  INFER_MISSING_DATA_VALUE,
];

/** true nếu value là 1 trong các giá trị "giả" trên (không phải dữ liệu thật). */
export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_VALUES.includes(value);
}
