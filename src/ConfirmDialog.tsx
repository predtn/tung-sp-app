import { useEffect, useState } from 'react';

/**
 * Thay cho window.confirm() (hộp thoại hệ điều hành, không theme được, lạc
 * quẻ so với giao diện app). Gọi confirmDialog(...) từ bất kỳ đâu trong app,
 * trả về Promise<boolean> giống window.confirm — không cần đổi logic gọi,
 * chỉ cần `await confirmDialog(...)` thay vì `window.confirm(...)`.
 *
 * <ConfirmDialogHost /> phải được render đúng 1 lần ở gốc app (App.tsx).
 */

interface ConfirmRequest {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true -> nút xác nhận tô đỏ (hành động nguy hiểm, vd xoá) */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let pushRequest: ((req: ConfirmRequest) => void) | null = null;

export function confirmDialog(
  message: string,
  opts?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushRequest) {
      // fallback cực hiếm (host chưa mount) -> không chặn luồng
      resolve(window.confirm(message));
      return;
    }
    pushRequest({ message, resolve, ...opts });
  });
}

export default function ConfirmDialogHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);

  useEffect(() => {
    pushRequest = (req) => setQueue((q) => [...q, req]);
    return () => {
      pushRequest = null;
    };
  }, []);

  const current = queue[0];
  if (!current) return null;

  function answer(ok: boolean) {
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  }

  // \n trong message -> nhiều đoạn văn (giữ format giống window.confirm cũ)
  const paragraphs = current.message.split('\n\n');

  return (
    <div className="modal-overlay" onClick={() => answer(false)}>
      <div
        className="modal confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {current.title && <h3>{current.title}</h3>}
        {paragraphs.map((p, i) => (
          <p key={i} className="confirm-modal-text">
            {p.split('\n').map((line, j) => (
              <span key={j}>
                {line}
                {j < p.split('\n').length - 1 && <br />}
              </span>
            ))}
          </p>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="secondary" onClick={() => answer(false)}>
            {current.cancelLabel ?? 'Huỷ'}
          </button>
          <button
            className={current.danger ? 'danger-btn' : ''}
            onClick={() => answer(true)}
          >
            {current.confirmLabel ?? 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  );
}
