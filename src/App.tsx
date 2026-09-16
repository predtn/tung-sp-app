import { useEffect, useState } from 'react';
import type { AppConfig, ExtractedRecord, FieldDef, SheetTab, CellNote, CellNoteType } from '../electron/types';
import Settings from './Settings';
import ReviewTable from './ReviewTable';
import History from './History';
import PdfPanel from './PdfPanel';
import { countWarnings } from './validation';
import { NOTE_ICON, NOTE_LABEL } from './noteIcons';
import { groupByPatient, idField } from './grouping';
import { buildFinalRows } from './finalRows';
import { runAggregateFilter } from './aggregateAi';
import FinalPreview from './FinalPreview';
import { finalTabName } from '../electron/tabNaming';
import ConfirmDialogHost, { confirmDialog } from './ConfirmDialog';
import CustomSelect from './CustomSelect';
import GoogleSettings from './GoogleSettings';

type View = 'main' | 'settings' | 'history';

// Thứ tự hiển thị breakdown note theo mức cần chú ý giảm dần — không tìm
// thấy/sai định dạng (dữ liệu có vấn đề rõ ràng) trước, không chắc chắn/thiếu
// thông tin (còn đọc được nhưng cần soát) sau. 'inferred' không vào đây vì
// không tính là warning (xem isWarningNote).
const WARNING_NOTE_ORDER: CellNoteType[] = [
  'not_found',
  'format_mismatch',
  'uncertain',
  'missing_info',
];

function warningBreakdownLines(byType: Partial<Record<CellNoteType, number>>): string[] {
  return WARNING_NOTE_ORDER.filter((t) => byType[t]).map(
    (t) => `${NOTE_ICON[t]} ${NOTE_LABEL[t]}: ${byType[t]} ô`
  );
}

