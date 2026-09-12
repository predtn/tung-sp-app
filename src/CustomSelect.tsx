import { useEffect, useRef, useState } from 'react';

export interface CustomSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Dropdown tự vẽ thay cho <select> gốc — <select> render list bằng OS/trình
 * duyệt nên không thể tuỳ biến animation/giao diện. Giữ API gần giống select
 * (value/onChange theo string) để thay thế tại chỗ dễ dàng.
 */
export default function CustomSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  style,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  function closeMenu() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 120);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={'custom-select' + (disabled ? ' disabled' : '') + (className ? ' ' + className : '')}
      style={style}
    >
      <button
        type="button"
        className={'custom-select-trigger' + (open ? ' open' : '')}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        <span className={selected ? '' : 'custom-select-placeholder'}>
          {selected ? selected.label : placeholder ?? '—'}
        </span>
        <span className="custom-select-arrow" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={'custom-select-menu' + (closing ? ' closing' : '')}>
          {options.map((o) => (
            <li
              key={o.value}
              className={
                'custom-select-option' +
                (o.value === value ? ' selected' : '') +
                (o.disabled ? ' disabled' : '')
              }
              onClick={() => {
                if (o.disabled) return;
                onChange(o.value);
                closeMenu();
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
