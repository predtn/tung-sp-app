import { useEffect, useState } from 'react';
import type { FieldDef, FieldRole, SheetTab } from '../electron/types';
import type { TabSyncPlan } from '../electron/google';

const ROLE_LABEL: Record<FieldRole, string> = {
  id: 'Định danh (mã BN)',
  visitkey: 'Khoá đợt khám',
  fixed: 'Cố định',
  varying: 'Biến thiên',
};
const ROLE_ORDER: FieldRole[] = ['id', 'visitkey', 'fixed', 'varying'];

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

  async function loadTabs() {
    const configured = await window.api.configuredTabs();
    if (!signedIn) {
      setTabs([]);
      setOrphanTabs(configured);
      return;
    }
    try {
      const live = await window.api.listTabs();
      setTabs(live);
      const liveNames = new Set(live.map((t) => t.title));
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
      !window.confirm(
        `Xoá cấu hình trường của tab "${name}"? (tab này không còn trên Google Sheet)`
      )
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
      { key: '', label: '', description: '', example: '', role: 'varying' },
    ]);
  }
  function setRole(idx: number, role: FieldRole) {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i === idx) return { ...r, role };
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
  function moveRow(idx: number, dir: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      const t = idx + dir;
      if (t < 0 || t >= next.length) return rs;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  }

  function cleanRows(): FieldDef[] {
    return rows
      .filter((r) => r.label.trim() !== '')
      .map((r) => ({
        key: r.key,
        label: r.label.trim(),
        description: r.description.trim(),
        example: (r.example ?? '').trim() || undefined,
        role: r.role ?? 'varying',
      }));
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

  async function handleSaveTab() {
    if (isOrphan) {
      setMsg('Tab này không còn trên Google Sheet — không đồng bộ được.');
      return;
    }
    const cleaned = cleanRows();
    setSaving(true);
    setMsg('');
    try {
      // 1) xem trước thay đổi trên Sheet
      const plan: TabSyncPlan = await window.api.planTabSync(selectedTab, cleaned);

      // 2) nếu có xoá cột chứa dữ liệu -> hỏi rõ
      const withData = plan.removedColumns.filter((c) => c.nonEmptyCells > 0);
      if (withData.length > 0) {
        const detail = withData
          .map((c) => `  • "${c.name}" — ${c.nonEmptyCells} ô có dữ liệu`)
          .join('\n');
        const ok = window.confirm(
          `Đồng bộ tab "${selectedTab}" sẽ XOÁ các cột sau cùng toàn bộ dữ liệu trong đó:\n\n${detail}\n\n` +
            `Tab đang có ${plan.dataRowCount} dòng dữ liệu. Thao tác không hoàn tác được. Tiếp tục?`
        );
        if (!ok) {
          setSaving(false);
          setMsg('Đã huỷ, chưa thay đổi gì.');
          return;
        }
      } else if (
        plan.addedColumns.length > 0 ||
        plan.removedColumns.length > 0 ||
        plan.reordered
      ) {
        const bits: string[] = [];
        if (plan.addedColumns.length)
          bits.push(`thêm cột: ${plan.addedColumns.join(', ')}`);
        if (plan.removedColumns.length)
          bits.push(
            `xoá cột (đang trống): ${plan.removedColumns
              .map((c) => c.name)
              .join(', ')}`
          );
        if (plan.reordered) bits.push('sắp xếp lại thứ tự cột');
        const ok = window.confirm(
          `Đồng bộ tab "${selectedTab}":\n\n• ${bits.join(
            '\n• '
          )}\n\nHàng tiêu đề sẽ được ghi lại và in đậm. Tiếp tục?`
        );
        if (!ok) {
          setSaving(false);
          setMsg('Đã huỷ, chưa thay đổi gì.');
          return;
        }
      }

      // 3) lưu cấu hình trường của tab
      const saved = await window.api.setFieldsForTab(selectedTab, cleaned);
      setRows(saved);

      // 4) ghi lại Sheet (header + sắp cột + in đậm)
      await window.api.applyTabSync(selectedTab, saved);

      setMsg(`Đã lưu & đồng bộ tab "${selectedTab}" trên Google Sheet.`);
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
          <select
            value={selectedTab}
            style={{ flex: 1 }}
            onChange={(e) => setSelectedTab(e.target.value)}
          >
            <option value={SHARED}>Bộ trường chung (mặc định cho tab mới)</option>
            {!signedIn && (
              <option disabled>— Đăng nhập Google để chọn tab —</option>
            )}
            {tabs.map((t) => (
              <option key={t.sheetId} value={t.title}>
                Tab: {t.title}
              </option>
            ))}
            {orphanTabs.map((n) => (
              <option key={'orphan-' + n} value={n}>
                Tab: {n} (không còn trên Sheet)
              </option>
            ))}
          </select>
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

      {loading ? (
        <p className="muted">Đang tải bộ trường…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Tên hiển thị (cột Sheet)</th>
                <th>Mô tả cho AI</th>
                <th style={{ width: 130 }}>Ví dụ (tuỳ chọn)</th>
                <th style={{ width: 130 }}>Vai trò</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={f.label}
                      placeholder="VD: Men gan (AST)"
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={f.description}
                      placeholder="VD: Chỉ số men gan AST của đợt khám này"
                      onChange={(e) => update(i, { description: e.target.value })}
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
                    <select
                      value={f.role ?? 'varying'}
                      onChange={(e) => setRole(i, e.target.value as FieldRole)}
                    >
                      {ROLE_ORDER.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>
                      <button
                        className="ghost sm"
                        onClick={() => moveRow(i, -1)}
                        disabled={i === 0}
                        title="Di chuyển lên"
                      >
                        ↑
                      </button>
                      <button
                        className="ghost sm"
                        onClick={() => moveRow(i, 1)}
                        disabled={i === rows.length - 1}
                        title="Di chuyển xuống"
                      >
                        ↓
                      </button>
                      <button
                        className="link-btn danger"
                        style={{ marginLeft: 2 }}
                        onClick={() => removeRow(i)}
                        title="Xoá trường"
                      >
                        ✕
                      </button>
                    </div>
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