export default function App() {
  const [view, setView] = useState<View>('main');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [showGoogleSettings, setShowGoogleSettings] = useState(false);

  const [records, setRecords] = useState<ExtractedRecord[]>([]);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  // true sau khi đã Import lô hiện tại vào tab gốc — giữ nguyên records để
  // bác sĩ còn bấm "Lưu vào bản tổng hợp…" tiếp mà không cần quét lại PDF.
  // Nút Import bị khoá khi cờ này bật, tránh ghi trùng vào tab gốc.
  const [importedToMain, setImportedToMain] = useState(false);
  // true sau khi đã "Lưu vào bản tổng hợp…" (ghi tab -final) cho lô hiện tại —
  // đối xứng với importedToMain, giữ nguyên records để bác sĩ còn bấm Import
  // vào tab gốc tiếp mà không cần quét lại PDF.
  const [importedToFinal, setImportedToFinal] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [drag, setDrag] = useState(false);

  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [toast, setToast] = useState('');
  // file PDF đang xem trong panel bên phải (null = ẩn panel)
  const [pdfView, setPdfView] = useState<{ path: string; name: string } | null>(null);
  // xem trước dòng tổng hợp trước khi ghi vào tab "-final" (null = ẩn)
  const [finalPreview, setFinalPreview] = useState<ExtractedRecord[] | null>(null);
  const [importingFinal, setImportingFinal] = useState(false);
  // hỏi khi có bệnh nhân đã tồn tại trong tab final: Cập nhật / Bỏ qua / Huỷ
  const [finalDupChoice, setFinalDupChoice] = useState<{
    rows: ExtractedRecord[];
    dupNames: string[];
  } | null>(null);
  // hỏi khi có đợt khám (Mã BN + Ngày khám) đã tồn tại trong tab gốc:
  // Cập nhật (ghi đè bằng giá trị mới, vd bác sĩ vừa sửa tay) / Bỏ qua / Huỷ
  const [mainDupChoice, setMainDupChoice] = useState<{
    toImport: ExtractedRecord[];
    dupRows: ExtractedRecord[];
    idF: FieldDef;
    dateF: FieldDef;
  } | null>(null);
  // bác sĩ sửa tay giá trị "Lọc nâng cao" trong bảng review -> khoá "idValue:fieldKey"
  const [aggOverrides, setAggOverrides] = useState<Record<string, string>>({});
  // kết quả AI lọc nâng cao (tự động sau khi quét xong lô file), cùng khoá với aggOverrides
  const [aggResults, setAggResults] = useState<Record<string, string>>({});
  const [aggNotes, setAggNotes] = useState<Record<string, CellNote>>({});
  // key bệnh nhân (idValue hoặc sourcePath) còn đang chờ AI lọc nâng cao — theo
  // từng bệnh nhân thay vì 1 cờ chung cho cả lô, để bệnh nhân đã xong hiện kết
  // quả ngay, không phải đợi bệnh nhân khác đang bị retry chậm xong hết.
  const [aggLoadingKeys, setAggLoadingKeys] = useState<Set<string>>(new Set());

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
  // true khi bộ trường vừa đổi (ở Cài đặt) trong lúc đang có kết quả quét dở
  // -> hiện banner cho bác sĩ chọn quét lại hay bỏ qua.
  const [fieldsChanged, setFieldsChanged] = useState(false);
  // true khi bác sĩ đã tự sửa tay ít nhất 1 ô trong bảng review (kể từ lần
  // quét/quét lại gần nhất) -> cảnh báo trước khi "Quét lại" ghi đè mất.
  const [hasManualEdits, setHasManualEdits] = useState(false);

  async function reloadActiveFields(notifyIfChanged = false) {
    const next = selectedTab
      ? await window.api.getFieldsForTab(selectedTab)
      : await window.api.getFields();
    setActiveFields((prev) => {
      // So sánh TOÀN BỘ nội dung field (không chỉ key) — sửa mô tả/label/vai
      // trò/lọc nâng cao của field đã có cũng cần quét lại để AI áp dụng.
      const sortByKey = (fs: FieldDef[]) =>
        [...fs].sort((a, b) => a.key.localeCompare(b.key));
      if (
        notifyIfChanged &&
        records.length > 0 &&
        JSON.stringify(sortByKey(prev)) !== JSON.stringify(sortByKey(next))
      ) {
        setFieldsChanged(true);
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
    // Quét file mới thay thế toàn bộ lô đang hiển thị (kể cả record cũ bác sĩ
    // đã sửa tay) -> cảnh báo trước, không âm thầm mất.
    if (records.length > 0 && hasManualEdits) {
      const ok = await confirmDialog(
        'Bạn đã tự sửa tay một số ô ở lô hồ sơ đang hiển thị. Quét file mới sẽ ' +
          'thay thế lô này trên màn hình và MẤT các sửa tay đó (dữ liệu đã ghi ' +
          'lên Sheet, nếu có, không bị ảnh hưởng).',
        { title: 'Mất các sửa tay?', danger: true, confirmLabel: 'Vẫn quét file mới' }
      );
      if (!ok) return;
    }
    // Lô hiện tại đã import xong (đang chờ bác sĩ ghi bản tổng hợp) mà quét
    // thêm file mới sẽ xoá mất dữ liệu đang hiển thị của lô đã import khỏi
    // màn hình (dữ liệu trên Sheet vẫn còn, chỉ mất khỏi UI) -> xác nhận trước.
    if (importedToMain || importedToFinal) {
      const done: string[] = [];
      if (importedToMain) done.push('import vào tab gốc');
      if (importedToFinal) done.push('lưu bản tổng hợp');
      const pending = !importedToMain
        ? ' Muốn Import vào tab gốc cho lô đã lưu tổng hợp, hãy làm việc đó trước khi quét file mới.'
        : !importedToFinal
        ? ' Muốn "Lưu vào bản tổng hợp" cho lô đã import, hãy làm việc đó trước khi quét file mới.'
        : '';
      const ok = await confirmDialog(
        `Lô hồ sơ đã ${done.join(' và ')} sẽ biến mất khỏi màn hình này (dữ liệu ` +
          `trên Sheet không bị ảnh hưởng).${pending}`,
        { title: 'Quét file mới cho lô khác?', confirmLabel: 'Quét file mới' }
      );
      if (!ok) return;
      setImportedToMain(false);
      setImportedToFinal(false);
    }
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

  // Quét lại đúng các file đang có trên màn hình bằng cấu hình field hiện
  // tại. Dùng cho cả banner báo field vừa đổi lẫn nút "Quét lại" chủ động ở
  // hàng tiêu đề mục 2. Đi qua đúng luồng peekCache/cacheChoice như lúc nạp
  // file lần đầu: nếu PDF đã có cache (thường đúng vì vừa quét xong lô này),
  // để bác sĩ chọn dùng lại cache (rẻ, chỉ chạy lại Lọc nâng cao AI) hay bắt
  // AI trích xuất lại từ đầu (đắt hơn, cần khi sửa mô tả/label ảnh hưởng
  // cách AI đọc file).
  async function rescanCurrentFiles() {
    const paths = records.map((r) => r.sourcePath).filter(Boolean);
    if (!paths.length) {
      setFieldsChanged(false);
      return;
    }
    if (hasManualEdits) {
      const ok = await confirmDialog(
        'Bạn đã tự sửa tay một số ô trong bảng review. Quét lại sẽ GHI ĐÈ và ' +
          'MẤT các sửa tay đó (thay bằng kết quả AI/cache mới).',
        { title: 'Mất các sửa tay?', danger: true, confirmLabel: 'Vẫn quét lại' }
      );
      if (!ok) return;
    }
    if (importedToMain || importedToFinal) {
      const done: string[] = [];
      if (importedToMain) done.push('import vào tab gốc');
      if (importedToFinal) done.push('lưu bản tổng hợp');
      const ok = await confirmDialog(
        `Lô này đã ${done.join(' và ')}. Quét lại sẽ ghi đè kết quả trên màn ` +
          'hình này (dữ liệu đã ghi trên Sheet không bị ảnh hưởng), và bạn cần ' +
          'import/lưu lại nếu muốn cập nhật Sheet theo kết quả mới.',
        { title: 'Quét lại lô đã ghi?', confirmLabel: 'Quét lại' }
      );
      if (!ok) return;
      setImportedToMain(false);
      setImportedToFinal(false);
    }
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
    await processFiles(paths, false);
  }

  async function processFiles(paths: string[], forceRescan: boolean) {
    if (!paths.length) return;
    setProcessing(true);
    setProgress({ done: 0, total: paths.length });
    setAggOverrides({});
    setAggResults({});
    setAggNotes({});
    setFieldsChanged(false);
    setHasManualEdits(false);

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

    // Lọc nâng cao bằng AI: chạy tự động ngay sau khi quét xong TOÀN BỘ lô,
    // vì cần so sánh giá trị giữa các đợt khám của cùng bệnh nhân (không thể
    // tính đúng lúc đang quét song song từng file riêng lẻ).
    if (activeFields.some((f) => f.aggregateDescription?.trim())) {
      const goodForAgg = out.filter((r) => !r.error);
      const initialGroups = groupByPatient(goodForAgg, activeFields);
      setAggLoadingKeys(
        new Set(initialGroups.map((g) => g.idValue || g.records[0]?.sourcePath || ''))
      );
      runAggregateFilter(out, activeFields, (groupKey, snapshot) => {
        setAggResults({ ...snapshot.results });
        setAggNotes({ ...snapshot.notes });
        setAggLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(groupKey);
          return next;
        });
      }).catch((err) => {
        console.error('runAggregateFilter thất bại:', err);
        setAggLoadingKeys(new Set());
      });
    }

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
      .map((f) => window.api.getPathForFile(f));
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

  // upsertKeys: có -> gọi upsertRowsByKeyPair (ghi đè đợt trùng bằng giá trị
  // mới, vd bác sĩ vừa sửa tay), không có -> appendRows như trước (mọi dòng
  // đều chưa có sẵn, chỉ cần thêm mới).
  async function doImport(
    good: ExtractedRecord[],
    upsertKeys?: { idFieldKey: string; visitFieldKey: string }
  ) {
    setImporting(true);
    try {
      const { appended, updated } = upsertKeys
        ? await window.api.upsertRowsByKeyPair(
            selectedTab,
            good,
            upsertKeys.idFieldKey,
            upsertKeys.visitFieldKey
          )
        : { ...(await window.api.appendRows(selectedTab, good)), updated: 0 };
      const parts = [];
      if (appended > 0) parts.push(`thêm ${appended} dòng mới`);
      if (updated > 0) parts.push(`cập nhật ${updated} dòng đã có`);
      showToast(
        `Đã ${parts.join(', ')} vào tab "${selectedTab}". Có thể tiếp tục ` +
          `"Lưu vào bản tổng hợp…", hoặc "Làm lại từ đầu" cho lô hồ sơ mới.`
      );
      // KHÔNG xoá records — giữ để bác sĩ còn bấm "Lưu vào bản tổng hợp…" mà
      // không phải quét lại PDF. Khoá nút Import (importedToMain) để tránh
      // import trùng lần 2 vào tab gốc.
      setImportedToMain(true);
    } catch (e: any) {
      showToast('Import thất bại: ' + handleGoogleError(e));
    } finally {
      setImporting(false);
    }
  }

  async function onReset() {
    if (
      records.length > 0 &&
      !(await confirmDialog(
        'Xoá kết quả đang có và làm lại từ đầu (chọn tab, nạp PDF)?',
        { danger: true, confirmLabel: 'Xoá & làm lại' }
      ))
    )
      return;
    setRecords([]);
    setPdfView(null);
    setAggOverrides({});
    setAggResults({});
    setAggNotes({});
    setFieldsChanged(false);
    setImportedToMain(false);
    setImportedToFinal(false);
    setMainDupChoice(null);
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
          setMainDupChoice({ toImport: good, dupRows: dupInSheet, idF, dateF });
          return;
        }
      } catch (e: any) {
        const ok = await confirmDialog(
          (e?.message ?? e) + '\n\nVẫn import? (có thể tạo dòng trùng)',
          { title: 'Không kiểm tra được trùng lặp', danger: true, confirmLabel: 'Vẫn import' }
        );
        if (!ok) return;
      }
    } else if (idF && !dateF) {
      const ok = await confirmDialog(
        'App KHÔNG kiểm tra được trùng lặp — có thể import trùng các đợt đã có.\n\n' +
          'Vào Cài đặt → Các trường để đặt vai trò này. Vẫn import bây giờ?',
        {
          title: 'Chưa có trường nào được đặt vai trò "Khoá đợt khám" (vd Mã đợt khám / Ngày khám)',
          danger: true,
          confirmLabel: 'Vẫn import',
        }
      );
      if (!ok) return;
    }
    await proceedImport(toImport);
  }

  // Cảnh báo note còn sót + sắp thứ tự + ghi — dùng chung cho nhánh không có
  // trùng và nhánh bác sĩ đã xử lý xong hộp thoại trùng đợt khám (Cập nhật/Bỏ qua).
  async function proceedImport(
    toImport: ExtractedRecord[],
    upsertKeys?: { idFieldKey: string; visitFieldKey: string }
  ) {
    if (!toImport.length) {
      showToast('Tất cả đợt khám đều đã có trong Sheet — không có gì để import.');
      return;
    }

    const warn = countWarnings(toImport);
    const parts: string[] = [];
    if (warn.cells > 0) {
      const breakdown = warningBreakdownLines(warn.byType)
        .map((l) => `  - ${l}`)
        .join('\n');
      parts.push(
        `• Còn ${warn.cells} ô AI chưa đủ thông tin/không chắc chắn ở ${warn.records} hồ sơ:\n${breakdown}`
      );
    }

    if (parts.length > 0) {
      const ok = await confirmDialog(
        `${parts.join('\n\n')}\n\nVẫn import ${toImport.length} dòng?`,
        { title: `Trước khi import vào "${selectedTab}"`, confirmLabel: 'Vẫn import' }
      );
      if (!ok) return;
    }

    // Sắp thứ tự ghi: theo Mã BN, rồi theo Khoá đợt khám tăng dần
    const ordered = groupByPatient(toImport, activeFields).flatMap(
      (g) => g.records
    );
    await doImport(ordered, upsertKeys);
  }

  // Bác sĩ chọn "Cập nhật": ghi đè các đợt trùng bằng giá trị mới (vd vừa sửa
  // tay), cộng với các đợt chưa có (append).
  async function onUpdateMainDup() {
    if (!mainDupChoice) return;
    const { toImport, idF, dateF } = mainDupChoice;
    setMainDupChoice(null);
    await proceedImport(toImport, { idFieldKey: idF.key, visitFieldKey: dateF.key });
  }

  // Bác sĩ chọn "Bỏ qua": chỉ import các đợt CHƯA có, giữ nguyên bản cũ trên Sheet.
  async function onSkipMainDup() {
    if (!mainDupChoice) return;
    const { toImport, dupRows } = mainDupChoice;
    setMainDupChoice(null);
    const dupSet = new Set(dupRows);
    await proceedImport(toImport.filter((r) => !dupSet.has(r)));
  }

  function onOpenFinalPreview() {
    if (importingFinal) return;
    if (!selectedTab) {
      showToast('Chọn tab đích trước đã.');
      return;
    }
    if (aggLoadingKeys.size > 0) {
      showToast('AI đang lọc giá trị nâng cao, đợi xong rồi thử lại.');
      return;
    }
    const idF = idField(activeFields);
    if (!idF) {
      showToast(
        'Cần đặt vai trò "Định danh" (mã bệnh nhân) cho 1 trường để gộp thành dòng tổng hợp.'
      );
      return;
    }
    const good = records.filter((r) => !r.error);
    if (!good.length) {
      showToast('Không có bản ghi hợp lệ để tổng hợp.');
      return;
    }
    setFinalPreview(buildFinalRows(good, activeFields, aggOverrides, aggResults, aggNotes));
  }

  function finishFinalImport() {
    setFinalPreview(null);
    setFinalDupChoice(null);
    // KHÔNG xoá records — giữ để bác sĩ còn bấm Import vào tab gốc mà không
    // phải quét lại PDF. Khoá nút "Lưu vào bản tổng hợp…" (importedToFinal)
    // để tránh ghi trùng vào tab final lần 2.
    setImportedToFinal(true);
  }

  async function onConfirmFinalImport(rows: ExtractedRecord[]) {
    const finalTitle = finalTabName(selectedTab);
    const idF = idField(activeFields);
    setImportingFinal(true);
    try {
      // Chống trùng: tab final chỉ nên có 1 dòng/bệnh nhân — đối chiếu Mã BN
      // đã có sẵn trong tab final trước khi ghi. Có trùng -> hỏi bác sĩ chọn
      // Cập nhật (ghi đè bản mới) / Bỏ qua / Huỷ qua modal finalDupChoice.
      if (idF) {
        try {
          const existing = new Set(
            await window.api.existingSingleKeys(finalTitle, idF.label)
          );
          const norm = (s: string) => (s ?? '').trim().toLowerCase();
          const dup = rows.filter((r) => existing.has(norm(r.values[idF.key])));
          if (dup.length > 0) {
            setImportingFinal(false);
            setFinalDupChoice({
              rows,
              dupNames: dup.map((r) => r.values[idF.key] || '(mã trống)'),
            });
            return;
          }
        } catch (e: any) {
          const ok = await confirmDialog(
            (e?.message ?? e) + '\n\nVẫn ghi? (có thể tạo dòng trùng)',
            {
              title: 'Không kiểm tra được trùng lặp trong bản tổng hợp',
              danger: true,
              confirmLabel: 'Vẫn ghi',
            }
          );
          if (!ok) {
            setImportingFinal(false);
            return;
          }
        }
      }

      const { appended } = await window.api.appendRows(finalTitle, rows);
      showToast(`Đã ghi ${appended} dòng tổng hợp vào tab "${finalTitle}".`);
      finishFinalImport();
    } catch (e: any) {
      showToast('Ghi bản tổng hợp thất bại: ' + handleGoogleError(e));
    } finally {
      setImportingFinal(false);
    }
  }

  // Bác sĩ chọn "Cập nhật": ghi đè toàn bộ (kể cả bệnh nhân trùng) bằng upsert.
  async function onUpdateFinalDup() {
    if (!finalDupChoice) return;
    const finalTitle = finalTabName(selectedTab);
    const idF = idField(activeFields);
    if (!idF) return;
    setImportingFinal(true);
    try {
      const { updated, appended } = await window.api.upsertRows(
        finalTitle,
        finalDupChoice.rows,
        idF.key
      );
      showToast(
        `Đã cập nhật ${updated} dòng và thêm mới ${appended} dòng vào tab "${finalTitle}".`
      );
      finishFinalImport();
    } catch (e: any) {
      showToast('Cập nhật bản tổng hợp thất bại: ' + handleGoogleError(e));
    } finally {
      setImportingFinal(false);
    }
  }

  // Bác sĩ chọn "Bỏ qua": chỉ ghi các bệnh nhân CHƯA có, giữ nguyên bản cũ.
  async function onSkipFinalDup() {
    if (!finalDupChoice) return;
    const finalTitle = finalTabName(selectedTab);
    const idF = idField(activeFields);
    if (!idF) return;
    const norm = (s: string) => (s ?? '').trim().toLowerCase();
    const dupSet = new Set(finalDupChoice.dupNames.map(norm));
    const toWrite = finalDupChoice.rows.filter(
      (r) => !dupSet.has(norm(r.values[idF.key]))
    );
    if (!toWrite.length) {
      showToast('Tất cả bệnh nhân đều đã có trong bản tổng hợp — không có gì để ghi.');
      setFinalDupChoice(null);
      return;
    }
    setImportingFinal(true);
    try {
      const { appended } = await window.api.appendRows(finalTitle, toWrite);
      showToast(`Đã ghi ${appended} dòng tổng hợp mới vào tab "${finalTitle}".`);
      finishFinalImport();
    } catch (e: any) {
      showToast('Ghi bản tổng hợp thất bại: ' + handleGoogleError(e));
    } finally {
      setImportingFinal(false);
    }
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
        <button
          className={'badge-btn ' + (signedIn ? 'ok' : 'warn')}
          onClick={() => setShowGoogleSettings(true)}
        >
          {signedIn ? 'Google đã kết nối' : 'Google chưa kết nối'}
        </button>
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
            fields={fields}
            signedIn={signedIn}
            onSaveSharedFields={async (f) => {
              const saved = await window.api.setFields(f);
              setFields(saved);
              return saved;
            }}
            onTabsChanged={() => refreshTabs(true)}
          />
        ) : (
          <>
            <div className="card">
              <h2>1. Chọn tab đích &amp; nạp file PDF</h2>

              {signedIn ? (
                <div className="field" style={{ maxWidth: 380 }}>
                  <label>Tab đích trên Google Sheet</label>
                  <CustomSelect
                    value={selectedTab}
                    disabled={(records.length > 0 && !!selectedTab) || processing}
                    onChange={setSelectedTab}
                    placeholder="— Chọn tab —"
                    options={[
                      { value: '', label: '— Chọn tab —' },
                      ...tabs.map((t) => ({ value: t.title, label: t.title })),
                    ]}
                  />
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
            </div>

            {processing && (
              <div className="modal-overlay">
                <div className="modal scan-modal" style={{ maxWidth: 340 }}>
                  <div className="scan-spinner" />
                  <div className="scan-modal-text">
                    AI đang quét hồ sơ…
                    <br />
                    Đã quét được <strong>{progress.done}</strong> trên{' '}
                    <strong>{progress.total}</strong> hồ sơ
                  </div>
                </div>
              </div>
            )}

            {records.length > 0 && (
              <div className={'card review-wrap' + (pdfView ? ' with-pdf' : '')}>
                <div className="review-main">
                  <div className="row" style={{ marginBottom: 14 }}>
                    <h2 style={{ margin: 0 }}>2. Kiểm tra &amp; sửa</h2>
                    <button
                      style={{ marginLeft: 'auto' }}
                      onClick={rescanCurrentFiles}
                      disabled={processing || importing || importingFinal}
                      title={`Quét lại ${records.length} file đang hiển thị bằng cấu hình hiện tại`}
                    >
                      {processing ? 'Đang quét lại…' : '↻ Quét lại'}
                    </button>
                  </div>
                  {fieldsChanged && (
                    <div className="banner warn">
                      <span>
                        Bộ trường vừa được sửa ở Cài đặt. Kết quả đang hiển thị
                        có thể không còn đúng — bấm "↻ Quét lại" ở trên nếu
                        muốn cập nhật {records.length} file này theo cấu hình
                        mới.
                      </span>
                    </div>
                  )}
                  <ReviewTable
                    fields={activeFields}
                    records={records}
                    readOnly={importing}
                    onChange={(r) => {
                      setHasManualEdits(true);
                      setRecords(r);
                    }}
                    onOpenPdf={(p, name) => setPdfView({ path: p, name })}
                    aggOverrides={aggOverrides}
                    onAggOverride={(k, v) =>
                      setAggOverrides((prev) => ({ ...prev, [k]: v }))
                    }
                    aggResults={aggResults}
                    aggNotes={aggNotes}
                    aggLoadingKeys={aggLoadingKeys}
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
                    {importedToMain && importedToFinal ? (
                      <span className="text-ok">
                        ✓ Đã import vào tab <strong>{selectedTab}</strong> và
                        lưu bản tổng hợp. Bấm "Làm lại từ đầu" cho lô hồ sơ mới.
                      </span>
                    ) : importedToMain ? (
                      <span className="text-ok">
                        ✓ Đã import vào tab <strong>{selectedTab}</strong>. Có
                        thể tiếp tục "Lưu vào bản tổng hợp…" cho cùng lô này.
                      </span>
                    ) : importedToFinal ? (
                      <span className="text-ok">
                        ✓ Đã lưu bản tổng hợp. Có thể tiếp tục "Import" vào tab{' '}
                        <strong>{selectedTab}</strong> cho cùng lô này.
                      </span>
                    ) : selectedTab ? (
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
                      disabled={importing || importingFinal}
                      style={{ marginLeft: 'auto' }}
                    >
                      ↺ Làm lại từ đầu
                    </button>
                    <button
                      className="ghost"
                      onClick={onOpenFinalPreview}
                      disabled={
                        !selectedTab ||
                        importing ||
                        importingFinal ||
                        importedToFinal ||
                        aggLoadingKeys.size > 0
                      }
                      title={
                        importedToFinal
                          ? 'Bản tổng hợp của lô này đã được lưu'
                          : aggLoadingKeys.size > 0
                          ? 'Đang chờ AI lọc giá trị nâng cao…'
                          : 'Rút gọn N đợt khám của mỗi bệnh nhân thành 1 dòng, ' +
                            'ghi vào tab "' +
                            (selectedTab ? finalTabName(selectedTab) : '...') +
                            '"'
                      }
                    >
                      {importedToFinal
                        ? 'Đã lưu tổng hợp'
                        : aggLoadingKeys.size > 0
                        ? 'AI đang lọc…'
                        : 'Lưu vào bản tổng hợp…'}
                    </button>
                    <button
                      onClick={onImport}
                      disabled={
                        !selectedTab || importing || importingFinal || importedToMain
                      }
                      title={importedToMain ? 'Lô này đã được import' : undefined}
                    >
                      {importing
                        ? 'Đang import…'
                        : importedToMain
                        ? 'Đã import'
                        : 'Import'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {finalPreview && !finalDupChoice && (
        <FinalPreview
          fields={activeFields}
          rows={finalPreview}
          finalTabTitle={finalTabName(selectedTab)}
          onClose={() => setFinalPreview(null)}
          onConfirm={onConfirmFinalImport}
        />
      )}

      {finalDupChoice && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Bệnh nhân đã có trong bản tổng hợp</h3>
            <p className="hint">
              {finalDupChoice.dupNames.length} bệnh nhân dưới đây đã có sẵn 1
              dòng trong tab "{finalTabName(selectedTab)}":
            </p>
            <ul className="cache-file-list">
              {finalDupChoice.dupNames.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            <p className="hint">
              <strong>Cập nhật</strong>: ghi đè dòng cũ bằng dữ liệu mới nhất
              (khuyên dùng — tab tổng hợp luôn giữ bản mới nhất/bệnh nhân).
              <br />
              <strong>Bỏ qua</strong>: giữ nguyên dòng cũ, chỉ thêm các bệnh
              nhân chưa có.
            </p>
            <div
              className="row"
              style={{ justifyContent: 'flex-end', marginTop: 14 }}
            >
              <button
                className="secondary"
                onClick={() => setFinalDupChoice(null)}
                disabled={importingFinal}
              >
                Huỷ
              </button>
              <button
                className="ghost"
                onClick={onSkipFinalDup}
                disabled={importingFinal}
              >
                Bỏ qua bệnh nhân trùng
              </button>
              <button onClick={onUpdateFinalDup} disabled={importingFinal}>
                {importingFinal ? 'Đang ghi…' : 'Cập nhật đè bản cũ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mainDupChoice && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Đợt khám đã có trong tab "{selectedTab}"</h3>
            <p className="hint">
              {mainDupChoice.dupRows.length} đợt khám dưới đây đã có sẵn 1
              dòng (trùng {mainDupChoice.idF.label} + {mainDupChoice.dateF.label}):
            </p>
            <ul className="cache-file-list">
              {mainDupChoice.dupRows.slice(0, 8).map((r, i) => (
                <li key={i}>
                  {r.values[mainDupChoice.idF.key] || '(mã trống)'} · khám{' '}
                  {r.values[mainDupChoice.dateF.key] || '(ngày trống)'}
                </li>
              ))}
              {mainDupChoice.dupRows.length > 8 && <li>…</li>}
            </ul>
            <p className="hint">
              <strong>Cập nhật</strong>: ghi đè dòng cũ trên Sheet bằng dữ liệu
              đang hiển thị (dùng khi bạn vừa sửa tay 1 ô rồi import lại).
              <br />
              <strong>Bỏ qua</strong>: giữ nguyên dòng cũ, chỉ import các đợt
              chưa có.
            </p>
            <div
              className="row"
              style={{ justifyContent: 'flex-end', marginTop: 14 }}
            >
              <button
                className="secondary"
                onClick={() => setMainDupChoice(null)}
                disabled={importing}
              >
                Huỷ
              </button>
              <button
                className="ghost"
                onClick={onSkipMainDup}
                disabled={importing}
              >
                Bỏ qua đợt trùng
              </button>
              <button onClick={onUpdateMainDup} disabled={importing}>
                {importing ? 'Đang ghi…' : 'Cập nhật đè bản cũ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGoogleSettings && config && (
        <GoogleSettings
          config={config}
          signedIn={signedIn}
          onSave={async (c) => {
            await window.api.setConfig(c);
            setConfig(c);
            showToast('Đã lưu cài đặt.');
          }}
          onSignIn={onSignIn}
          onSignOut={async () => {
            await window.api.googleSignOut();
            setSignedIn(false);
            setTabs([]);
          }}
          onClose={() => setShowGoogleSettings(false)}
        />
      )}

      <ConfirmDialogHost />

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
