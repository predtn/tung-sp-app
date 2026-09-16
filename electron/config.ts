import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, FieldDef } from './types';

const DEFAULT_CONFIG: AppConfig = {
  openaiApiKey: '',
  openaiModel: 'gpt-5-mini',
  googleClientId: '',
  googleClientSecret: '',
  spreadsheetId: '',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

// model đã bỏ khỏi lựa chọn trong Cài đặt -> map sang model thay thế khi đọc
// config cũ, tránh âm thầm tiếp tục gọi model không còn được hỗ trợ chính thức.
const MODEL_MIGRATIONS: Record<string, string> = {
  'gpt-4.1-mini': 'gpt-5-mini',
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


export function tokenPath(): string {
  return path.join(app.getPath('userData'), 'google-token.json');
}
