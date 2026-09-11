import { useEffect, useState } from 'react';
import type { AppConfig, ExtractedRecord, FieldDef, SheetTab } from '../electron/types';
import Settings from './Settings';
import ReviewTable from './ReviewTable';
import History from './History';
import PdfPanel from './PdfPanel';
import { validateRecords, countUncertain } from './validation';
import { groupByPatient } from './grouping';

type View = 'main' | 'settings' | 'history';

export default function App() {
  const [view, setView] = useState<View>('main');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  const [records, setRecords] = useState<ExtractedRecord[]>([]);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
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

  // Lỗi từ Google có chữ "hết hạn" -> token đã bị xoá ở main, cập nhật lại trạng thái.
  function handleGoogleError(e: any): string {
    const msg = e?.message ?? String(e);
    if (/hết hạn|đăng nhập Google lại/i.test(msg)) {
      setSignedIn(false);
      setTabs([]);
    }
    return msg;
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
      const msg = handleGoogleError(e);
      if (!quiet) showToast('Không lấy được danh sách tab: ' + msg);
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

  async function reloadActiveFields(notifyIfChanged = false) {
    const next = selectedTab
      ? await window.api.getFieldsForTab(selectedTab)
      : await window.api.getFields();
    setActiveFields((prev) => {
      if (
        notifyIfChanged &&
        records.length > 0 &&
        JSON.stringify(prev.map((f) => f.key)) !==
          JSON.stringify(next.map((f) => f.key))
      ) {
        showToast(
          'Bộ trường vừa thay đổi. Các cột mới sẽ trống ở kết quả đang có — cân nhắc "Làm lại từ đầu".'
        );
      }
      return next;
    });
  }

  useEffect(() => {
    reloadActiveFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, fields]);

  // quay lại màn chính từ Cài đặt -> nạp lại bộ trường (có thể vừa được sửa)
  useEffect(() => {
    if (view === 'main') reloadActiveFields(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Quét tối đa CONCURRENCY file cùng lúc — nhanh hơn tuần tự, vẫn tránh
  // dồn dập gây rate-limit của OpenAI. Kết quả giữ đúng thứ tự file đầu vào.
  const CONCURRENCY = 3;

  // hộp thoại hỏi khi có file đã quét trước đó (null = ẩn)
  const [cacheChoice, setCacheChoice] = useState<{
    paths: string[];
    cachedNames: string[];
  } | null>(null);

  // Bước đầu: kiểm tra file nào đã có cache. Có -> hỏi bác sĩ. Không -> quét luôn.
  async function startFiles(paths: string[]) {
    if (!paths.length) return;
    try {
      const peek = await window.api.peekCache(paths, selectedTab || undefined);
      const cachedNames = peek.filter((p) => p.cached).map((p) => p.name);
      if (cachedNames.length > 0) {
        setCacheChoice({ paths, cachedNames });
        return;
      }
    } catch {
      // lỗi peek -> cứ quét bình thường
    }
    processFiles(paths, false);
  }

  async function processFiles(paths: string[], forceRescan: boolean) {
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
          selectedTab || undefined,
          forceRescan
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
    const cached = out.filter((r) => r.fromCache).length;
    const longFiles = out.filter((r) => r.isLongFile);
    const parts = [`Xong ${out.length} file`];
    if (cached > 0) parts.push(`${cached} file lấy từ bản đã quét (không tính phí)`);
    if (errs > 0) parts.push(`${errs} file có lỗi (xem ô đỏ)`);
    if (longFiles.length > 0) {
      parts.push(
        `${longFiles.length} file dài (${longFiles
          .map((r) => `${r.sourceFile}: ${r.totalPages} trang`)
          .join(', ')}) — đã quét hết nhưng có thể tốn nhiều token hơn`
      );
    }
    showToast(parts.join(' · '));
  }

  async function onPick() {
    const paths = await window.api.pickPdfs();
    startFiles(paths);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const paths = Array.from(e.dataTransfer.files)
      .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      .map((f) => (f as File & { path: string }).path);
    startFiles(paths);
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
    setImporting(true);
    try {
      const { appended } = await window.api.appendRows(selectedTab, good);
      showToast(`Đã import ${appended} dòng vào tab "${selectedTab}".`);
      setRecords([]);
      setPdfView(null);
    } catch (e: any) {
      showToast('Import thất bại: ' + handleGoogleError(e));
    } finally {
      setImporting(false);
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

    // --- Chống trùng theo Mã BN + Khoá đợt khám ---
    const idF = activeFields.find((f) => f.role === 'id');
    const dateF = activeFields.find((f) => f.role === 'visitkey');
    let toImport = good;
    if (idF && dateF) {
      try {
        const existing = new Set(
          await window.api.existingKeys(selectedTab, idF.label, dateF.label)
        );
        const KEY_SEP = '||';
        const norm = (s: string) => (s ?? '').trim().toLowerCase();
        const dupInSheet = good.filter((r) =>
          existing.has(
            `${norm(r.values[idF.key])}${KEY_SEP}${norm(r.values[dateF.key])}`
          )
        );
        if (dupInSheet.length > 0) {
          const list = dupInSheet
            .slice(0, 8)
            .map(
              (r) =>
                `  - ${r.values[idF.key] || '(mã trống)'} · khám ${
                  r.values[dateF.key] || '(ngày trống)'
                }`
            )
            .join('\n');
          const ok = window.confirm(
            `${dupInSheet.length} đợt khám dưới đây ĐÃ CÓ trong tab "${selectedTab}" (trùng Mã BN + Ngày khám):\n\n${list}` +
              (dupInSheet.length > 8 ? '\n  …' : '') +
              `\n\nBấm OK để BỎ QUA các đợt trùng và chỉ import ${
                good.length - dupInSheet.length
              } đợt mới.\nBấm Cancel để dừng lại.`
          );
          if (!ok) return;
          const dupSet = new Set(dupInSheet);
          toImport = good.filter((r) => !dupSet.has(r));
        }
      } catch (e: any) {
        const ok = window.confirm(
          'Không kiểm tra được trùng lặp:\n' +
            (e?.message ?? e) +
            '\n\nVẫn import? (có thể tạo dòng trùng)'
        );
        if (!ok) return;
      }
    } else if (idF && !dateF) {
      const ok = window.confirm(
        'Chưa có trường nào được đặt vai trò "Khoá đợt khám" (vd Mã đợt khám / Ngày khám).\n' +
          'App KHÔNG kiểm tra được trùng lặp — có thể import trùng các đợt đã có.\n\n' +
          'Vào Cài đặt → Các trường để đặt vai trò này. Vẫn import bây giờ?'
      );
      if (!ok) return;
    }
    if (!toImport.length) {
      showToast('Tất cả đợt khám đều đã có trong Sheet — không có gì để import.');
      return;
    }

    const issues = validateRecords(toImport, activeFields);
    const unc = countUncertain(toImport);
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
        )}\n\nVẫn import ${toImport.length} dòng?`
      );
      if (!ok) return;
    }

    // Sắp thứ tự ghi: theo Mã BN, rồi theo Khoá đợt khám tăng dần
    const ordered = groupByPatient(toImport, activeFields).flatMap(
      (g) => g.records
    );
    await doImport(ordered);
  }

  if (!config) return <div className="loading-screen">Đang tải…</div>;

  return (
    <div className="app">
      <div className="topbar">
        <img
          src="./assets/icon.png"
          alt=""
          width={22}
          height={22}
          style={{ borderRadius: 4, display: 'block' }}
        />
        <h1>RxScan</h1>
        <span className={'badge ' + (signedIn ? 'ok' : 'warn')}>
          {signedIn ? 'Google đã kết nối' : 'Google chưa kết nối'}
        </span>
        {view === 'main' ? (
          <>
            <button onClick={() => setView('history')}>Nhật ký</button>
            <button
              onClick={() => {
                if (signedIn) refreshTabs(true);
                setView('settings');
              }}
            >
              Cài đặt
            </button>
          </>
        ) : (
          <button onClick={() => setView('main')}>← Quay lại</button>
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
                <div className="field" style={{ maxWidth: 380 }}>
                  <label>Tab đích trên Google Sheet</label>
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
                  <span className="hint">
                    {records.length > 0
                      ? 'Đã quét theo tab này. Bấm “Làm lại từ đầu” ở bước 3 để đổi tab.'
                      : 'AI quét theo bộ trường đã cấu hình cho tab này.'}
                  </span>
                </div>
              ) : (
                <p className="hint text-warn" style={{ marginTop: 0 }}>
                  Chưa đăng nhập Google — sẽ quét theo bộ trường chung, chọn tab
                  đích ở bước 3.
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
                <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
                Kéo-thả file PDF vào đây, hoặc{' '}
                <button className="ghost sm" onClick={onPick} disabled={processing}>
                  chọn file
                </button>
              </div>
              {processing && (
                <div className="scan-progress">
                  <div className="scan-progress-label">
                    <span>AI đang quét hồ sơ…</span>
                    <span>
                      {progress.done}/{progress.total}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width:
                          progress.total > 0
                            ? `${(progress.done / progress.total) * 100}%`
                            : '0%',
                      }}
                    />
                  </div>
                </div>
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
                    readOnly={importing}
                    onChange={setRecords}
                    onOpenPdf={(p, name) => setPdfView({ path: p, name })}
                  />
                  {importing && (
                    <div className="scan-progress">
                      <div className="scan-progress-label">
                        <span>Đang ghi vào Google Sheet, không sửa lúc này…</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill progress-indeterminate" />
                      </div>
                    </div>
                  )}
                  <p className="hint" style={{ marginTop: 10 }}>
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
                    token)
                    {records.some((r) => r.fromCache) && (
                      <>
                        {' '}
                        · {records.filter((r) => r.fromCache).length} file lấy từ
                        bản đã quét, không tính phí
                      </>
                    )}{' '}
                    — chỉ là ước tính, xem chính xác tại{' '}
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
                      <span className="text-warn">
                        Chưa chọn tab đích — bấm "Làm lại từ đầu" rồi chọn ở bước 1.
                      </span>
                    )}
                    <button
                      className="secondary"
                      onClick={onReset}
                      disabled={importing}
                      style={{ marginLeft: 'auto' }}
                    >
                      ↺ Làm lại từ đầu
                    </button>
                    <button
                      onClick={onImport}
                      disabled={!selectedTab || importing}
                    >
                      {importing ? 'Đang import…' : 'Import'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {cacheChoice && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Một số file đã được quét trước đó</h3>
            <p style={{ fontSize: 13, color: '#495057' }}>
              {cacheChoice.cachedNames.length} / {cacheChoice.paths.length} file
              dưới đây đã có kết quả lưu sẵn (quét trước đó):
            </p>
            <ul className="cache-file-list">
              {cacheChoice.cachedNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p style={{ fontSize: 13, color: '#495057' }}>
              Bạn muốn dùng lại kết quả đã lưu (nhanh, không mất phí) hay để AI quét
              lại từ đầu?
            </p>
            <div
              className="row"
              style={{ justifyContent: 'flex-end', marginTop: 14 }}
            >
              <button
                className="secondary"
                onClick={() => setCacheChoice(null)}
              >
                Huỷ
              </button>
              <button
                className="ghost"
                onClick={() => {
                  const p = cacheChoice.paths;
                  setCacheChoice(null);
                  processFiles(p, true);
                }}
              >
                AI quét lại tất cả
              </button>
              <button
                onClick={() => {
                  const p = cacheChoice.paths;
                  setCacheChoice(null);
                  processFiles(p, false);
                }}
              >
                Dùng kết quả đã lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
