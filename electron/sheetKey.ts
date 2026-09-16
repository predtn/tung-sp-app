/**
 * Ký tự ngăn cách khi ghép khoá kép (vd Mã BN + Ngày khám) để đối chiếu trùng
 * lặp với Google Sheet. Tách riêng file này (không import gì khác) để dùng
 * chung được ở cả main process (electron/google.ts) lẫn renderer (src/App.tsx)
 * — trước đây renderer tự khai báo lại hằng số này thủ công, dễ lệch nếu ai
 * đó đổi giá trị ở phía main mà quên đổi theo ở renderer.
 */
export const KEY_SEP = '||';

export function normKey(s: string | undefined): string {
  return (s ?? '').toString().trim().toLowerCase();
}
