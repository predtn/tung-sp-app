/**
 * Vai trò của trường trong hồ sơ bệnh nhân:
 * - 'id'      : định danh cố định (mã BN) — dùng làm khoá gộp các đợt khám
 * - 'fixed'   : thông tin cố định của bệnh nhân (họ tên, ngày sinh) — không đổi giữa các đợt
 * - 'varying' : chỉ số thay đổi theo từng lần khám (men gan, ngày khám, chẩn đoán)
 */
export type FieldRole = 'id' | 'fixed' | 'varying';

export interface FieldDef {
  key: string;
  label: string;
  description: string;
  /** ví dụ giá trị mẫu, giúp AI bám đúng định dạng mong muốn (tuỳ chọn) */
  example?: string;
  /** vai trò; mặc định 'varying' nếu không set */
  role?: FieldRole;
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
