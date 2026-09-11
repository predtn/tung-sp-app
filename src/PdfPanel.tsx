import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

// Vite bundle worker của pdfjs; new URL(..., import.meta.url) để Vite nhận diện asset
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

interface Props {
  filePath: string;
  fileName: string;
  onClose: () => void;
  onOpenExternal: (path: string) => void;
}

export default function PdfPanel({ filePath, fileName, onClose, onOpenExternal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [scale, setScale] = useState(1.2);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let pdfDoc: pdfjs.PDFDocumentProxy | null = null;

    async function render() {
      setStatus('loading');
      setErrMsg('');
      try {
        const bytes = await window.api.readPdf(filePath);
        if (cancelled) return;
        // clone sang ArrayBuffer thường để pdfjs không giữ tham chiếu vùng nhớ IPC
        const data = new Uint8Array(bytes).slice();
        pdfDoc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        setNumPages(pdfDoc.numPages);
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        for (let p = 1; p <= pdfDoc.numPages; p++) {
          const page = await pdfDoc.getPage(p);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'pdf-page';
          container.appendChild(canvas);
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus('ready');
      } catch (e: any) {
        if (!cancelled) {
          setErrMsg(e?.message ?? String(e));
          setStatus('error');
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      pdfDoc?.destroy();
    };
  }, [filePath, scale]);

  return (
    <div className="pdf-panel">
      <div className="pdf-panel-head">
        <strong className="pdf-panel-title" title={filePath}>
          📄 {fileName}
        </strong>
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button
            className="ghost sm"
            onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}
            title="Thu nhỏ"
          >
            −
          </button>
          <button
            className="ghost sm"
            onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}
            title="Phóng to"
          >
            +
          </button>
          <button
            className="ghost sm"
            onClick={() => onOpenExternal(filePath)}
            title="Mở bằng trình đọc PDF ngoài"
          >
            ↗
          </button>
          <button className="ghost sm" onClick={onClose} title="Đóng panel">
            ✕
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="pdf-panel-msg">
          <span className="spin">⏳</span> Đang tải PDF…
        </div>
      )}
      {status === 'error' && (
        <div className="pdf-panel-msg" style={{ color: '#b71c1c' }}>
          Không hiển thị được PDF: {errMsg}
          <br />
          <button
            style={{ marginTop: 8 }}
            onClick={() => onOpenExternal(filePath)}
          >
            Mở bằng trình đọc ngoài
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="pdf-panel-body"
        style={{ display: status === 'ready' ? 'block' : 'none' }}
      />
      {status === 'ready' && (
        <div className="pdf-panel-foot">{numPages} trang · zoom {Math.round(scale * 100)}%</div>
      )}
    </div>
  );
}
