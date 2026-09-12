import { useState } from 'react';
import type { ExtractedRecord, FieldDef } from '../electron/types';
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
 * Ô nào không tính được tự động (aggregate='none' hoặc dữ liệu không phải số
 * thuần) sẽ tô vàng, bắt buộc bác sĩ tự điền hoặc xác nhận để trống.
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
      rs.map((r, i) =>
        i === idx
          ? {
              ...r,
              values: { ...r.values, [key]: value },
              uncertain: { ...r.uncertain, [key]: false },
            }
          : r
      )
    );
  }

  const emptyCount = rows.reduce(
    (sum, r) => sum + Object.values(r.uncertain).filter(Boolean).length,
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
          Mỗi bệnh nhân rút gọn thành 1 dòng. Ô <strong className="text-warn">
            vàng
          </strong>{' '}
          là chưa có giá trị tự động (chưa cấu hình "Lọc giá trị nâng cao", hoặc
          dữ liệu không phải số thuần túy) — điền tay hoặc để trống nếu chấp
          nhận được.
        </p>

        {emptyCount > 0 && (
          <p className="hint text-warn">
            Còn {emptyCount} ô chưa có giá trị tự động.
          </p>
        )}

        <div style={{ overflowX: 'auto', maxHeight: '55vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                {fields.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {fields.map((f) => (
                    <td
                      key={f.key}
                      className={r.uncertain[f.key] ? 'uncertain' : ''}
                    >
                      <AutoTextarea
                        value={r.values[f.key] ?? ''}
                        onChange={(v) => setValue(i, f.key, v)}
                      />
                    </td>
                  ))}
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
