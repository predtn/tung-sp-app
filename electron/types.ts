/**
 * Vai trò của trường trong hồ sơ bệnh nhân:
 * - 'id'       : định danh cố định (mã BN) — khoá gộp các đợt khám
 * - 'visitkey' : định danh đợt khám (mã đợt / ngày khám) — cùng 'id' làm khoá chống trùng
 * - 'fixed'    : thông tin cố định của bệnh nhân (họ tên, ngày sinh) — không đổi giữa các đợt
 * - 'varying'  : chỉ số thay đổi theo từng lần khám (men gan, chẩn đoán)
 */
export type FieldRole = 'id' | 'visitkey' | 'fixed' | 'varying';

/**
 * Cách AI lấy giá trị cho trường này:
 * - 'extract' : chỉ trích xuất thông tin CÓ THẬT trong tài liệu, không suy đoán/bịa (mặc định)
 * - 'infer'   : cho phép AI suy luận/tính toán dựa trên các trường đã trích xuất của
 *   CÙNG hồ sơ + kiến thức chuyên môn, có thể tra cứu web (công thức, bảng chuẩn...)
 *   khi tài liệu không nêu thẳng giá trị. Chạy ở bước riêng SAU khi trích xuất xong,
 *   gộp chung 1 lần gọi cho mọi trường 'infer' của cùng hồ sơ (xem electron/extract.ts).
 */
export type FieldMode = 'extract' | 'infer';

export interface FieldDef {
  key: string;
  label: string;
  description: string;
  /** ví dụ giá trị mẫu, giúp AI bám đúng định dạng mong muốn (tuỳ chọn) */
  example?: string;
  /** vai trò; mặc định 'varying' nếu không set */
  role?: FieldRole;
  /**
   * Mô tả tự do cho "Lọc giá trị nâng cao" — chỉ có tác dụng khi role='varying'.
   * Rỗng/undefined = không lọc (bác sĩ tự nhập tay ở dòng tổng hợp). Có mô tả
   * -> AI đọc danh sách giá trị của trường này qua các đợt khám của CÙNG bệnh
   * nhân + mô tả này, tự suy luận ra 1 giá trị chốt (vd "Lấy giá trị lớn nhất
   * trong các đợt", "Lấy chẩn đoán nặng nhất"). Chạy tự động ngay sau khi quét
   * xong TOÀN BỘ lô file, gộp chung 1 lần gọi/bệnh nhân cho mọi trường có mô tả
   * này (xem electron/extract.ts -> aggregateFilter).
   */
  aggregateDescription?: string;
  /** mặc định 'extract' nếu không set */
  mode?: FieldMode;
}

export interface AppConfig {
  openaiApiKey: string;
  openaiModel: string;
  googleClientId: string;
  googleClientSecret: string;
  spreadsheetId: string;
}

/**
 * Ghi chú của AI cho 1 ô. Field không có note trong map nghĩa là không có gì
 * cần lưu ý (đọc rõ ràng, đủ thông tin, đúng định dạng).
 *
 * Nhóm "cần bác sĩ soát lại" (tính vào cảnh báo trước khi Import — xem
 * validation.ts -> countWarnings):
 * - 'uncertain'      : có đọc được value, nhưng AI không chắc chắn (chữ mờ, 2
 *   chỗ ghi khác nhau...). value vẫn hiển thị giá trị AI đọc được. Icon ❓.
 * - 'not_found'      : không tìm thấy trường này trong tài liệu. value =
 *   "Không tìm thấy". Icon ⚠️.
 * - 'format_mismatch': tìm thấy nhưng định dạng trong tài liệu không khớp
 *   định dạng yêu cầu ở mô tả/ví dụ field (vd yêu cầu dd/mm/yyyy nhưng tài
 *   liệu ghi kiểu khác không chuẩn hoá được). value = "Sai định dạng". Icon ❌.
 * - 'missing_info'   : (chủ yếu ở field mode='infer'/aggregate) thiếu số liệu
 *   cần thiết để suy luận/tính toán/chọn ra kết luận. value =
 *   "Thiếu thông tin để kết luận". Icon ⚡.
 *
 * Nhóm "chỉ tham khảo, KHÔNG phải lỗi" (không tính vào cảnh báo Import):
 * - 'inferred'       : (chỉ ở field mode='infer') AI vẫn tự tin về value,
 *   nhưng đã dùng thêm suy luận/thông tin ngoài phạm vi mô tả field để ra kết
 *   quả này — giải thích ngắn gọn căn cứ để bác sĩ kiểm chứng. Icon 💡.
 */
export type CellNoteType =
  | 'uncertain'
  | 'not_found'
  | 'format_mismatch'
  | 'missing_info'
  | 'inferred';
export interface CellNote {
  type: CellNoteType;
  text: string;
}

export interface ExtractedRecord {
  // key trường -> giá trị
  values: Record<string, string>;
  // key trường -> ghi chú AI (warning = cần soát lại, info = suy luận thêm tham khảo)
  notes: Record<string, CellNote>;
  sourceFile: string;
  sourcePath: string;
  error?: string;
  /** true nếu kết quả lấy từ cache (file đã quét trước đó) -> không tính phí */
  fromCache?: boolean;
  /** tổng số trang PDF gốc, kèm cờ báo file dài (đã quét hết, chỉ để cảnh báo chi phí) */
  totalPages?: number;
  isLongFile?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedUsd: number;
  };
}

export interface SheetTab {
  sheetId: number;
  title: string;
}
