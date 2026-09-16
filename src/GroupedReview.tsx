import type { ExtractedRecord, FieldDef, CellNote } from '../electron/types';
import { NOTE_ICON, NOTE_LABEL } from './noteIcons';
import AutoTextarea from './AutoTextarea';
import {
  groupByPatient,
  idField,
  fixedFields,
  varyingFields,
  fixedConflicts,
  duplicateVisits,
  aggOverrideKey,
} from './grouping';

interface Props {
  fields: FieldDef[];
  records: ExtractedRecord[];
  onChange: (r: ExtractedRecord[]) => void;
  onOpenPdf: (path: string, name: string) => void;
  aggOverrides: Record<string, string>;
  onAggOverride: (key: string, value: string) => void;
  /** kết quả AI lọc nâng cao, tính tự động sau khi quét xong lô file */
  aggResults: Record<string, string>;
  aggNotes: Record<string, CellNote>;
  /** key bệnh nhân (idValue/sourcePath) còn đang chờ AI lọc nâng cao */
  aggLoadingKeys: Set<string>;
  /** snapshot values/notes lúc quét xong (khoá theo sourcePath), để so sánh phát hiện sửa tay */
  originalRecords: Record<string, { values: Record<string, string>; notes: Record<string, CellNote> }>;
  /** ghi đè cache của mọi file thuộc 1 nhóm bệnh nhân bằng giá trị hiện tại */
  onSaveGroupToCache: (groupRecords: ExtractedRecord[]) => void;
}

// So sánh nông 2 object string->string (values) hoặc string->CellNote (notes).
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => {
    const va = a[k];
    const vb = b[k];
    if (va && vb && typeof va === 'object' && typeof vb === 'object') {
      return JSON.stringify(va) === JSON.stringify(vb);
    }
    return va === vb;
  });
}

