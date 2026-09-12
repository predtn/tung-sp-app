/**
 * Vai trò của trường trong hồ sơ bệnh nhân:
 * - 'id'       : định danh cố định (mã BN) — khoá gộp các đợt khám
 * - 'visitkey' : định danh đợt khám (mã đợt / ngày khám) — cùng 'id' làm khoá chống trùng
 * - 'fixed'    : thông tin cố định của bệnh nhân (họ tên, ngày sinh) — không đổi giữa các đợt
 * - 'varying'  : chỉ số thay đổi theo từng lần khám (men gan, chẩn đoán)
 */
export type FieldRole = 'id' | 'visitkey' | 'fixed' | 'varying';

/**
 * Cách lọc/tổng hợp giá trị của 1 trường 'varying' qua nhiều đợt khám thành
 * 1 giá trị duy nhất cho dòng tổng hợp (tab "-final"). Chỉ áp dụng cho role='varying'.
 * - 'none' : không tổng hợp, bác sĩ tự nhập tay ở dòng chốt (mặc định)
 * - 'max'  : giá trị số lớn nhất trong các đợt
 * - 'min'  : giá trị số nhỏ nhất
 * - 'avg'  : trung bình cộng các giá trị số
 *
 * 'latest'/'earliest' (lần khám mới nhất/muộn nhất) đã bị BỎ khỏi lựa chọn —
 * thứ tự đợt khám không tất định khi thiếu "Khoá đợt khám" (phụ thuộc thứ tự
 * xử lý song song lúc quét), dễ chọn nhầm đợt. Giữ 2 giá trị này trong type để
 * không phá dữ liệu cũ đã lưu; `computeAggregate` coi chúng như 'none'.
 */
export type AggregateMode = 'none' | 'max' | 'min' | 'avg' | 'latest' | 'earliest';

export interface FieldDef {
  key: string;
  label: string;
  description: string;
  /** ví dụ giá trị mẫu, giúp AI bám đúng định dạng mong muốn (tuỳ chọn) */
  example?: string;
  /** vai trò; mặc định 'varying' nếu không set */
  role?: FieldRole;
  /** chỉ có tác dụng khi role='varying'; mặc định 'none' */
  aggregate?: AggregateMode;
}

export interface AppConfig {
  openaiApiKey: string;
  openaiModel: string;
  googleClientId: string;
  googleClientSecret: string;
  spreadsheetId: string;
}

export interface ExtractedRecord {
  // key trường -> giá trị
  values: Record<string, string>;
  // key trường -> true nếu AI không chắc chắn
  uncertain: Record<string, boolean>;
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
