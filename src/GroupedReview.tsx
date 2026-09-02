import type { ExtractedRecord, FieldDef } from '../electron/types';
import type { CellIssue } from './validation';
import AutoTextarea from './AutoTextarea';
import {
  groupByPatient,
  idField,
  fixedFields,
  varyingFields,
  fixedConflicts,
  trendMarks,
  duplicateVisits,
} from './grouping';

interface Props {
  fields: FieldDef[];
  records: ExtractedRecord[];
  issues: CellIssue[];
  onChange: (r: ExtractedRecord[]) => void;
  onOpenPdf: (path: string, name: string) => void;
}

const TREND_ICON = { up: '▲', down: '▼', same: '=' } as const;
const TREND_COLOR = { up: '#c0392b', down: '#1e8449', same: '#6c757d' } as const;

export default function GroupedReview({
  fields,
  records,
  issues,
  onChange,
  onOpenPdf,
}: Props) {
  const groups = groupByPatient(records, fields);
  const idf = idField(fields);
  const fixedF = fixedFields(fields);
  const varyF = varyingFields(fields);

  const issueMap = new Map<string, string>();
  for (const it of issues) issueMap.set(`${it.recordIdx}:${it.fieldKey}`, it.message);

  function setValue(globalIdx: number, key: string, value: string) {
    onChange(
      records.map((r, i) =>
        i === globalIdx
          ? {
              ...r,
              values: { ...r.values, [key]: value },
              uncertain: { ...r.uncertain, [key]: false },
            }
          : r
      )
    );
  }

  // sửa 1 trường cố định -> áp cho mọi đợt của bệnh nhân đó
  function setFixedForGroup(indices: number[], key: string, value: string) {
    const idxSet = new Set(indices);
    onChange(
      records.map((r, i) =>
        idxSet.has(i)
          ? {
              ...r,
              values: { ...r.values, [key]: value },
              uncertain: { ...r.uncertain, [key]: false },
            }
          : r
      )
    );
  }

  function removeRecord(globalIdx: number) {
    onChange(records.filter((_, i) => i !== globalIdx));
  }

  return (
    <div className="grouped-review">
      {groups.map((g, gi) => {
        const multi = g.records.length > 1;
        const conflicts = fixedConflicts(g, fields);
        const trends = trendMarks(g, fields);
        const dupVisits = new Set(duplicateVisits(g, fields));
        const first = g.records[0];

        return (
          <div className="patient-card" key={gi}>
            <div className="patient-card-head">
              {idf ? (
                <strong>
                  {idf.label}: {g.idValue || '(chưa có)'}
                </strong>
              ) : (
                <strong>Hồ sơ #{g.indices[0] + 1}</strong>
              )}
              <span className="patient-visits">
                {multi ? `${g.records.length} đợt khám` : '1 đợt khám'}
              </span>
              {g.records.some((r) => r.error) && (
                <span className="badge warn">có lỗi quét</span>
              )}
            </div>

            {/* Phần cố định — nhập 1 chỗ áp dụng cả nhóm */}
            {idf || fixedF.length > 0 ? (
              <div className="patient-fixed">
                {idf && (
                  <label className="pf-item">
                    <span>{idf.label}</span>
                    <AutoTextarea
                      value={first.values[idf.key] ?? ''}
                      onChange={(v) => setFixedForGroup(g.indices, idf.key, v)}
                    />
                  </label>
                )}
                {fixedF.map((f) => {
                  const conflict = conflicts.has(f.key);
                  return (
                    <label
                      key={f.key}
                      className={'pf-item' + (conflict ? ' conflict' : '')}
                    >
                      <span>
                        {f.label}
                        {conflict && ' ⚠ lệch giữa các đợt'}
                      </span>
                      <AutoTextarea
                        value={first.values[f.key] ?? ''}
                        title={
                          conflict
                            ? 'Các đợt: ' +
                              g.records
                                .map((r) => r.values[f.key] || '(trống)')
                                .join(' / ')
                            : ''
                        }
                        onChange={(v) => setFixedForGroup(g.indices, f.key, v)}
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}

            {/* Phần biến thiên — bảng ngang theo đợt */}
            <div style={{ overflowX: 'auto' }}>
              <table className="visits-table">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Chỉ số</th>
                    {g.records.map((_, vi) => (
                      <th key={vi}>
                        Đợt {vi + 1}
                        {dupVisits.has(vi) && (
                          <span
                            title="Ngày khám trùng với đợt khác — có thể quét trùng file"
                            style={{ color: '#c0392b' }}
                          >
                            {' '}
                            ⚠
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {varyF.map((f) => (
                    <tr key={f.key}>
                      <td className="vt-label">{f.label}</td>
                      {g.records.map((r, vi) => {
                        const gIdx = g.indices[vi];
                        const issue = issueMap.get(`${gIdx}:${f.key}`);
                        const trend = trends.get(`${vi}:${f.key}`);
                        return (
                          <td
                            key={vi}
                            className={
                              r.error
                                ? 'error'
                                : issue
                                ? 'invalid'
                                : r.uncertain[f.key]
                                ? 'uncertain'
                                : ''
                            }
                            title={issue ?? ''}
                          >
                            <div className="vt-cell">
                              <AutoTextarea
                                value={r.values[f.key] ?? ''}
                                onChange={(v) => setValue(gIdx, f.key, v)}
                              />
                              {trend && (
                                <span
                                  className="trend"
                                  style={{ color: TREND_COLOR[trend] }}
                                  title={
                                    trend === 'up'
                                      ? 'Tăng so với đợt trước'
                                      : trend === 'down'
                                      ? 'Giảm so với đợt trước'
                                      : 'Không đổi'
                                  }
                                >
                                  {TREND_ICON[trend]}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="vt-label">File nguồn</td>
                    {g.records.map((r, vi) => {
                      const gIdx = g.indices[vi];
                      return (
                        <td key={vi}>
                          {r.sourcePath ? (
                            <button
                              className="link-btn"
                              onClick={() =>
                                onOpenPdf(r.sourcePath, r.sourceFile)
                              }
                              title={r.sourcePath}
                            >
                              📄 xem
                            </button>
                          ) : (
                            <span style={{ fontSize: 12 }}>{r.sourceFile}</span>
                          )}
                          {r.error && (
                            <div style={{ color: '#b71c1c', fontSize: 11 }}>
                              ⚠ {r.error}
                            </div>
                          )}
                          <button
                            className="link-btn"
                            style={{ color: '#c0392b', marginLeft: 6 }}
                            onClick={() => removeRecord(gIdx)}
                            title="Xoá đợt khám này"
                          >
                            xoá
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
