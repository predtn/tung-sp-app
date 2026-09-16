import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, FieldDef } from './types';

const DEFAULT_CONFIG: AppConfig = {
  openaiApiKey: '',
  openaiModel: 'gpt-5.6-luna',
  googleClientId: '',
  googleClientSecret: '',
  spreadsheetId: '',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

// App hiện chỉ dùng đúng 1 model (gpt-5.6-luna) cho mọi bước AI -> mọi model
// cũ khác trong config đã lưu trước đây đều tự động chuyển sang model này khi
// đọc config, tránh âm thầm tiếp tục gọi model không còn được hỗ trợ chính thức.
const MODEL_MIGRATIONS: Record<string, string> = {
  'gpt-4.1-mini': 'gpt-5.6-luna',
  'gpt-5-mini': 'gpt-5.6-luna',
  'gpt-4.1': 'gpt-5.6-luna',
};

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const cfg = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    if (cfg.openaiModel in MODEL_MIGRATIONS) {
      cfg.openaiModel = MODEL_MIGRATIONS[cfg.openaiModel];
    }
    return cfg;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: AppConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

function userFieldsPath(): string {
  return path.join(app.getPath('userData'), 'fields.config.json');
}

export const DEFAULT_FIELDS: FieldDef[] = [
  {
    key: 'ma_bn',
    label: 'Mã bệnh nhân',
    description: 'Mã số / mã hồ sơ bệnh nhân, cố định qua các đợt khám',
    role: 'id',
  },
  {
    key: 'ho_ten',
    label: 'Họ và tên',
    description: 'Họ và tên đầy đủ của bệnh nhân',
    role: 'fixed',
  },
  {
    key: 'ngay_sinh',
    label: 'Ngày sinh',
    description: 'Ngày sinh của bệnh nhân, dd/mm/yyyy',
    example: '12/05/1980',
    role: 'fixed',
  },
  { key: 'dia_chi', label: 'Địa chỉ', description: 'Địa chỉ của bệnh nhân', role: 'fixed' },
  {
    key: 'ngay_kham',
    label: 'Ngày khám',
    description: 'Ngày khám của đợt này, dd/mm/yyyy',
    example: '15/03/2026',
    role: 'visitkey',
  },
  {
    key: 'chan_doan',
    label: 'Chẩn đoán bệnh',
    description: 'Chẩn đoán của bác sĩ trong đợt khám này',
    role: 'varying',
  },
];

interface FieldsFile {
  // bộ trường dùng chung (fallback khi tab chưa cấu hình riêng)
  fields?: FieldDef[];
  // bộ trường riêng theo tên tab
  byTab?: Record<string, FieldDef[]>;
  // Tên cột (label) đã dùng lần đồng bộ Google Sheet gần nhất, khoá theo
  // "tabTitle" -> "fieldKey" -> label. Google Sheet chỉ lưu text tiêu đề cột,
  // không lưu field key -> app phải TỰ NHỚ ánh xạ này để phân biệt "bác sĩ đổi
  // label 1 field đã có" (chỉ cần đổi text tiêu đề, giữ nguyên cột dữ liệu)
  // với "field hoàn toàn mới" (thêm cột) hay "field bị xoá khỏi Cài đặt" (xoá
  // cột) — xem electron/google.ts -> planTabSync/applyTabSync.
  syncedLabels?: Record<string, Record<string, string>>;
}

function readFieldsFile(): FieldsFile {
  const candidates = [
    userFieldsPath(),
    path.join(process.cwd(), 'fields.config.json'),
    path.join(process.resourcesPath || '', 'fields.config.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as FieldsFile;
      if (parsed && (Array.isArray(parsed.fields) || parsed.byTab)) return parsed;
    } catch {
      // thử file tiếp theo
    }
  }
  return {};
}

function writeFieldsFile(data: FieldsFile): void {
  fs.writeFileSync(userFieldsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

/** Bộ trường mặc định/chung (không gắn tab cụ thể). */
export function loadFields(): FieldDef[] {
  const f = readFieldsFile();
  return Array.isArray(f.fields) && f.fields.length ? f.fields : DEFAULT_FIELDS;
}

/** Bộ trường của một tab; chưa cấu hình thì rơi về bộ chung. */
export function loadFieldsForTab(tab: string): FieldDef[] {
  const f = readFieldsFile();
  const t = f.byTab?.[tab];
  if (Array.isArray(t) && t.length) return t;
  return loadFields();
}

export function saveFields(fields: FieldDef[]): void {
  const f = readFieldsFile();
  writeFieldsFile({ ...f, fields });
}

export function saveFieldsForTab(tab: string, fields: FieldDef[]): void {
  const f = readFieldsFile();
  const byTab = { ...(f.byTab ?? {}), [tab]: fields };
  writeFieldsFile({ ...f, byTab });
}

/** Tên các tab đã có cấu hình trường riêng. */
export function configuredTabs(): string[] {
  return Object.keys(readFieldsFile().byTab ?? {});
}

/** Xoá cấu hình trường riêng của 1 tab (khi tab đã bị xoá và người dùng chủ động dọn). */
export function deleteFieldsForTab(tab: string): void {
  const f = readFieldsFile();
  if (!f.byTab?.[tab]) return;
  const byTab = { ...f.byTab };
  delete byTab[tab];
  writeFieldsFile({ ...f, byTab });
}

/** Ánh xạ fieldKey -> label đã dùng lần đồng bộ Sheet gần nhất của 1 tab. */
export function loadSyncedLabels(tab: string): Record<string, string> {
  return readFieldsFile().syncedLabels?.[tab] ?? {};
}

/** Ghi lại ánh xạ fieldKey -> label sau khi đồng bộ (tạo tab / applyTabSync) thành công. */
export function saveSyncedLabels(tab: string, labels: Record<string, string>): void {
  const f = readFieldsFile();
  const syncedLabels = { ...(f.syncedLabels ?? {}), [tab]: labels };
  writeFieldsFile({ ...f, syncedLabels });
}


export function tokenPath(): string {
  return path.join(app.getPath('userData'), 'google-token.json');
}
