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

/** Bọc mọi gọi Sheets: nếu token hỏng -> xoá token + báo lỗi dễ hiểu để user đăng nhập lại. */
export async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.response?.status ?? err?.code;
    const msg = String(err?.message ?? '');
    if (
      status === 401 ||
      /invalid credentials|invalid_grant|invalid_token|unauthorized/i.test(msg)
    ) {
      signOut(); // xoá token hỏng
      throw new Error(
        'Phiên đăng nhập Google đã hết hạn. Vào Cài đặt → Đăng nhập Google lại.'
      );
    }
    throw err;
  }
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

/** Bọc tên tab thành A1 range an toàn (tên có dấu cách / số / nháy đơn). */
function q(tabTitle: string): string {
  return `'${tabTitle.replace(/'/g, "''")}'`;
}

/** Ký tự ngăn cách khi ghép khoá kép — dùng chung ở main lẫn renderer. */
export const KEY_SEP = '||';

export function normKey(s: string | undefined): string {
  return (s ?? '').toString().trim().toLowerCase();
}

/**
 * Đọc các cặp (giá trị cột A, giá trị cột B) đã có trong tab, để renderer đối chiếu trùng.
 * headerA/headerB: tên cột cần lấy (vd "Mã bệnh nhân", "Ngày khám").
 * Trả về mảng khoá ghép "a||b" đã chuẩn hoá (trim, lowercase).
 */
export async function existingKeyPairs(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  headerA: string,
  headerB: string
): Promise<string[]> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: q(tabTitle),
    majorDimension: 'ROWS',
  });
  const rows: string[][] = (resp.data.values as string[][]) ?? [];
  if (rows.length < 2) return [];
  const header = rows[0];
  const ia = header.indexOf(headerA);
  const ib = header.indexOf(headerB);
  if (ia === -1 || ib === -1) {
    throw new Error(
      `Tab "${tabTitle}" chưa có cột "${ia === -1 ? headerA : headerB}" ở hàng tiêu đề — ` +
        `hãy vào Cài đặt → chọn tab này → "Lưu & đồng bộ Google Sheet" để tạo đúng cột.`
    );
  }
  return rows
    .slice(1)
    .map((r) => `${normKey(r[ia])}${KEY_SEP}${normKey(r[ib])}`)
    .filter((k) => k !== KEY_SEP);
}

/**
 * Đọc giá trị đã có của 1 cột (vd Mã BN) trong tab — dùng chống trùng cho tab
 * "final" nơi mỗi bệnh nhân chỉ có 1 dòng (khác tab gốc cần khoá kép id+visitkey).
 */
