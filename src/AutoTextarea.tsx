import { useLayoutEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  title?: string;
  placeholder?: string;
}

/**
 * Ô nhập tự giãn cao theo nội dung (không cắt chữ, tự xuống dòng).
 * Dùng thay cho <input> ở bảng review.
 */
export default function AutoTextarea({
  value,
  onChange,
  className,
  title,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={'auto-textarea' + (className ? ' ' + className : '')}
      value={value}
      title={title}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
