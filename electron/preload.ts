import { contextBridge, ipcRenderer } from 'electron';
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
  applyTabSync: (tab: string, fields: FieldDef[]): Promise<boolean> =>
    ipcRenderer.invoke('sheets:applySync', tab, fields),

  pickPdfs: (): Promise<string[]> => ipcRenderer.invoke('pdf:pick'),
  processFile: (filePath: string, tab?: string): Promise<ExtractedRecord> =>
    ipcRenderer.invoke('process:file', filePath, tab),
  openPdf: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('pdf:open', filePath),
  readPdf: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdf:read', filePath),

  googleStatus: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:status'),
  googleSignIn: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:signin'),
  googleSignOut: (): Promise<{ signedIn: boolean }> => ipcRenderer.invoke('google:signout'),

  listTabs: (): Promise<SheetTab[]> => ipcRenderer.invoke('sheets:tabs'),
  createTab: (title: string): Promise<SheetTab> => ipcRenderer.invoke('sheets:createTab', title),
  appendRows: (
    tabTitle: string,
    records: ExtractedRecord[]
  ): Promise<{ appended: number }> => ipcRenderer.invoke('sheets:append', tabTitle, records),

  getHistory: (): Promise<ImportLogEntry[]> => ipcRenderer.invoke('history:get'),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('history:clear'),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
