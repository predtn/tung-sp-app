import { useState } from 'react';
import type { ExtractedRecord, FieldDef } from '../electron/types';
import { finalColumnLabel } from '../electron/tabNaming';
import { isWarningNote } from './validation';
import { NOTE_ICON, NOTE_LABEL } from './noteIcons';
import AutoTextarea from './AutoTextarea';

interface Props {
  fields: FieldDef[];
  rows: ExtractedRecord[];
  finalTabTitle: string;
  onClose: () => void;
  onConfirm: (rows: ExtractedRecord[]) => Promise<void>;
}

/**
 * Xem trước dòng tổng hợp (1 dòng/bệnh nhân) trước khi ghi vào tab "-final".
 * Ô nào không có giá trị tự động (không cấu hình "Lọc giá trị nâng cao", hoặc
 * AI không đủ căn cứ để chốt) sẽ có dấu ❓ cạnh ô, bắt buộc bác sĩ tự điền
 * hoặc xác nhận để trống.
 */
export default function FinalPreview({
  fields,
  rows: initialRows,
  finalTabTitle,
  onClose,
  onConfirm,
}: Props) {
  const [rows, setRows] = useState<ExtractedRecord[]>(initialRows);
  const [busy, setBusy] = useState(false);

  function setValue(idx: number, key: string, value: string) {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i !== idx) return r;
        const notes = { ...r.notes };
        delete notes[key];
        return { ...r, values: { ...r.values, [key]: value }, notes };
      })
    );
  }

  const emptyCount = rows.reduce(
    (sum, r) => sum + Object.values(r.notes).filter(isWarningNote).length,
    0
  );

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm(rows);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 900 }}>
        <h3>Xem trước dòng tổng hợp — tab "{finalTabTitle}"</h3>
        <p className="hint">
          Mỗi bệnh nhân rút gọn thành 1 dòng. Ô có dấu <strong>❓</strong> là
          chưa có giá trị tự động (chưa cấu hình "Lọc giá trị nâng cao", hoặc
          dữ liệu không phải số thuần túy) — điền tay hoặc để trống nếu chấp
          nhận được.
        </p>

        {emptyCount > 0 && (
          <p className="hint text-danger">
            Còn {emptyCount} ô chưa có giá trị tự động.
          </p>
        )}

        <div style={{ overflowX: 'auto', maxHeight: '55vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                {fields.map((f) => (
                  <th key={f.key}>{finalColumnLabel(f)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {fields.map((f) => {
                    const note = r.notes[f.key];
                    return (
                      <td key={f.key}>
                        <div className="vt-cell">
                          <AutoTextarea
                            value={r.values[f.key] ?? ''}
                            onChange={(v) => setValue(i, f.key, v)}
                          />
                          {note && isWarningNote(note) && (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button onClick={handleConfirm} disabled={busy || rows.length === 0}>
            {busy
              ? 'Đang ghi…'
              : `Ghi ${rows.length} dòng vào "${finalTabTitle}"`}
          </button>
        </div>
      </div>
    </div>
  );
}
