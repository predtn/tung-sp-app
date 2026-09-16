import { useState } from 'react';
import type { AppConfig } from '../electron/types';
import CustomSelect from './CustomSelect';

interface Props {
  config: AppConfig;
  signedIn: boolean;
  onSave: (c: AppConfig) => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

export default function GoogleSettings({
  config,
  signedIn,
  onSave,
  onSignIn,
  onSignOut,
  onClose,
}: Props) {
  const [c, setC] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    setC({ ...c, [k]: v });
  }

  const canSignIn = !!c.googleClientId && !!c.googleClientSecret && !!c.spreadsheetId;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(c);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignIn() {
    // luôn lưu trước để main process có Client ID/Secret mới nhất
    await onSave(c);
    onSignIn();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Kết nối OpenAI &amp; Google Sheets</h3>

        <div className="settings-section">
          <h4>OpenAI</h4>
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
            <CustomSelect
              value={
                ['gpt-5-mini', 'gpt-4.1'].includes(c.openaiModel)
                  ? c.openaiModel
                  : 'gpt-5-mini'
              }
              onChange={(v) => set('openaiModel', v)}
              options={[
                {
                  value: 'gpt-5-mini',
                  label: 'gpt-5-mini — nhanh, rẻ, đủ tốt cho hồ sơ rõ ràng (khuyên dùng)',
                },
                {
                  value: 'gpt-4.1',
                  label: 'gpt-4.1 — chính xác cao nhất, đắt hơn nhiều',
                },
              ]}
            />
            <span className="hint">
              Bác sĩ đã soát từng ô ở bước 2 nên sai nhỏ của model rẻ không nghiêm
              trọng. Đổi lên gpt-4.1 nếu hồ sơ khó / scan mờ hay bị sai.
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h4>Google Sheets</h4>
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
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label style={{ margin: 0 }}>
                Spreadsheet ID (lấy từ URL Google Sheet)
              </label>
              {c.spreadsheetId && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => window.api.openSheetExternal(c.spreadsheetId)}
                  title="Mở Google Sheet này bằng trình duyệt"
                >
                  Mở Sheet ↗
                </button>
              )}
            </div>
            <input
              value={c.spreadsheetId}
              placeholder="1AbC...xyz"
              onChange={(e) => set('spreadsheetId', e.target.value)}
            />
          </div>
          {!canSignIn && !signedIn && (
            <p className="hint text-danger">
              Điền đủ Client ID, Client Secret và Spreadsheet ID để đăng nhập được.
            </p>
          )}
        </div>

        <div className="row settings-section" style={{ marginTop: 0, paddingBottom: 0 }}>
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={onClose}>
              Đóng
            </button>
            <button onClick={handleSave} disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
