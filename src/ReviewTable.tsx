import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedRecord, FieldDef } from '../electron/types';
import type { CellIssue } from './validation';
import GroupedReview from './GroupedReview';
import AutoTextarea from './AutoTextarea';
import { idField, groupByPatient } from './grouping';

interface Props {
  fields: FieldDef[];
  records: ExtractedRecord[];
  issues: CellIssue[];
  readOnly?: boolean;
  onChange: (r: ExtractedRecord[]) => void;
  onOpenPdf: (path: string, name: string) => void;
}

type ViewMode = 'grouped' | 'table' | 'cards';

// Nhiều trường thì bảng ngang bị bóp chật -> mặc định chuyển sang xem Thẻ.
const CARD_THRESHOLD = 7;

export default function ReviewTable({
  fields,
  records,
  issues,
  readOnly = false,
  onChange,
  onOpenPdf,
}: Props) {
  const hasId = !!idField(fields);
  // có gộp được (>=1 nhóm nhiều đợt) thì mặc định xem Theo bệnh nhân
  const hasMultiVisit = useMemo(
    () =>
      hasId &&
      groupByPatient(records, fields).some((g) => g.records.length > 1),
    [records, fields, hasId]
  );

  const [mode, setMode] = useState<ViewMode>(
    hasMultiVisit ? 'grouped' : fields.length > CARD_THRESHOLD ? 'cards' : 'table'
  );

  // tra cứu nhanh: "recordIdx:fieldKey" -> thông báo lỗi định dạng
  const issueMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of issues) m.set(`${it.recordIdx}:${it.fieldKey}`, it.message);
    return m;
  }, [issues]);

  // nếu số trường đổi (user thêm/bớt trong Cài đặt) thì chọn lại chế độ hợp lý
  useEffect(() => {
    setMode(
      hasMultiVisit
        ? 'grouped'
        : fields.length > CARD_THRESHOLD
        ? 'cards'
        : 'table'
    );
  }, [fields.length, hasMultiVisit]);

  function setValue(rowIdx: number, key: string, value: string) {
    const next = records.map((r, i) => {
      if (i !== rowIdx) return r;
      return {
        ...r,
        values: { ...r.values, [key]: value },
        // người dùng sửa tay -> coi như đã xác nhận
        uncertain: { ...r.uncertain, [key]: false },
      };
    });
    onChange(next);
  }

  function removeRow(rowIdx: number) {
    onChange(records.filter((_, i) => i !== rowIdx));
  }

  return (
    <div
      style={readOnly ? { pointerEvents: 'none', opacity: 0.55 } : undefined}
    >
      <div className="review-toolbar">
        <span className="review-count">
          {records.length} hồ sơ · {fields.length} trường
        </span>
        <div className="seg">
          {hasId && (
            <button
              className={mode === 'grouped' ? 'active' : ''}
              onClick={() => setMode('grouped')}
            >
              Theo bệnh nhân
            </button>
          )}
          <button
            className={mode === 'table' ? 'active' : ''}
            onClick={() => setMode('table')}
          >
            Bảng
          </button>
          <button
            className={mode === 'cards' ? 'active' : ''}
            onClick={() => setMode('cards')}
          >
            Thẻ
          </button>
        </div>
      </div>

      {mode === 'grouped' ? (
        <GroupedReview
          fields={fields}
          records={records}
          issues={issues}
          onChange={onChange}
          onOpenPdf={onOpenPdf}
        />
      ) : mode === 'table' ? (
        <TableView
          fields={fields}
          records={records}
          issueMap={issueMap}
          setValue={setValue}
          removeRow={removeRow}
          onOpenPdf={onOpenPdf}
        />
      ) : (
        <CardsView
          fields={fields}
          records={records}
          issueMap={issueMap}
          setValue={setValue}
          removeRow={removeRow}
          onOpenPdf={onOpenPdf}
        />
      )}
    </div>
  );
}

interface SubProps {
  fields: FieldDef[];
  records: ExtractedRecord[];
  issueMap: Map<string, string>;
  setValue: (rowIdx: number, key: string, value: string) => void;
  removeRow: (rowIdx: number) => void;
  onOpenPdf: (path: string, name: string) => void;
}

function SourceFileLink({
  record,
  onOpenPdf,
}: {
  record: ExtractedRecord;
  onOpenPdf: (path: string, name: string) => void;
}) {
  if (!record.sourcePath)
    return <span className="src-file">{record.sourceFile}</span>;
  return (
    <button
      className="link-btn src-file"
      title={'Xem file PDF gốc để đối chiếu\n' + record.sourceFile}
      onClick={() => onOpenPdf(record.sourcePath, record.sourceFile)}
    >
      📄 {record.sourceFile}
    </button>
  );
}

// độ rộng mặc định từng loại cột (px)
const DEFAULT_W = { idx: 34, field: 150, src: 200, cost: 96, del: 40 };
const MIN_W = 56;

