import { useEffect, useState } from 'react';
import type {
  FieldDef,
  FieldMode,
  FieldRole,
  SheetTab,
} from '../electron/types';
import type { TabSyncPlan } from '../electron/google';
import { finalTabName } from '../electron/tabNaming';
import { confirmDialog } from './ConfirmDialog';
import CustomSelect from './CustomSelect';
import AutoTextarea from './AutoTextarea';

const ROLE_LABEL: Record<FieldRole, string> = {
  id: 'Định danh (mã BN)',
  visitkey: 'Khoá đợt khám',
  fixed: 'Cố định',
  varying: 'Biến thiên',
};
const ROLE_ORDER: FieldRole[] = ['id', 'visitkey', 'fixed', 'varying'];

const MODE_LABEL: Record<FieldMode, string> = {
  extract: 'Trích xuất trực tiếp',
  infer: 'Để AI suy luận, tính toán',
};
const MODE_ORDER: FieldMode[] = ['extract', 'infer'];

interface Props {
  // bộ trường chung (khi chưa chọn tab)
  fields: FieldDef[];
  signedIn: boolean;
  // lưu bộ trường chung
  onSaveShared: (fields: FieldDef[]) => Promise<FieldDef[]>;
  // báo App làm mới danh sách tab (sau khi tạo tab mới)
  onTabsChanged?: () => void;
}

// giá trị đặc biệt cho "bộ trường chung / mặc định"
const SHARED = '';

