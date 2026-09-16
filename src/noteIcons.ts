import type { CellNoteType } from '../electron/types';

/** Icon + nhãn hiển thị cho từng loại note — dùng chung giữa GroupedReview và FinalPreview. */
export const NOTE_ICON: Record<CellNoteType, string> = {
  uncertain: '❓',
  not_found: '⚠️',
  format_mismatch: '❌',
  missing_info: '⚡',
  inferred: '💡',
};

export const NOTE_LABEL: Record<CellNoteType, string> = {
  uncertain: 'Không chắc chắn',
  not_found: 'Không tìm thấy',
  format_mismatch: 'Sai định dạng',
  missing_info: 'Thiếu thông tin để kết luận',
  inferred: 'AI suy luận thêm',
};