export async function existingSingleKeys(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  header: string
): Promise<string[]> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: q(tabTitle),
    majorDimension: 'ROWS',
  });
  const rows: string[][] = (resp.data.values as string[][]) ?? [];
  if (rows.length < 2) return [];
  const idx = rows[0].indexOf(header);
  if (idx === -1) {
    throw new Error(
      `Tab "${tabTitle}" chưa có cột "${header}" ở hàng tiêu đề — hãy vào ` +
        `Cài đặt → chọn tab này → "Lưu & đồng bộ Google Sheet" để tạo đúng cột.`
    );
  }
  return rows
    .slice(1)
    .map((r) => normKey(r[idx]))
    .filter((k) => k !== '');
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
    range: `${q(tab.title)}!A1`,
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
    range: `${q(tabTitle)}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  // Các dòng vừa append có thể kế thừa định dạng in đậm của hàng tiêu đề -> ép bỏ đậm.
  const updatedRange = resp.data.updates?.updatedRange; // vd "'Tab'!A5:N7"
  if (updatedRange) {
    try {
      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, tabTitle);
      const m = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)$/);
      if (m) {
        const startRow = Number(m[1]) - 1;
        const endRow = Number(m[2]);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: startRow, endRowIndex: endRow },
                  cell: { userEnteredFormat: { textFormat: { bold: false } } },
                  fields: 'userEnteredFormat.textFormat.bold',
                },
              },
            ],
          },
        });
      }
    } catch {
      // không chặn import chỉ vì lỗi format
    }
  }

  return resp.data.updates?.updatedRows ?? 0;
}

/**
 * Ghi đè (update) các dòng đã tồn tại theo giá trị khoá ở 1 cột (vd Mã BN),
 * dùng cho tab "-final": mỗi bệnh nhân đúng 1 dòng, luôn là bản mới nhất.
 * keyHeader: tên cột dùng để tìm dòng cần ghi đè. keyColIndexInRow: index của
 * cột khoá trong mỗi phần tử của `rows` (để đọc giá trị khoá tương ứng).
 * Trả về số dòng đã update (không tính append — hàm này giả định mọi dòng
 * truyền vào đều đã có sẵn, gọi appendRows() riêng cho dòng chưa có).
 */
export async function updateRowsByKey(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  keyHeader: string,
  rows: string[][],
  keyColIndexInRow: number
): Promise<number> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: q(tabTitle),
    majorDimension: 'ROWS',
  });
  const existingRows: string[][] = (resp.data.values as string[][]) ?? [];
  if (existingRows.length < 1) return 0;
  const header = existingRows[0];
  const keyIdx = header.indexOf(keyHeader);
  if (keyIdx === -1) {
    throw new Error(
      `Tab "${tabTitle}" chưa có cột "${keyHeader}" ở hàng tiêu đề.`
    );
  }

  // map giá trị khoá (chuẩn hoá) -> số dòng thật trên Sheet (1-based)
  const rowByKey = new Map<string, number>();
  for (let i = 1; i < existingRows.length; i++) {
    const k = normKey(existingRows[i][keyIdx]);
    if (k) rowByKey.set(k, i + 1); // +1 vì Sheet 1-based, existingRows 0-based
  }

  let updated = 0;
  const requests: { range: string; values: string[][] }[] = [];
  for (const row of rows) {
    const k = normKey(row[keyColIndexInRow]);
    const sheetRow = rowByKey.get(k);
    if (!sheetRow) continue; // không có sẵn -> để appendRows() xử lý riêng
    const lastCol = colLetter(row.length);
    requests.push({
      range: `${q(tabTitle)}!A${sheetRow}:${lastCol}${sheetRow}`,
      values: [row],
    });
    updated++;
  }
  if (requests.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: requests,
    },
  });
  return updated;
}

/**
 * Ghi đè (update) các dòng đã tồn tại theo khoá KÉP ở 2 cột (vd Mã BN + Ngày
 * khám), dùng cho tab gốc: mỗi đợt khám là 1 dòng, xác định bằng cặp khoá này.
 * keyColIndexA/B: index của 2 cột khoá trong mỗi phần tử của `rows`.
 * Trả về số dòng đã update (không tính append — hàm này giả định mọi dòng
 * truyền vào đều đã có sẵn, gọi appendRows() riêng cho dòng chưa có).
 */
export async function updateRowsByKeyPair(
  clientId: string,
  clientSecret: string,
  spreadsheetId: string,
  tabTitle: string,
  keyHeaderA: string,
  keyHeaderB: string,
  rows: string[][],
  keyColIndexA: number,
  keyColIndexB: number
): Promise<number> {
  const sheets = google.sheets({ version: 'v4', auth: getClient(clientId, clientSecret) });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: q(tabTitle),
    majorDimension: 'ROWS',
  });
  const existingRows: string[][] = (resp.data.values as string[][]) ?? [];
  if (existingRows.length < 1) return 0;
  const header = existingRows[0];
  const idxA = header.indexOf(keyHeaderA);
  const idxB = header.indexOf(keyHeaderB);
  if (idxA === -1 || idxB === -1) {
    throw new Error(
      `Tab "${tabTitle}" chưa có cột "${idxA === -1 ? keyHeaderA : keyHeaderB}" ở hàng tiêu đề.`
    );
  }

  // map khoá ghép (chuẩn hoá) -> số dòng thật trên Sheet (1-based)
  const rowByKey = new Map<string, number>();
  for (let i = 1; i < existingRows.length; i++) {
    const k = `${normKey(existingRows[i][idxA])}${KEY_SEP}${normKey(existingRows[i][idxB])}`;
    if (k !== KEY_SEP) rowByKey.set(k, i + 1); // +1 vì Sheet 1-based, existingRows 0-based
  }

  let updated = 0;
  const requests: { range: string; values: string[][] }[] = [];
  for (const row of rows) {
    const k = `${normKey(row[keyColIndexA])}${KEY_SEP}${normKey(row[keyColIndexB])}`;
    const sheetRow = rowByKey.get(k);
    if (!sheetRow) continue; // không có sẵn -> để appendRows() xử lý riêng
    const lastCol = colLetter(row.length);
    requests.push({
      range: `${q(tabTitle)}!A${sheetRow}:${lastCol}${sheetRow}`,
      values: [row],
    });
    updated++;
  }
  if (requests.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: requests,
    },
  });
  return updated;
}

/** Chuyển số cột (1-based) sang ký hiệu cột Sheet (1 -> A, 27 -> AA...). */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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
    range: `${q(tabTitle)}!1:1`,
  });
  const existing = cur.data.values?.[0] ?? [];
  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${q(tabTitle)}!A1`,
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
    range: q(tabTitle),
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
    range: q(tabTitle),
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
    range: q(tabTitle),
  });

  const values = [newHeaders, ...rebuilt];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${q(tabTitle)}!A1`,
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
  const cols = Math.max(colCount, 1);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // hàng 1: in đậm
        {
          repeatCell: {
            range: {
              sheetId: id,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: cols,
            },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        // từ hàng 2 trở xuống: KHÔNG đậm (tránh dòng data mới kế thừa format đậm của hàng 1)
        {
          repeatCell: {
            range: {
              sheetId: id,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: cols,
            },
            cell: { userEnteredFormat: { textFormat: { bold: false } } },
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