export default function FieldsEditor({
  fields,
  signedIn,
  onSaveShared,
  onTabsChanged,
}: Props) {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [orphanTabs, setOrphanTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>(SHARED);
  const [rows, setRows] = useState<FieldDef[]>(fields);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [newTabName, setNewTabName] = useState<string | null>(null);
  const [creatingTab, setCreatingTab] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  async function loadTabs() {
    const configured = await window.api.configuredTabs();
    if (!signedIn) {
      setTabs([]);
      setOrphanTabs(configured);
      return;
    }
    try {
      // dropdown chọn tab: không hiện tab "-final" (nội bộ)
      const live = await window.api.listTabs();
      setTabs(live);
      // kiểm tra "tab mồ côi": phải đối chiếu với danh sách ĐẦY ĐỦ (kể cả
      // "-final"), nếu không tab final sẽ luôn bị coi là mồ côi vì nó bị lọc
      // khỏi danh sách dropdown ở trên.
      const allLive = await window.api.listTabs(true);
      const liveNames = new Set(allLive.map((t) => t.title));
      setOrphanTabs(configured.filter((n) => !liveNames.has(n)));
    } catch {
      setTabs([]);
      setOrphanTabs(configured);
    }
  }

  // nạp danh sách tab (từ Sheet) + tab có cấu hình nhưng không còn trên Sheet
  useEffect(() => {
    loadTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  async function handleCreateTab() {
    const name = (newTabName ?? '').trim();
    if (!name) {
      setMsg('Nhập tên tab.');
      return;
    }
    if (tabs.some((t) => t.title.toLowerCase() === name.toLowerCase())) {
      setMsg(`Tab "${name}" đã tồn tại.`);
      return;
    }
    setCreatingTab(true);
    setMsg('');
    try {
      await window.api.createTab(name);
      await loadTabs();
      onTabsChanged?.();
      setNewTabName(null);
      setSelectedTab(name);
      setMsg(`Đã tạo tab "${name}" và cấu hình trường mặc định.`);
    } catch (e: any) {
      setMsg('Tạo tab thất bại: ' + (e?.message ?? e));
    } finally {
      setCreatingTab(false);
      setTimeout(() => setMsg(''), 5000);
    }
  }

  async function onDeleteOrphan(name: string) {
    if (
      !(await confirmDialog(
        `Tab "${name}" này không còn trên Google Sheet.`,
        { title: `Xoá cấu hình trường của tab "${name}"?`, danger: true, confirmLabel: 'Xoá' }
      ))
    )
      return;
    await window.api.deleteFieldsForTab(name);
    setOrphanTabs((o) => o.filter((n) => n !== name));
    if (selectedTab === name) setSelectedTab(SHARED);
  }

  // đổi tab -> nạp bộ trường tương ứng
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setMsg('');
      try {
        if (selectedTab === SHARED) {
          setRows(fields);
        } else {
          const f = await window.api.getFieldsForTab(selectedTab);
          if (!cancelled) setRows(f);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab]);

  function update(idx: number, patch: Partial<FieldDef>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        key: '',
        label: '',
        description: '',
        example: '',
        role: 'varying',
      },
    ]);
  }
  function setRole(idx: number, role: FieldRole) {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i === idx)
          return {
            ...r,
            role,
            // aggregateDescription chỉ có nghĩa với 'varying' -> đổi vai trò khác thì bỏ
            aggregateDescription: role === 'varying' ? r.aggregateDescription : undefined,
          };
        // 'id' và 'visitkey' chỉ được 1 trường -> hạ trường cũ cùng vai trò xuống 'varying'
        if ((role === 'id' || role === 'visitkey') && r.role === role)
          return { ...r, role: 'varying' };
        return r;
      })
    );
  }
  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }
  function moveRowTo(from: number, to: number) {
    setRows((rs) => {
      if (to < 0 || to >= rs.length || from === to) return rs;
      const next = [...rs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function cleanRows(): FieldDef[] {
    return rows
      .filter((r) => r.label.trim() !== '')
      .map((r) => {
        const role = r.role ?? 'varying';
        const aggDesc = (r.aggregateDescription ?? '').trim();
        return {
          key: r.key,
          label: r.label.trim(),
          description: r.description.trim(),
          example: (r.example ?? '').trim() || undefined,
          role,
          aggregateDescription: role === 'varying' && aggDesc ? aggDesc : undefined,
          mode: r.mode ?? 'extract',
        };
      });
  }

  async function handleSaveShared() {
    setSaving(true);
    setMsg('');
    try {
      const saved = await onSaveShared(cleanRows());
      setRows(saved);
      setMsg('Đã lưu bộ trường chung.');
    } catch (e: any) {
      setMsg('Lỗi: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 5000);
    }
  }

  const isOrphan = orphanTabs.includes(selectedTab);

  /** Gộp cảnh báo xoá-cột-có-dữ-liệu của cả tab gốc và tab final thành 1 lời hỏi duy nhất. */
  async function confirmSyncPlans(
    plans: { tabTitle: string; plan: TabSyncPlan }[]
  ): Promise<boolean> {
    const withDataParts: string[] = [];
    const changeParts: string[] = [];
    for (const { tabTitle, plan } of plans) {
      const withData = plan.removedColumns.filter((c) => c.nonEmptyCells > 0);
      if (withData.length > 0) {
        withDataParts.push(
          `Tab "${tabTitle}" (${plan.dataRowCount} dòng dữ liệu):\n` +
            withData
              .map((c) => `  • "${c.name}" — ${c.nonEmptyCells} ô có dữ liệu`)
              .join('\n')
        );
      } else if (
        plan.addedColumns.length > 0 ||
        plan.removedColumns.length > 0 ||
        plan.renamedColumns.length > 0 ||
        plan.reordered
      ) {
        const bits: string[] = [];
        if (plan.renamedColumns.length)
          bits.push(
            `đổi tên cột (giữ dữ liệu): ${plan.renamedColumns
              .map((r) => `"${r.from}" → "${r.to}"`)
              .join(', ')}`
          );
        if (plan.addedColumns.length)
          bits.push(`thêm cột: ${plan.addedColumns.join(', ')}`);
        if (plan.removedColumns.length)
          bits.push(
            `xoá cột (đang trống): ${plan.removedColumns
              .map((c) => c.name)
              .join(', ')}`
          );
        if (plan.reordered) bits.push('sắp xếp lại thứ tự cột');
        changeParts.push(`Tab "${tabTitle}": ${bits.join(', ')}`);
      }
    }

    if (withDataParts.length > 0) {
      return confirmDialog(
        `${withDataParts.join('\n\n')}\n\nThao tác không hoàn tác được. Tiếp tục?`,
        {
          title: 'Đồng bộ sẽ XOÁ các cột sau cùng toàn bộ dữ liệu trong đó',
          danger: true,
          confirmLabel: 'Xoá & tiếp tục',
        }
      );
    }
    if (changeParts.length > 0) {
      return confirmDialog(
        `${changeParts.join('\n')}\n\nHàng tiêu đề sẽ được ghi lại và in đậm. Tiếp tục?`,
        { title: 'Đồng bộ tab', confirmLabel: 'Tiếp tục' }
      );
    }
    return true;
  }

  async function handleSaveTab() {
    if (isOrphan) {
      setMsg('Tab này không còn trên Google Sheet — không đồng bộ được.');
      return;
    }
    const finalTitle = finalTabName(selectedTab);
    setSaving(true);
    setMsg('');
    try {
      // 0) Sinh key ổn định cho field mới TRƯỚC khi lập kế hoạch đồng bộ —
      //    nếu không, planTabSync/applyTabSync dùng key rỗng của field chưa
      //    từng lưu, khiến lần đổi tên SAU đó không nhận ra field đã có key
      //    thật, coi nhầm là "xoá cột cũ + thêm cột mới" (mất dữ liệu).
      const cleaned = await window.api.normalizeFields(cleanRows());

      // 1) xem trước thay đổi trên cả 2 tab (gốc + final, luôn cùng cấu trúc)
      const [planMain, planFinal] = await Promise.all([
        window.api.planTabSync(selectedTab, cleaned),
        window.api.planTabSync(finalTitle, cleaned).catch(() => null),
      ]);

      const plans: { tabTitle: string; plan: TabSyncPlan }[] = [
        { tabTitle: selectedTab, plan: planMain },
      ];
      if (planFinal) plans.push({ tabTitle: finalTitle, plan: planFinal });

      const ok = await confirmSyncPlans(plans);
      if (!ok) {
        setSaving(false);
        setMsg('Đã huỷ, chưa thay đổi gì.');
        return;
      }

      // 2) Ghi Sheet TRƯỚC (header + sắp cột + in đậm), chỉ lưu cấu hình local
      //    SAU KHI ghi Sheet thành công. Nếu applyTabSync lỗi giữa chừng, field
      //    config (local) giữ nguyên bản cũ — tránh trạng thái "field đã đổi
      //    nhưng cột thật trên Sheet chưa đổi" gây ghi lệch cột về sau.
      await window.api.applyTabSync(selectedTab, cleaned);
      const saved = await window.api.setFieldsForTab(selectedTab, cleaned);
      setRows(saved);

      if (planFinal) {
        try {
          await window.api.applyTabSync(finalTitle, saved);
          await window.api.setFieldsForTab(finalTitle, saved);
        } catch (e: any) {
          setMsg(
            `Đã lưu & đồng bộ tab "${selectedTab}" nhưng đồng bộ tab "${finalTitle}" thất bại — ` +
              `cấu hình trường của "${finalTitle}" GIỮ NGUYÊN như cũ để tránh lệch cột: ` +
              (e?.message ?? e)
          );
          setSaving(false);
          return;
        }
      }

      setMsg(
        planFinal
          ? `Đã lưu & đồng bộ tab "${selectedTab}" và "${finalTitle}".`
          : `Đã lưu & đồng bộ tab "${selectedTab}" (không tìm thấy tab final để đồng bộ kèm).`
      );
    } catch (e: any) {
      setMsg('Lỗi: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 6000);
    }
  }

  const isShared = selectedTab === SHARED;

  return (
    <div className="card">
      <h2>Các trường trích xuất</h2>

      <div className="field" style={{ maxWidth: 480 }}>
        <label>Áp dụng cho</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <CustomSelect
            value={selectedTab}
            style={{ flex: 1 }}
            onChange={setSelectedTab}
            options={[
              { value: SHARED, label: 'Bộ trường chung (mặc định cho tab mới)' },
              ...(!signedIn
                ? [
                    {
                      value: '__no_google__',
                      label: '— Đăng nhập Google để chọn tab —',
                      disabled: true,
                    },
                  ]
                : []),
              ...tabs.map((t) => ({ value: t.title, label: `Tab: ${t.title}` })),
              ...orphanTabs.map((n) => ({
                value: n,
                label: `Tab: ${n} (không còn trên Sheet)`,
              })),
            ]}
          />
          {signedIn && (
            <button
              className="ghost"
              onClick={() => setNewTabName((v) => (v === null ? '' : null))}
            >
              + Tạo tab mới
            </button>
          )}
        </div>
      </div>

      {newTabName !== null && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            autoFocus
            value={newTabName}
            placeholder="Tên tab mới (vd: Bệnh án tháng 9)"
            onChange={(e) => setNewTabName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateTab();
              if (e.key === 'Escape') setNewTabName(null);
            }}
            style={{
              padding: '7px 9px',
              border: '1px solid #ced4da',
              borderRadius: 6,
              fontSize: 14,
              minWidth: 240,
            }}
          />
          <button onClick={handleCreateTab} disabled={creatingTab}>
            {creatingTab ? 'Đang tạo…' : 'Tạo tab'}
          </button>
          <button className="secondary" onClick={() => setNewTabName(null)}>
            Huỷ
          </button>
        </div>
      )}

      {orphanTabs.length > 0 && (
        <p className="hint text-warn" style={{ marginTop: -4 }}>
          {orphanTabs.length} tab có cấu hình trường nhưng không còn trên Google
          Sheet:{' '}
          {orphanTabs.map((n, i) => (
            <span key={n}>
              {i > 0 && ', '}
              <button
                className="link-btn"
                onClick={() => onDeleteOrphan(n)}
                title="Xoá cấu hình của tab này"
              >
                {n} ✕
              </button>
            </span>
          ))}
        </p>
      )}

      <p className="hint">
        {isShared ? (
          <>
            Bộ trường <strong>chung</strong>: dùng khi quét vào tab chưa cấu hình
            riêng, và làm mẫu khởi tạo cho tab mới. Lưu tại đây không đụng tới
            Google Sheet.
          </>
        ) : (
          <>
            Bộ trường <strong>riêng của tab "{selectedTab}"</strong>. Bấm{' '}
            <strong>Lưu &amp; đồng bộ</strong> sẽ ghi lại hàng tiêu đề (dòng 1) của
            tab này trên Google Sheet, sắp xếp cột dữ liệu theo đúng danh sách bên
            dưới, và in đậm hàng tiêu đề.
          </>
        )}
        {' '}
        "Ví dụ" (tuỳ chọn) cho AI biết định dạng — vd <code>15/03/1992</code> cho
        ngày.
      </p>

      <p className="hint">
        <strong>Cách lấy giá trị</strong>:
        <br />
        • <strong>Trích xuất trực tiếp</strong> (mặc định): AI chỉ lấy thông tin có
        thật trong hồ sơ, không suy đoán/bịa — dùng cho dữ liệu định danh, chỉ số đo
        được trực tiếp.
        <br />
        • <strong>Để AI suy luận, tính toán</strong>: dùng cho các chỉ số cần TÍNH
        hoặc TRA CỨU từ dữ liệu khác của cùng hồ sơ (vd BMI từ cân nặng/chiều cao) —
        AI đọc lại hồ sơ gốc (không chỉ dữ liệu đã trích) và được phép tra cứu web
        khi cần công thức/bảng chuẩn. Chạy ở 1 lượt gọi AI riêng,{' '}
        <strong>tốn thêm chi phí gần bằng 1 lượt trích xuất nữa &amp; thời gian
        mỗi lần quét</strong> nếu hồ sơ có ít nhất 1 trường loại này.
      </p>

      <p className="hint">
        <strong>Vai trò</strong> giúp app gộp nhiều đợt khám của cùng bệnh nhân:
        <br />
        • <strong>Định danh</strong> (chỉ 1 trường): mã bệnh nhân. Các hồ sơ trùng
        mã này = cùng 1 người.
        <br />
        • <strong>Khoá đợt khám</strong> (chỉ 1 trường): mã đợt khám hoặc ngày
        khám. Cùng với mã bệnh nhân, đây là cặp app dùng để <strong>chống import
        trùng</strong>. Không đặt vai trò này thì app không kiểm tra được trùng.
        <br />
        • <strong>Cố định</strong>: không đổi giữa các đợt (họ tên, ngày sinh) —
        app cảnh báo nếu AI đọc lệch giữa các file.
        <br />• <strong>Biến thiên</strong>: thay đổi theo từng lần khám (men gan,
        chẩn đoán) — app xếp cạnh nhau theo đợt để so sánh.
      </p>

      <p className="hint">
        <strong>Lọc giá trị (nâng cao)</strong> — chỉ áp dụng cho trường{' '}
        <strong>Biến thiên</strong>: mô tả cách AI chốt 1 giá trị duy nhất từ các
        đợt khám của cùng bệnh nhân cho dòng tổng hợp (tab "-final"), vd{' '}
        <code>Lấy giá trị lớn nhất trong các đợt</code> hoặc{' '}
        <code>Lấy chẩn đoán nặng nhất</code>. Để trống = không lọc, bác sĩ tự
        nhập tay ở dòng tổng hợp. Có mô tả thì AI chỉ dựa trên các giá trị đã
        quét được qua các đợt (không tự bịa thêm), chạy tự động ngay sau khi
        quét xong cả lô file.
      </p>

      {loading ? (
        <p className="muted">Đang tải bộ trường…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th style={{ width: 140 }}>Tên hiển thị (cột Sheet)</th>
                <th>Mô tả cho AI</th>
                <th style={{ width: 150 }}>Cách lấy giá trị</th>
                <th style={{ width: 110 }}>Ví dụ (tuỳ chọn)</th>
                <th style={{ width: 120 }}>Vai trò</th>
                <th style={{ width: 140 }}>Lọc giá trị (nâng cao)</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => (
                <tr
                  key={i}
                  className={
                    'field-row' +
                    (dragIdx === i ? ' dragging' : '') +
                    (dragOverIdx === i && dragIdx !== null && dragIdx !== i
                      ? ' drag-over'
                      : '')
                  }
                  onDragOver={(e) => {
                    if (dragIdx === null) return;
                    e.preventDefault();
                    if (dragOverIdx !== i) setDragOverIdx(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) moveRowTo(dragIdx, i);
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                >
                  <td className="drag-handle-cell">
                    <span
                      className="drag-handle"
                      draggable
                      title="Kéo để đổi thứ tự"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragIdx(i);
                      }}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                    >
                      ⠿
                    </span>
                  </td>
                  <td>
                    <input
                      value={f.label}
                      placeholder="VD: Men gan (AST)"
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <AutoTextarea
                      value={f.description}
                      placeholder="VD: Chỉ số men gan AST của đợt khám này"
                      onChange={(v) => update(i, { description: v })}
                    />
                  </td>
                  <td>
                    <CustomSelect
                      value={f.mode ?? 'extract'}
                      onChange={(v) => update(i, { mode: v as FieldMode })}
                      options={MODE_ORDER.map((m) => ({
                        value: m,
                        label: MODE_LABEL[m],
                      }))}
                    />
                  </td>
                  <td>
                    <input
                      value={f.example ?? ''}
                      placeholder="VD: 45"
                      onChange={(e) => update(i, { example: e.target.value })}
                    />
                  </td>
                  <td>
                    <CustomSelect
                      value={f.role ?? 'varying'}
                      onChange={(v) => setRole(i, v as FieldRole)}
                      options={ROLE_ORDER.map((r) => ({
                        value: r,
                        label: ROLE_LABEL[r],
                      }))}
                    />
                  </td>
                  <td>
                    {(f.role ?? 'varying') === 'varying' ? (
                      <AutoTextarea
                        value={f.aggregateDescription ?? ''}
                        placeholder="VD: Lấy giá trị lớn nhất trong các đợt"
                        title="Để trống = không lọc, bác sĩ tự nhập tay ở dòng tổng hợp. Có mô tả -> AI tự chốt 1 giá trị theo mô tả này."
                        onChange={(v) =>
                          update(i, { aggregateDescription: v })
                        }
                      />
                    ) : (
                      <span className="muted">Mặc định</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="link-btn danger"
                      onClick={() => removeRow(i)}
                      title="Xoá trường"
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={addRow}>
              + Thêm trường
            </button>
            {isShared ? (
              <button onClick={handleSaveShared} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu bộ trường chung'}
              </button>
            ) : (
              <button onClick={handleSaveTab} disabled={saving || isOrphan}>
                {saving ? 'Đang xử lý…' : 'Lưu & đồng bộ Google Sheet'}
              </button>
            )}
            {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
          </div>

          {isOrphan && (
            <p className="hint text-warn" style={{ marginTop: 8 }}>
              Tab "{selectedTab}" không còn trên Google Sheet. Tạo lại tab cùng
              tên để dùng lại cấu hình này, hoặc xoá cấu hình ở phần cảnh báo trên.
            </p>
          )}

          {!isShared && (
            <p style={{ fontSize: 11, color: '#adb5bd', marginTop: 8 }}>
              Cột "File nguồn" và "Thời gian nhập" luôn được thêm tự động ở cuối,
              không cần khai báo. Dữ liệu được khớp lại theo <em>tên cột</em> nên
              đổi thứ tự sẽ không mất dữ liệu.
            </p>
          )}
        </>
      )}
    </div>
  );
}
