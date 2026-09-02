import { useEffect, useState } from 'react';
import type { AppConfig, ExtractedRecord, FieldDef, SheetTab } from '../electron/types';
import Settings from './Settings';
import ReviewTable from './ReviewTable';
import History from './History';
import PdfPanel from './PdfPanel';
import { validateRecords, countUncertain } from './validation';

type View = 'main' | 'settings' | 'history';

export default function App() {
  const [view, setView] = useState<View>('main');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  const [records, setRecords] = useState<ExtractedRecord[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [drag, setDrag] = useState(false);

  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [toast, setToast] = useState('');
  // file PDF đang xem trong panel bên phải (null = ẩn panel)
  const [pdfView, setPdfView] = useState<{ path: string; name: string } | null>(null);

  useEffect(() => {
    window.api.getConfig().then(setConfig);
    window.api.getFields().then(setFields);
    window.api.googleStatus().then((s) => setSignedIn(s.signedIn));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  // Trả về danh sách tab mới nhất. quiet=true: không hiện toast lỗi (dùng khi refresh ngầm).
  async function refreshTabs(quiet = false): Promise<SheetTab[]> {
    try {
      const t = await window.api.listTabs();
      setTabs(t);
      if (t.length && !selectedTab) {
        setSelectedTab(t[0].title);
      } else if (selectedTab && !t.some((x) => x.title === selectedTab)) {
        // tab đang chọn đã bị xoá / đổi tên trên Sheet
        setSelectedTab('');
        showToast(`Tab "${selectedTab}" không còn trên Sheet. Hãy chọn tab khác.`);
      }
      return t;
    } catch (e: any) {
      if (!quiet) showToast('Không lấy được danh sách tab: ' + (e?.message ?? e));
      return tabs;
    }
  }

  useEffect(() => {
    if (signedIn && config?.spreadsheetId) refreshTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, config?.spreadsheetId]);

  // bộ trường dùng để render bảng review = bộ trường của tab đích (nếu có),
  // nếu chưa chọn tab thì dùng bộ chung
  const [activeFields, setActiveFields] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (selectedTab) {
      window.api.getFieldsForTab(selectedTab).then(setActiveFields);
    } else {
      setActiveFields(fields);
    }
  }, [selectedTab, fields]);

  // Quét tối đa CONCURRENCY file cùng lúc — nhanh hơn tuần tự, vẫn tránh
  // dồn dập gây rate-limit của OpenAI. Kết quả giữ đúng thứ tự file đầu vào.
  const CONCURRENCY = 3;

  async function processFiles(paths: string[]) {
    if (!paths.length) return;
    setProcessing(true);
    setProgress({ done: 0, total: paths.length });

    const out: ExtractedRecord[] = new Array(paths.length);
    let done = 0;
    let next = 0;

    async function worker() {
      while (next < paths.length) {
        const idx = next++;
        out[idx] = await window.api.processFile(
          paths[idx],
          selectedTab || undefined
        );
        done += 1;
        setProgress({ done, total: paths.length });
        // hiển thị dần các kết quả đã có (bỏ ô trống chưa xử lý xong)
        setRecords(out.filter(Boolean));
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker)
    );

    setRecords(out);
    setProcessing(false);
    const errs = out.filter((r) => r.error).length;
    showToast(
      errs
        ? `Xong ${out.length} file, ${errs} file có lỗi (xem ô đỏ).`
        : `Đã quét xong ${out.length} file.`
    );
  }

  async function onPick() {
    const paths = await window.api.pickPdfs();
    processFiles(paths);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const paths = Array.from(e.dataTransfer.files)
      .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      .map((f) => (f as File & { path: string }).path);
    processFiles(paths);
  }

  async function onSignIn() {
    try {
      await window.api.googleSignIn();
      setSignedIn(true);
      showToast('Đã đăng nhập Google.');
    } catch (e: any) {
      showToast('Đăng nhập thất bại: ' + (e?.message ?? e));
    }
  }

  async function doImport(good: ExtractedRecord[]) {
    try {
      const { appended } = await window.api.appendRows(selectedTab, good);
      showToast(`Đã import ${appended} dòng vào tab "${selectedTab}".`);
      setRecords([]);
      setPdfView(null);
    } catch (e: any) {
      showToast('Import thất bại: ' + (e?.message ?? e));
    }
  }

  function onReset() {
    if (
      records.length > 0 &&
      !window.confirm('Xoá kết quả đang có và làm lại từ đầu (chọn tab, nạp PDF)?')
    )
      return;
    setRecords([]);
    setPdfView(null);
  }

  async function onImport() {
    if (!selectedTab) {
      showToast('Chọn tab đích trước đã.');
      return;
    }
    const good = records.filter((r) => !r.error);
    if (!good.length) {
      showToast('Không có bản ghi hợp lệ để import.');
      return;
    }

    // kiểm tra tab đích còn tồn tại không (có thể vừa bị xoá trên Sheet)
    const latest = await refreshTabs(true);
    if (!latest.some((t) => t.title === selectedTab)) {
      showToast(`Tab "${selectedTab}" không còn trên Sheet. Hãy chọn tab khác.`);
      return;
    }

    const issues = validateRecords(good, activeFields);
    const unc = countUncertain(good);
    const parts: string[] = [];
    if (unc.cells > 0) {
      parts.push(
        `• Còn ${unc.cells} ô AI chưa chắc chắn ở ${unc.records} hồ sơ (ô tô vàng).`
      );
    }
    if (issues.length > 0) {
      const preview = issues
        .slice(0, 5)
        .map((i) => `  - Hồ sơ #${i.recordIdx + 1}: ${i.message}`)
        .join('\n');
      parts.push(
        `• ${issues.length} cảnh báo định dạng:\n${preview}` +
          (issues.length > 5 ? `\n  …và ${issues.length - 5} cảnh báo khác` : '')
      );
    }

    if (parts.length > 0) {
      const ok = window.confirm(
        `Trước khi import vào "${selectedTab}":\n\n${parts.join(
          '\n\n'
        )}\n\nVẫn import ${good.length} dòng?`
      );
      if (!ok) return;
    }

    await doImport(good);
  }

  if (!config) return <div style={{ padding: 20 }}>Đang tải…</div>;

  return (
    <div className="app">
      <div className="topbar">
        <img
          src="./assets/icon.png"
          alt=""
          width={24}
          height={24}
          style={{ borderRadius: 4 }}
        />
        <h1>Nhập liệu không khó</h1>
        <span className={'badge ' + (signedIn ? 'ok' : 'warn')}>
          {signedIn ? 'Google: đã kết nối' : 'Google: chưa kết nối'}
        </span>
        {view === 'main' ? (
          <>
            <button className="secondary" onClick={() => setView('history')}>
              Nhật ký
            </button>
            <button
              className="secondary"
              onClick={() => {
                if (signedIn) refreshTabs(true);
                setView('settings');
              }}
            >
              Cài đặt
            </button>
          </>
        ) : (
          <button className="secondary" onClick={() => setView('main')}>
            Quay lại
          </button>
        )}
      </div>

      <div className="body">
        {view === 'history' ? (
          <History />
        ) : view === 'settings' ? (
          <Settings
            config={config}
            fields={fields}
            signedIn={signedIn}
            onSave={async (c) => {
              await window.api.setConfig(c);
              setConfig(c);
              showToast('Đã lưu cài đặt.');
            }}
            onSaveSharedFields={async (f) => {
              const saved = await window.api.setFields(f);
              setFields(saved);
              return saved;
            }}
            onTabsChanged={() => refreshTabs(true)}
            onSignIn={onSignIn}
            onSignOut={async () => {
              await window.api.googleSignOut();
              setSignedIn(false);
              setTabs([]);
            }}
          />
        ) : (
          <>
            <div className="card">
              <h2>1. Chọn tab đích &amp; nạp file PDF</h2>

              {signedIn ? (
                <div className="field" style={{ maxWidth: 360 }}>
                  <label>Tab sẽ import vào</label>
                  <select
                    value={selectedTab}
                    disabled={(records.length > 0 && !!selectedTab) || processing}
                    onChange={(e) => setSelectedTab(e.target.value)}
                  >
                    <option value="">— Chọn tab —</option>
                    {tabs.map((t) => (
                      <option key={t.sheetId} value={t.title}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: '#6c757d' }}>
                    {records.length > 0
                      ? 'Đã quét theo tab này. Bấm "Làm lại từ đầu" ở bước 3 để đổi tab.'
                      : 'AI sẽ quét theo bộ trường đã cấu hình cho tab này.'}
                  </span>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#856404' }}>
                  Chưa đăng nhập Google — sẽ quét theo bộ trường chung, chọn tab
                  đích ở bước import.
                </p>
              )}

              <div
                className={'dropzone' + (drag ? ' drag' : '')}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
              >
                Kéo-thả nhiều file PDF vào đây, hoặc{' '}
                <button className="ghost" onClick={onPick} disabled={processing}>
                  chọn file
                </button>
              </div>
              {processing && (
                <p>
                  <span className="spin">⏳</span> Đang quét {progress.done}/{progress.total}…
                </p>
              )}
            </div>

            {records.length > 0 && (
              <div className={'card review-wrap' + (pdfView ? ' with-pdf' : '')}>
                <div className="review-main">
                  <h2>
                    2. Kiểm tra &amp; sửa (ô vàng = AI không chắc, ô đỏ = sai định
                    dạng)
                  </h2>
                  <ReviewTable
                    fields={activeFields}
                    records={records}
                    issues={validateRecords(records, activeFields)}
                    onChange={setRecords}
                    onOpenPdf={(p, name) => setPdfView({ path: p, name })}
                  />
                  <p style={{ fontSize: 13, color: '#6c757d', marginTop: 10 }}>
                    Tổng chi phí OpenAI ước tính:{' '}
                    <strong>
                      $
                      {records
                        .reduce((sum, r) => sum + (r.usage?.estimatedUsd ?? 0), 0)
                        .toFixed(4)}
                    </strong>{' '}
                    (
                    {records
                      .reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0)
                      .toLocaleString('vi-VN')}{' '}
                    token) — chỉ là ước tính, xem chính xác tại{' '}
                    <a
                      href="https://platform.openai.com/usage"
                      target="_blank"
                      rel="noreferrer"
                    >
                      platform.openai.com/usage
                    </a>
                  </p>
                </div>

                {pdfView && (
                  <PdfPanel
                    filePath={pdfView.path}
                    fileName={pdfView.name}
                    onClose={() => setPdfView(null)}
                    onOpenExternal={async (p) => {
                      try {
                        await window.api.openPdf(p);
                      } catch (e: any) {
                        showToast('Không mở được file: ' + (e?.message ?? e));
                      }
                    }}
                  />
                )}
              </div>
            )}

            {records.length > 0 && (
              <div className="card">
                <h2>3. Import vào Google Sheet</h2>
                {!signedIn ? (
                  <button onClick={onSignIn}>Đăng nhập Google để tiếp tục</button>
                ) : (
                  <div className="row">
                    {selectedTab ? (
                      <span>
                        Import {records.filter((r) => !r.error).length} dòng vào tab{' '}
                        <strong>{selectedTab}</strong>
                      </span>
                    ) : (
                      <span style={{ color: '#856404' }}>
                        Chưa chọn tab đích — bấm "Làm lại từ đầu" rồi chọn ở bước 1.
                      </span>
                    )}
                    <button
                      className="secondary"
                      onClick={onReset}
                      style={{ marginLeft: 'auto' }}
                    >
                      ↺ Làm lại từ đầu
                    </button>
                    <button onClick={onImport} disabled={!selectedTab}>
                      Import
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
