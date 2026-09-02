import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface ImportLogEntry {
  at: string; // ISO
  tab: string;
  rows: number;
  files: string[];
  estimatedUsd: number;
  totalTokens: number;
}

function logPath(): string {
  return path.join(app.getPath('userData'), 'import-history.json');
}

const MAX_ENTRIES = 200;

export function loadHistory(): ImportLogEntry[] {
  try {
    const raw = fs.readFileSync(logPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: ImportLogEntry): void {
  const list = loadHistory();
  list.unshift(entry);
  fs.writeFileSync(
    logPath(),
    JSON.stringify(list.slice(0, MAX_ENTRIES), null, 2),
    'utf-8'
  );
}

export function clearHistory(): void {
  try {
    fs.unlinkSync(logPath());
  } catch {
    // ignore
  }
}
