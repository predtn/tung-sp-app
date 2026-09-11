import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  loadConfig,
  saveConfig,
  loadFields,
  saveFields,
  loadFieldsForTab,
  saveFieldsForTab,
  configuredTabs,
  deleteFieldsForTab,
} from './config';
import { extractPdf, LONG_FILE_WARNING_PAGES } from './pdf';
import { extractRecord } from './extract';
import * as gs from './google';
import { loadHistory, addHistory, clearHistory } from './history';
import {
  hashFile,
  getCached,
  putCached,
  clearCache,
  cacheStats,
  peekCache,
} from './scanCache';
import type { AppConfig, ExtractedRecord, FieldDef } from './types';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

const APP_NAME = 'RxScan';
// dev: chạy từ dist-electron/, prod: resources được đóng gói kèm (extraResources).
// Dùng .ico (đa kích thước) cho icon cửa sổ/taskbar trên Windows — PNG đơn kích
// thước đôi khi bị Windows fallback về icon mặc định ở taskbar.
const ICON_PATH = isDev
  ? path.join(__dirname, '../assets/icon.ico')
  : path.join(process.resourcesPath, 'assets/icon.ico');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    title: APP_NAME,
    icon: ICON_PATH,
    // ẩn hẳn thanh menu (File / Edit / View / Window / Help)
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    // Mở DevTools thủ công bằng F12 khi cần debug (bật dòng dưới nếu muốn tự mở).
    // win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12') win.webContents.toggleDevTools();
    });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // giữ tiêu đề cửa sổ theo tên app, không để thẻ <title> trong HTML ghi đè
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle(APP_NAME);
  });
}

// Tên hiển thị của app đổi được, NHƯNG thư mục lưu dữ liệu phải cố định,
// nếu không mỗi lần đổi tên là mất hết cấu hình đã lưu.
app.setName(APP_NAME);
// Windows: taskbar gộp/gán icon theo AppUserModelID, phải khớp appId trong
// electron-builder.json — thiếu dòng này taskbar hay rơi về icon mặc định.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.tung.rxscan');
}
const FIXED_USER_DATA = path.join(app.getPath('appData'), 'tung-sp-app');
app.setPath('userData', FIXED_USER_DATA);

