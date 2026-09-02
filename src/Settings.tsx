import { useState } from 'react';
import type { AppConfig, FieldDef } from '../electron/types';
import FieldsEditor from './FieldsEditor';

interface Props {
  config: AppConfig;
  fields: FieldDef[];
  signedIn: boolean;
  onSave: (c: AppConfig) => Promise<void>;
  onSaveSharedFields: (fields: FieldDef[]) => Promise<FieldDef[]>;
  onTabsChanged: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function Settings({
  config,
  fields,
  signedIn,
  onSave,
  onSaveSharedFields,
  onTabsChanged,
  onSignIn,
  onSignOut,
}: Props) {
  const [c, setC] = useState<AppConfig>(config);

  function set<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    setC({ ...c, [k]: v });
  }

  const canSignIn = !!c.googleClientId && !!c.googleClientSecret && !!c.spreadsheetId;

  async function handleSignIn() {
    // luôn lưu trước để main process có Client ID/Secret mới nhất
    await onSave(c);
    onSignIn();
  }

  return (
    <>
      <div className="card">
        <h2>OpenAI</h2>
        <div className="field">
          <label>API Key</label>
          <input
            type="password"
            value={c.openaiApiKey}
            placeholder="sk-..."
            onChange={(e) => set('openaiApiKey', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Model</label>
          <input
            value={c.openaiModel}
            placeholder="gpt-4o"
            onChange={(e) => set('openaiModel', e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>Google Sheets</h2>
        <div className="field">
          <label>OAuth Client ID</label>
          <input
            value={c.googleClientId}
            placeholder="...apps.googleusercontent.com"
            onChange={(e) => set('googleClientId', e.target.value)}
          />
        </div>
        <div className="field">
          <label>OAuth Client Secret</label>
          <input
            type="password"
            value={c.googleClientSecret}
            onChange={(e) => set('googleClientSecret', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Spreadsheet ID (lấy từ URL Google Sheet)</label>
          <input
            value={c.spreadsheetId}
            placeholder="1AbC...xyz"
            onChange={(e) => set('spreadsheetId', e.target.value)}
          />
        </div>
        <div className="row">
          {signedIn ? (
            <>
              <span className="badge ok">Đã đăng nhập</span>
              <button className="secondary" onClick={onSignOut}>
                Đăng xuất
              </button>
            </>
          ) : (
            <button onClick={handleSignIn} disabled={!canSignIn}>
              Đăng nhập Google
            </button>
          )}
        </div>
        {!canSignIn && !signedIn && (
          <p style={{ fontSize: 12, color: '#b71c1c' }}>
            Điền đủ Client ID, Client Secret và Spreadsheet ID để đăng nhập được.
          </p>
        )}
      </div>

      <FieldsEditor
        fields={fields}
        signedIn={signedIn}
        onSaveShared={onSaveSharedFields}
        onTabsChanged={onTabsChanged}
      />

      <button onClick={() => onSave(c)}>Lưu cài đặt</button>
    </>
  );
}
