import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import { shell } from 'electron';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { tokenPath } from './config';
import type { SheetTab } from './types';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const REDIRECT_PORT = 42813;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;

let oauthClient: OAuth2Client | null = null;

export function isSignedIn(): boolean {
  try {
    const t = JSON.parse(fs.readFileSync(tokenPath(), 'utf-8'));
    return !!t.refresh_token || !!t.access_token;
  } catch {
    return false;
  }
}

function makeClient(clientId: string, clientSecret: string): OAuth2Client {
  const c = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  try {
    const tok = JSON.parse(fs.readFileSync(tokenPath(), 'utf-8'));
    c.setCredentials(tok);
  } catch {
    // chưa đăng nhập
  }
  c.on('tokens', (tokens) => {
    const existing = (() => {
      try {
        return JSON.parse(fs.readFileSync(tokenPath(), 'utf-8'));
      } catch {
        return {};
      }
    })();
    fs.writeFileSync(
      tokenPath(),
      JSON.stringify({ ...existing, ...tokens }, null, 2),
      'utf-8'
    );
  });
  return c;
}

export async function signIn(
  clientId: string,
  clientSecret: string
): Promise<void> {
  const client = makeClient(clientId, clientSecret);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '', REDIRECT_URI);
        const c = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (err) {
          res.end(`<p>Lỗi đăng nhập: ${err}. Bạn có thể đóng tab này.</p>`);
          server.close();
          reject(new Error(err));
          return;
        }
        if (c) {
          res.end('<p>Đăng nhập thành công! Bạn có thể đóng tab này và quay lại ứng dụng.</p>');
          server.close();
          resolve(c);
        }
      } catch (e) {
        reject(e as Error);
      }
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl);
    });
    server.on('error', reject);
    setTimeout(() => {
      server.close();
      reject(new Error('Hết thời gian chờ đăng nhập (2 phút).'));
    }, 120_000);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2), 'utf-8');
  oauthClient = client;
}

export function signOut(): void {
  try {
    fs.unlinkSync(tokenPath());
  } catch {
    // ignore
  }
  oauthClient = null;
}

function getClient(clientId: string, clientSecret: string): OAuth2Client {
  if (!oauthClient) oauthClient = makeClient(clientId, clientSecret);
  return oauthClient;
}

export async function listTabs(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string
): Promise<SheetTab[]> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets ?? []).map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title ?? '',
  }));
}

export async function createTab(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  title: string,
  headers: string[]
): Promise<SheetTab> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  const added = resp.data.replies?.[0]?.addSheet?.properties;
  const tab: SheetTab = {
    sheetId: added?.sheetId ?? 0,
    title: added?.title ?? title,
  };
  // ghi hàng tiêu đề + in đậm
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab.title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  await boldHeaderRow(sheets, spreadsheetId, tab.title, headers.length, tab.sheetId);
  return tab;
}

export async function appendRows(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  rows: string[][]
): Promise<number> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });

  // đảm bảo có hàng tiêu đề? -> để renderer quyết định; ở đây chỉ append
  // valueInputOption RAW: giữ nguyên chuỗi text, không để Sheets tự "hiểu" và
  // chuyển các giá trị giống ngày tháng (vd "15/03/1992") thành số serial ngày.
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabTitle}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  return resp.data.updates?.updatedRows ?? 0;
}

export async function ensureHeaders(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  headers: string[]
): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const cur = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabTitle}!1:1`,
  });
  const existing = cur.data.values?.[0] ?? [];
  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabTitle}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
    await boldHeaderRow(sheets, spreadsheetId, tabTitle, headers.length);
  }
}

// ---- Đồng bộ cột của tab theo bộ trường đã cấu hình ----

export interface TabSyncPlan {
  currentHeaders: string[];
  newHeaders: string[];
  /** cột sẽ bị xoá cùng dữ liệu: tên + số ô có nội dung bên dưới */
  removedColumns: { name: string; nonEmptyCells: number }[];
  addedColumns: string[];
  reordered: boolean;
  dataRowCount: number;
}

async function getSheetIdByTitle(
  sheets: any,
  spreadsheetId: string,
  title: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const s = (meta.data.sheets ?? []).find(
    (x: any) => x.properties?.title === title
  );
  if (!s) throw new Error(`Không tìm thấy tab "${title}"`);
  return s.properties.sheetId;
}

/** Đọc trạng thái hiện tại của tab và lập kế hoạch đồng bộ (chưa ghi gì). */
export async function planTabSync(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  newHeaders: string[]
): Promise<TabSyncPlan> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabTitle}`,
    majorDimension: 'ROWS',
  });
  const rows: string[][] = (resp.data.values as string[][]) ?? [];
  const currentHeaders = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const newSet = new Set(newHeaders);
  const curSet = new Set(currentHeaders);

  const removedColumns = currentHeaders
    .map((name, idx) => ({ name, idx }))
    .filter((c) => c.name && !newSet.has(c.name))
    .map((c) => ({
      name: c.name,
      nonEmptyCells: dataRows.filter(
        (r) => (r[c.idx] ?? '').toString().trim() !== ''
      ).length,
    }));

  const addedColumns = newHeaders.filter((h) => !curSet.has(h));

  // đổi thứ tự: các cột chung xuất hiện theo trình tự khác nhau
  const commonCur = currentHeaders.filter((h) => newSet.has(h));
  const commonNew = newHeaders.filter((h) => curSet.has(h));
  const reordered = commonCur.join('') !== commonNew.join('');

  return {
    currentHeaders,
    newHeaders,
    removedColumns,
    addedColumns,
    reordered,
    dataRowCount: dataRows.length,
  };
}

/** Ghi lại toàn bộ tab: cột sắp theo newHeaders, dữ liệu khớp theo tên cột. */
export async function applyTabSync(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  newHeaders: string[]
): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabTitle}`,
    majorDimension: 'ROWS',
  });
  const rows: string[][] = (resp.data.values as string[][]) ?? [];
  const curHeaders = rows[0] ?? [];
  const dataRows = rows.slice(1);

  // map: tên cột -> chỉ số cột cũ
  const colIdx = new Map<string, number>();
  curHeaders.forEach((h, i) => {
    if (h && !colIdx.has(h)) colIdx.set(h, i);
  });

  // dựng lại từng dòng theo thứ tự newHeaders (cột mới -> rỗng)
  const rebuilt = dataRows.map((r) =>
    newHeaders.map((h) => {
      const i = colIdx.get(h);
      return i === undefined ? '' : r[i] ?? '';
    })
  );

  const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, tabTitle);

  // xoá sạch vùng cũ rồi ghi lại (đơn giản, tránh lệch cột)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabTitle}`,
  });

  const values = [newHeaders, ...rebuilt];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabTitle}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  await boldHeaderRow(sheets, spreadsheetId, tabTitle, newHeaders.length, sheetId);
}

/** In đậm hàng 1 của tab. */
async function boldHeaderRow(
  sheets: any,
  spreadsheetId: string,
  tabTitle: string,
  colCount: number,
  sheetId?: number
): Promise<void> {
  const id =
    sheetId ?? (await getSheetIdByTitle(sheets, spreadsheetId, tabTitle));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: id,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: Math.max(colCount, 1),
            },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: id, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });
}