// Migrate dữ liệu từ các thư mục userData cũ (đặt theo tên hiển thị) nếu có.
function migrateOldUserData() {
  try {
    fs.mkdirSync(FIXED_USER_DATA, { recursive: true });
    const appDataDir = app.getPath('appData');
    const legacyDirs = ['Nhập liệu không khó', 'nhập liệu không khó', 'RxScan'];
    const files = [
      'config.json',
      'google-token.json',
      'fields.config.json',
      'import-history.json',
    ];
    for (const dir of legacyDirs) {
      const legacyPath = path.join(appDataDir, dir);
      if (!fs.existsSync(legacyPath)) continue;
      for (const f of files) {
        const src = path.join(legacyPath, f);
        const dest = path.join(FIXED_USER_DATA, f);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  } catch (err) {
    console.error('migrate userData failed:', err);
  }
}
migrateOldUserData();

app.whenReady().then(() => {
  // bỏ hẳn menu ứng dụng; nhấn Alt cũng không hiện lại
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_e, cfg: AppConfig) => {
    saveConfig(cfg);
    return true;
  });
  ipcMain.handle('fields:get', () => loadFields());
  ipcMain.handle('fields:set', (_e, fields: FieldDef[]) => {
    const cleaned = validateFields(fields);
    saveFields(cleaned);
    return cleaned;
  });
  ipcMain.handle('fields:getForTab', (_e, tab: string) => loadFieldsForTab(tab));
  ipcMain.handle('fields:setForTab', (_e, tab: string, fields: FieldDef[]) => {
    const cleaned = validateFields(fields);
    saveFieldsForTab(tab, cleaned);
    return cleaned;
  });
  ipcMain.handle('fields:configuredTabs', () => configuredTabs());
  ipcMain.handle('fields:deleteForTab', (_e, tab: string) => {
    deleteFieldsForTab(tab);
    return true;
  });

  // Lập kế hoạch đồng bộ cột của tab theo bộ trường (chỉ đọc)
  ipcMain.handle(
    'sheets:planSync',
    async (_e, tabTitle: string, fields: FieldDef[]) => {
      const cfg = loadConfig();
      const headers = fields.map((f) => f.label);
      headers.push('Thời gian nhập');
      return gs.withAuth(() =>
        gs.planTabSync(
          cfg.googleClientId,
          cfg.googleClientSecret,
          cfg.spreadsheetId,
          tabTitle,
          headers
        )
      );
    }
  );

  // Đối chiếu trùng: trả về danh sách khoá "maBN ngayKham" đã có trong tab
  ipcMain.handle(
    'sheets:existingKeys',
    async (_e, tabTitle: string, headerA: string, headerB: string) => {
      const cfg = loadConfig();
      return gs.withAuth(() =>
        gs.existingKeyPairs(
          cfg.googleClientId,
          cfg.googleClientSecret,
          cfg.spreadsheetId,
          tabTitle,
          headerA,
          headerB
        )
      );
    }
  );

  // Thực thi đồng bộ cột (ghi lại tab)
  ipcMain.handle(
    'sheets:applySync',
    async (_e, tabTitle: string, fields: FieldDef[]) => {
      const cfg = loadConfig();
      const headers = fields.map((f) => f.label);
      headers.push('Thời gian nhập');
      await gs.withAuth(() =>
        gs.applyTabSync(
          cfg.googleClientId,
          cfg.googleClientSecret,
          cfg.spreadsheetId,
          tabTitle,
          headers
        )
      );
      return true;
    }
  );

  ipcMain.handle('pdf:pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn file PDF bệnh nhân',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  // Kiểm tra file nào đã có cache (để renderer hỏi bác sĩ trước khi quét).
  ipcMain.handle(
    'pdf:peekCache',
    (_e, filePaths: string[], tab?: string) => {
      const fields = tab ? loadFieldsForTab(tab) : loadFields();
      return filePaths.map((p) => ({
        path: p,
        name: path.basename(p),
        ...peekCache(p, fields),
      }));
    }
  );

  // Xử lý 1 file: đọc PDF + gọi AI theo bộ trường của tab đích. Trả record.
  // forceRescan=true -> bỏ qua cache, luôn gọi AI (bác sĩ chọn "quét lại").
  ipcMain.handle(
    'process:file',
    async (
      _e,
      filePath: string,
      tab?: string,
      forceRescan?: boolean
    ): Promise<ExtractedRecord> => {
    const cfg = loadConfig();
    const fields = tab ? loadFieldsForTab(tab) : loadFields();
    const blank = (error: string): ExtractedRecord => ({
      values: Object.fromEntries(fields.map((f) => [f.key, ''])),
      uncertain: Object.fromEntries(fields.map((f) => [f.key, true])),
      sourceFile: path.basename(filePath),
      sourcePath: filePath,
      error,
    });
    try {
      const hash = hashFile(filePath);
      if (!forceRescan) {
        const cached = getCached(hash, fields);
        if (cached) {
          return {
            values: cached.values,
            uncertain: cached.uncertain,
            sourceFile: path.basename(filePath),
            sourcePath: filePath,
            fromCache: true,
          };
        }
      }
      if (!cfg.openaiApiKey) {
        return blank('Chưa cấu hình OpenAI API key trong phần Cài đặt.');
      }
      const pdf = await extractPdf(filePath);
      const rec = await extractRecord(pdf, fields, cfg.openaiApiKey, cfg.openaiModel);
      const out: ExtractedRecord = {
        ...rec,
        sourcePath: filePath,
        totalPages: pdf.totalPages,
        isLongFile: pdf.totalPages > LONG_FILE_WARNING_PAGES,
      };
      putCached(hash, out, fields, cfg.openaiModel);
      return out;
    } catch (err: any) {
      return blank(err?.message ?? String(err));
    }
    }
  );

  // Mở file PDF gốc bằng ứng dụng mặc định của hệ điều hành
  ipcMain.handle('pdf:open', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Không tìm thấy file: ' + (filePath || '(trống)'));
    }
    const err = await shell.openPath(filePath);
    if (err) throw new Error(err);
    return true;
  });

  // Đọc nội dung file PDF để hiển thị trong panel xem của app
  ipcMain.handle('pdf:read', async (_e, filePath: string): Promise<Uint8Array> => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Không tìm thấy file: ' + (filePath || '(trống)'));
    }
    return new Uint8Array(fs.readFileSync(filePath));
  });

  // Google
  ipcMain.handle('google:status', () => ({ signedIn: gs.isSignedIn() }));
  ipcMain.handle('google:signin', async () => {
    const cfg = loadConfig();
    if (!cfg.googleClientId || !cfg.googleClientSecret) {
      throw new Error('Chưa cấu hình Google Client ID/Secret trong phần Cài đặt.');
    }
    await gs.signIn(cfg.googleClientId, cfg.googleClientSecret);
    return { signedIn: true };
  });
  ipcMain.handle('google:signout', () => {
    gs.signOut();
    return { signedIn: false };
  });

  ipcMain.handle('sheets:tabs', async () => {
    const cfg = loadConfig();
    return gs.withAuth(() =>
      gs.listTabs(cfg.googleClientId, cfg.googleClientSecret, cfg.spreadsheetId)
    );
  });

  ipcMain.handle('sheets:createTab', async (_e, title: string) => {
    const cfg = loadConfig();
    // tab mới lấy bộ trường chung làm khởi tạo, đồng thời lưu thành cấu hình riêng của tab
    const fields = loadFields();
    const headers = fields.map((f) => f.label);
    headers.push('Thời gian nhập');
    const tab = await gs.withAuth(() =>
      gs.createTab(
        cfg.googleClientId,
        cfg.googleClientSecret,
        cfg.spreadsheetId,
        title,
        headers
      )
    );
    // chỉ lưu cấu hình trường của tab sau khi tạo thành công trên Sheet
    saveFieldsForTab(title, fields);
    return tab;
  });

  ipcMain.handle(
    'sheets:append',
    async (_e, tabTitle: string, records: ExtractedRecord[]) => {
      const cfg = loadConfig();
      const fields = loadFieldsForTab(tabTitle);
      const headers = fields.map((f) => f.label);
      headers.push('Thời gian nhập');

      await gs.withAuth(() =>
        gs.ensureHeaders(
          cfg.googleClientId,
          cfg.googleClientSecret,
          cfg.spreadsheetId,
          tabTitle,
          headers
        )
      );

      const now = new Date().toLocaleString('vi-VN');
      const rows = records.map((r) => {
        const row = fields.map((f) => r.values[f.key] ?? '');
        row.push(now);
        return row;
      });

      const n = await gs.withAuth(() =>
        gs.appendRows(
          cfg.googleClientId,
          cfg.googleClientSecret,
          cfg.spreadsheetId,
          tabTitle,
          rows
        )
      );

      addHistory({
        at: new Date().toISOString(),
        tab: tabTitle,
        rows: n,
        files: records.map((r) => r.sourceFile),
        estimatedUsd: records.reduce(
          (s, r) => s + (r.usage?.estimatedUsd ?? 0),
          0
        ),
        totalTokens: records.reduce((s, r) => s + (r.usage?.totalTokens ?? 0), 0),
      });

      return { appended: n };
    }
  );

  ipcMain.handle('history:get', () => loadHistory());
  ipcMain.handle('history:clear', () => {
    clearHistory();
    return true;
  });

  ipcMain.handle('cache:stats', () => cacheStats());
  ipcMain.handle('cache:clear', () => {
    clearCache();
    return true;
  });
}

