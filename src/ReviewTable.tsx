import { useEffect, useMemo, useState } from 'react';
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
      className={readOnly ? 'review-readonly' : undefined}
      style={readOnly ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
    >
      <div
        className="row"
        style={{ justifyContent: 'flex-end', marginBottom: 10, gap: 6 }}
      >
        <span style={{ fontSize: 12, color: '#6c757d', marginRight: 'auto' }}>
          {records.length} hồ sơ · {fields.length} trường
        </span>
        {hasId && (
          <button
            className={mode === 'grouped' ? '' : 'ghost'}
            style={{ padding: '4px 12px' }}
            onClick={() => setMode('grouped')}
          >
            Theo bệnh nhân
          </button>
        )}
        <button
          className={mode === 'table' ? '' : 'ghost'}
          style={{ padding: '4px 12px' }}
          onClick={() => setMode('table')}
        >
          Bảng
        </button>
        <button
          className={mode === 'cards' ? '' : 'ghost'}
          style={{ padding: '4px 12px' }}
          onClick={() => setMode('cards')}
        >
          Thẻ
        </button>
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
  if (!record.sourcePath) return <>{record.sourceFile}</>;
  return (
    <button
      className="link-btn"
      title={'Xem file PDF gốc để đối chiếu\n' + record.sourcePath}
      onClick={() => onOpenPdf(record.sourcePath, record.sourceFile)}
    >
      📄 {record.sourceFile}
    </button>
  );
}

function TableView({
  fields,
  records,
  issueMap,
  setValue,
  removeRow,
  onOpenPdf,
}: SubProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            {fields.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th>File nguồn</th>
            <th style={{ width: 90 }}>Chi phí</th>
            <th style={{ width: 40 }}></th>
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
                  <div style={{ color: '#b71c1c', fontSize: 11 }}>⚠ {r.error}</div>
                )}
              </td>
              <td style={{ fontSize: 12, color: '#6c757d' }}>
                {r.usage ? (
                  <>
                    ${r.usage.estimatedUsd.toFixed(4)}
                    <div>{r.usage.totalTokens.toLocaleString('vi-VN')} token</div>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <button
                  className="secondary"
                  style={{ padding: '2px 8px' }}
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
              className="secondary"
              style={{ padding: '2px 8px' }}
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

          {r.usage && (
            <div className="record-card-usage">
              ${r.usage.estimatedUsd.toFixed(4)} ·{' '}
              {r.usage.totalTokens.toLocaleString('vi-VN')} token
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
