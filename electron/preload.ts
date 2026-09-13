import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppConfig, ExtractedRecord, FieldDef, SheetTab } from './types';
import type { ImportLogEntry } from './history';
import type { TabSyncPlan } from './google';

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (cfg: AppConfig): Promise<boolean> => ipcRenderer.invoke('config:set', cfg),
  getFields: (): Promise<FieldDef[]> => ipcRenderer.invoke('fields:get'),
  setFields: (fields: FieldDef[]): Promise<FieldDef[]> =>
    ipcRenderer.invoke('fields:set', fields),
  getFieldsForTab: (tab: string): Promise<FieldDef[]> =>
    ipcRenderer.invoke('fields:getForTab', tab),
  setFieldsForTab: (tab: string, fields: FieldDef[]): Promise<FieldDef[]> =>
    ipcRenderer.invoke('fields:setForTab', tab, fields),
  configuredTabs: (): Promise<string[]> =>
    ipcRenderer.invoke('fields:configuredTabs'),
  deleteFieldsForTab: (tab: string): Promise<boolean> =>
    ipcRenderer.invoke('fields:deleteForTab', tab),
  planTabSync: (tab: string, fields: FieldDef[]): Promise<TabSyncPlan> =>
    ipcRenderer.invoke('sheets:planSync', tab, fields),
  existingKeys: (
    tab: string,
    headerA: string,
    headerB: string
  ): Promise<string[]> =>
    ipcRenderer.invoke('sheets:existingKeys', tab, headerA, headerB),
  existingSingleKeys: (tab: string, header: string): Promise<string[]> =>
    ipcRenderer.invoke('sheets:existingSingleKeys', tab, header),
  applyTabSync: (tab: string, fields: FieldDef[]): Promise<boolean> =>
    ipcRenderer.invoke('sheets:applySync', tab, fields),

  pickPdfs: (): Promise<string[]> => ipcRenderer.invoke('pdf:pick'),
  // Electron 32+ không còn lộ File.path trong renderer vì lý do bảo mật ->
  // phải lấy đường dẫn thật qua webUtils trong preload (kéo-thả file).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  peekCache: (
    filePaths: string[],
    tab?: string
  ): Promise<
    { path: string; name: string; hash: string; cached: boolean; at?: string; model?: string }[]
  > => ipcRenderer.invoke('pdf:peekCache', filePaths, tab),
  processFile: (
    filePath: string,
    tab?: string,
    forceRescan?: boolean
  ): Promise<ExtractedRecord> =>
    ipcRenderer.invoke('process:file', filePath, tab, forceRescan),
  openPdf: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('pdf:open', filePath),
  openSheetExternal: (spreadsheetId: string): Promise<boolean> =>
    ipcRenderer.invoke('sheets:openExternal', spreadsheetId),
  readPdf: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdf:read', filePath),

  googleStatus: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:status'),
  googleSignIn: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:signin'),
  googleSignOut: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:signout'),

  listTabs: (includeFinal?: boolean): Promise<SheetTab[]> =>
    ipcRenderer.invoke('sheets:tabs', includeFinal),
  createTab: (title: string): Promise<SheetTab> => ipcRenderer.invoke('sheets:createTab', title),
  appendRows: (
    tabTitle: string,
    records: ExtractedRecord[]
  ): Promise<{ appended: number }> => ipcRenderer.invoke('sheets:append', tabTitle, records),
  upsertRows: (
    tabTitle: string,
    records: ExtractedRecord[],
    keyFieldKey: string
  ): Promise<{ updated: number; appended: number }> =>
    ipcRenderer.invoke('sheets:upsert', tabTitle, records, keyFieldKey),

  getHistory: (): Promise<ImportLogEntry[]> => ipcRenderer.invoke('history:get'),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('history:clear'),

  cacheStats: (): Promise<{ count: number }> => ipcRenderer.invoke('cache:stats'),
  clearCache: (): Promise<boolean> => ipcRenderer.invoke('cache:clear'),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