function validateFields(fields: FieldDef[]): FieldDef[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Phải có ít nhất 1 trường.');
  }
  const seen = new Set<string>();
  const cleaned: FieldDef[] = [];
  let idCount = 0;
  let visitKeyCount = 0;
  for (const raw of fields) {
    const label = (raw.label ?? '').trim();
    const description = (raw.description ?? '').trim();
    const example = (raw.example ?? '').trim();
    const role: FieldDef['role'] =
      raw.role === 'id' ||
      raw.role === 'visitkey' ||
      raw.role === 'fixed'
        ? raw.role
        : 'varying';
    if (role === 'id') idCount++;
    if (role === 'visitkey') visitKeyCount++;
    if (!label) throw new Error('Mỗi trường phải có tên cột (label).');

    let key = (raw.key ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // bỏ dấu
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!key) key = `field_${cleaned.length + 1}`;

    let uniqueKey = key;
    let n = 2;
    while (seen.has(uniqueKey)) {
      uniqueKey = `${key}_${n++}`;
    }
    seen.add(uniqueKey);

    const item: FieldDef = { key: uniqueKey, label, description, role };
    if (example) item.example = example;
    cleaned.push(item);
  }
  if (idCount > 1) {
    throw new Error(
      'Chỉ được 1 trường có vai trò "Định danh" (mã bệnh nhân). Đang có ' +
        idCount +
        '.'
    );
  }
  if (visitKeyCount > 1) {
    throw new Error(
      'Chỉ được 1 trường có vai trò "Khoá đợt khám". Đang có ' + visitKeyCount + '.'
    );
  }
  return cleaned;
}