function TableView({
  fields,
  records,
  issueMap,
  setValue,
  removeRow,
  onOpenPdf,
}: SubProps) {
  // khoá lưu độ rộng theo tổ hợp các trường (đổi bộ trường -> reset)
  const storeKey = 'rxscan.colw.' + fields.map((f) => f.key).join(',');
  const colIds = ['__idx', ...fields.map((f) => f.key), '__src', '__cost', '__del'];

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || '{}');
      if (saved && typeof saved === 'object') return saved;
    } catch {
      /* ignore */
    }
    return {};
  });

  function widthOf(id: string): number {
    if (widths[id]) return widths[id];
    if (id === '__idx') return DEFAULT_W.idx;
    if (id === '__src') return DEFAULT_W.src;
    if (id === '__cost') return DEFAULT_W.cost;
    if (id === '__del') return DEFAULT_W.del;
    return DEFAULT_W.field;
  }

  const dragRef = useRef<{ id: string; startX: number; startW: number } | null>(null);

  function onHandleDown(e: React.MouseEvent, id: string) {
    e.preventDefault();
    dragRef.current = { id, startX: e.clientX, startW: widthOf(id) };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e: MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    const w = Math.max(MIN_W, d.startW + (e.clientX - d.startX));
    setWidths((prev) => ({ ...prev, [d.id]: w }));
  }
  function onDragEnd() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    dragRef.current = null;
    setWidths((prev) => {
      try {
        localStorage.setItem(storeKey, JSON.stringify(prev));
      } catch {
        /* ignore */
      }
      return prev;
    });
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="resizable-table">
        <colgroup>
          {colIds.map((id) => (
            <col key={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            {fields.map((f) => (
              <th key={f.key}>
                <span className="th-label">{f.label}</span>
                <span
                  className="col-resizer"
                  onMouseDown={(e) => onHandleDown(e, f.key)}
                />
              </th>
            ))}
            <th>
              File nguồn
              <span
                className="col-resizer"
                onMouseDown={(e) => onHandleDown(e, '__src')}
              />
            </th>
            <th>Chi phí</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {fields.map((f) => {
                const issue = issueMap.get(`${i}:${f.key}`);
                return (
                  <td
                    key={f.key}
                    title={issue ?? ''}
                    className={
                      r.error
                        ? 'error'
                        : issue
                        ? 'invalid'
                        : r.uncertain[f.key]
                        ? 'uncertain'
                        : ''
                    }
                  >
                    <AutoTextarea
                      value={r.values[f.key] ?? ''}
                      onChange={(v) => setValue(i, f.key, v)}
                    />
                  </td>
                );
              })}
              <td>
                <SourceFileLink record={r} onOpenPdf={onOpenPdf} />
                {r.error && (
                  <div className="cell-note danger">⚠ {r.error}</div>
                )}
              </td>
              <td className="hint">
                {r.fromCache ? (
                  <span className="text-ok">đã quét trước · miễn phí</span>
                ) : r.usage ? (
                  <>
                    ${r.usage.estimatedUsd.toFixed(4)}
                    <div>{r.usage.totalTokens.toLocaleString('vi-VN')} token</div>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  className="link-btn danger"
                  title="Xoá dòng này"
                  onClick={() => removeRow(i)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardsView({
  fields,
  records,
  issueMap,
  setValue,
  removeRow,
  onOpenPdf,
}: SubProps) {
  return (
    <div className="cards-grid">
      {records.map((r, i) => (
        <div className={'record-card' + (r.error ? ' has-error' : '')} key={i}>
          <div className="record-card-head">
            <strong>#{i + 1}</strong>
            <span className="record-card-file">
              <SourceFileLink record={r} onOpenPdf={onOpenPdf} />
            </span>
            <button
              className="link-btn danger"
              onClick={() => removeRow(i)}
              title="Xoá hồ sơ này"
            >
              ✕
            </button>
          </div>

          {r.error ? (
            <div className="record-card-error">⚠ {r.error}</div>
          ) : (
            <div className="record-card-fields">
              {fields.map((f) => {
                const issue = issueMap.get(`${i}:${f.key}`);
                return (
                  <label
                    key={f.key}
                    className={
                      'card-field' +
                      (issue ? ' invalid' : r.uncertain[f.key] ? ' uncertain' : '')
                    }
                  >
                    <span className="card-field-label">{f.label}</span>
                    <AutoTextarea
                      value={r.values[f.key] ?? ''}
                      onChange={(v) => setValue(i, f.key, v)}
                    />
                    {issue && <span className="card-field-issue">{issue}</span>}
                  </label>
                );
              })}
            </div>
          )}

          {r.fromCache ? (
            <div className="record-card-usage text-ok">
              đã quét trước đó · không tính phí
            </div>
          ) : r.usage ? (
            <div className="record-card-usage">
              ${r.usage.estimatedUsd.toFixed(4)} ·{' '}
              {r.usage.totalTokens.toLocaleString('vi-VN')} token
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
