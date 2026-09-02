import { useEffect, useState } from 'react';
import type { ImportLogEntry } from '../electron/history';

export default function History() {
  const [entries, setEntries] = useState<ImportLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setEntries(await window.api.getHistory());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onClear() {
    if (!window.confirm('Xoá toàn bộ nhật ký import? (không ảnh hưởng dữ liệu trên Sheet)'))
      return;
    await window.api.clearHistory();
    load();
  }

  if (loading) return <div className="card">Đang tải nhật ký…</div>;

  const totalRows = entries.reduce((s, e) => s + e.rows, 0);
  const totalUsd = entries.reduce((s, e) => s + e.estimatedUsd, 0);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Nhật ký import</h2>
        <button className="ghost" onClick={load}>
          ↻ Tải lại
        </button>
        <button className="secondary" onClick={onClear} disabled={!entries.length}>
          Xoá nhật ký
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: '#6c757d' }}>Chưa có lần import nào.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: '#6c757d' }}>
            {entries.length} lần import · tổng {totalRows} dòng · ước tính $
            {totalUsd.toFixed(4)}
          </p>
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Thời gian</th>
                <th style={{ width: 130 }}>Tab</th>
                <th style={{ width: 60 }}>Dòng</th>
                <th>File</th>
                <th style={{ width: 110 }}>Chi phí ước tính</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.at).toLocaleString('vi-VN')}</td>
                  <td>{e.tab}</td>
                  <td>{e.rows}</td>
                  <td style={{ fontSize: 12, color: '#6c757d' }}>
                    {e.files.slice(0, 3).join(', ')}
                    {e.files.length > 3 && ` …+${e.files.length - 3}`}
                  </td>
                  <td style={{ fontSize: 12, color: '#6c757d' }}>
                    ${e.estimatedUsd.toFixed(4)}
                    <div>{e.totalTokens.toLocaleString('vi-VN')} token</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