export default function GroupedReview({
  fields,
  records,
  onChange,
  onOpenPdf,
  aggOverrides,
  onAggOverride,
  aggResults,
  aggNotes,
  aggLoadingKeys,
  originalRecords,
  onSaveGroupToCache,
}: Props) {
  const groups = groupByPatient(records, fields);
  const idf = idField(fields);
  const fixedF = fixedFields(fields);
  const varyF = varyingFields(fields);
  // có ít nhất 1 trường biến thiên được cấu hình "Lọc giá trị nâng cao" -> hiện thêm cột
  const hasAggregate = varyF.some((f) => f.aggregateDescription?.trim());

  // bác sĩ tự sửa tay 1 ô -> coi như đã soát xong, xoá note cảnh báo (nếu có)
  function clearNote(notes: Record<string, CellNote>, key: string) {
    if (!(key in notes)) return notes;
    const next = { ...notes };
    delete next[key];
    return next;
  }

  function setValue(globalIdx: number, key: string, value: string) {
    onChange(
      records.map((r, i) =>
        i === globalIdx
          ? {
              ...r,
              values: { ...r.values, [key]: value },
              notes: clearNote(r.notes, key),
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
              notes: clearNote(r.notes, key),
            }
          : r
      )
    );
  }

  function removeRecord(globalIdx: number) {
    onChange(records.filter((_, i) => i !== globalIdx));
  }

  // true nếu ít nhất 1 record của nhóm này khác snapshot lúc quét xong (bác
  // sĩ đã sửa tay values hoặc notes bị xoá do sửa) -> hiện nút "Lưu cache".
  function groupHasEdits(groupRecords: ExtractedRecord[]): boolean {
    return groupRecords.some((r) => {
      if (r.error || !r.sourcePath) return false;
      const orig = originalRecords[r.sourcePath];
      if (!orig) return false; // chưa có snapshot gốc (vd file lấy từ cache lúc mở lại) -> không so sánh được
      return (
        !shallowEqual(r.values, orig.values) || !shallowEqual(r.notes, orig.notes)
      );
    });
  }

  return (
    <div className="grouped-review">
      {groups.map((g, gi) => {
        const multi = g.records.length > 1;
        const conflicts = fixedConflicts(g, fields);
        const dupVisits = new Set(duplicateVisits(g, fields));
        const first = g.records[0];
        const groupKey = g.idValue || g.records[0]?.sourcePath || '';
        const groupLoading = aggLoadingKeys.has(groupKey);
        const hasEdits = groupHasEdits(g.records);

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
              {hasEdits && (
                <button
                  className="sm save-cache-btn"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => onSaveGroupToCache(g.records)}
                  title="Ghi đè cache của (các) file PDF thuộc bệnh nhân này bằng giá trị hiện đang hiển thị, để lần sau quét lại cùng file sẽ ra đúng giá trị đã sửa"
                >
                  Lưu cache
                </button>
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
                            className="text-danger"
                            title="Ngày khám trùng với đợt khác — có thể quét trùng file"
                          >
                            {' '}
                            ⚠
                          </span>
                        )}
                      </th>
                    ))}
                    {hasAggregate && (
                      <th style={{ width: 130 }}>Lọc nâng cao</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {varyF.map((f) => (
                    <tr key={f.key}>
                      <td className="vt-label">{f.label}</td>
                      {g.records.map((r, vi) => {
                        const gIdx = g.indices[vi];
                        const note = r.notes[f.key];
                        return (
                          <td
                            key={vi}
                            className={r.error ? 'error' : ''}
                          >
                            <div className="vt-cell">
                              <AutoTextarea
                                value={r.values[f.key] ?? ''}
                                onChange={(v) => setValue(gIdx, f.key, v)}
                              />
                              {note && (
                                <span
                                  className="ai-note-icon"
                                  title={`${NOTE_LABEL[note.type]}: ${note.text}`}
                                >
                                  {NOTE_ICON[note.type]}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      {hasAggregate && (
                        <td className="agg-cell">
                          {(() => {
                            const desc = f.aggregateDescription?.trim();
                            const key = aggOverrideKey(g, f.key);
                            const overridden = aggOverrides[key];
                            const shown = overridden ?? (desc ? aggResults[key] ?? '' : '');
                            const isLoading = !!desc && groupLoading && overridden === undefined;
                            const note = overridden === undefined ? aggNotes[key] : undefined;
                            const hasNote = !isLoading && !!desc && !!note;
                            return (
                              <>
                                <div className="vt-cell">
                                  <AutoTextarea
                                    value={shown}
                                    placeholder={
                                      isLoading
                                        ? 'AI đang lọc…'
                                        : hasNote
                                        ? '(chưa lọc được)'
                                        : desc
                                        ? 'Nhập tay…'
                                        : 'Mặc định'
                                    }
                                    className={hasNote ? 'agg-input muted' : 'agg-input'}
                                    onChange={(v) => onAggOverride(key, v)}
                                  />
                                  {hasNote && (
                                    <span
                                      className="ai-note-icon"
                                      title={`${NOTE_LABEL[note.type]}: ${note.text}`}
                                    >
                                      {NOTE_ICON[note.type]}
                                    </span>
                                  )}
                                </div>
                                {desc && (
                                  <div className="agg-mode" title={desc}>
                                    AI lọc: {desc}
                                    {overridden !== undefined && ' · đã sửa tay'}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </td>
                      )}
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
                            <div className="cell-note danger">
                              ⚠ {r.error}
                            </div>
                          )}
                          <button
                            className="link-btn danger"
                            style={{ marginLeft: 8 }}
                            onClick={() => removeRecord(gIdx)}
                            title="Xoá đợt khám này"
                          >
                            xoá
                          </button>
                        </td>
                      );
                    })}
                    {hasAggregate && <td></td>}
                  </tr>
                  <tr>
                    <td className="vt-label">Chi phí</td>
                    {g.records.map((r, vi) => (
                      <td key={vi} className="hint">
                        {r.fromCache ? (
                          <span className="text-ok">đã quét trước · miễn phí</span>
                        ) : r.usage ? (
                          <>
                            ${r.usage.estimatedUsd.toFixed(4)} ·{' '}
                            {r.usage.totalTokens.toLocaleString('vi-VN')} token
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                    {hasAggregate && <td></td>}
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
