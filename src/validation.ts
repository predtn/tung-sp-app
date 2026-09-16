import type { CellNoteType, ExtractedRecord, CellNote } from '../electron/types';

/** true nếu note thuộc nhóm "cần bác sĩ soát lại" (không tính 'inferred' —
 * chỉ mang tính tham khảo, AI vẫn tự tin về value). */
export function isWarningNote(note: CellNote): boolean {
  return note.type !== 'inferred';
}

/**
 * Đếm số ô còn note "cần soát lại" (uncertain/not_found/format_mismatch/
 * missing_info), bỏ qua record lỗi. Note 'inferred' (AI suy luận thêm, vẫn
 * tự tin về value) KHÔNG tính vào đây — không phải vấn đề cần cảnh báo trước
 * khi import. `byType` tách riêng số ô theo từng loại note, để hiển thị đúng
 * icon/label thay vì gộp chung 1 con số dưới 1 icon duy nhất.
 */
export function countWarnings(records: ExtractedRecord[]): {
  cells: number;
  records: number;
  byType: Partial<Record<CellNoteType, number>>;
} {
  let cells = 0;
  let recs = 0;
  const byType: Partial<Record<CellNoteType, number>> = {};
  for (const r of records) {
    if (r.error) continue;
    const warnNotes = Object.values(r.notes).filter(isWarningNote);
    if (warnNotes.length > 0) {
      cells += warnNotes.length;
      recs += 1;
      for (const n of warnNotes) {
        byType[n.type] = (byType[n.type] ?? 0) + 1;
      }
    }
  }
  return { cells, records: recs, byType };
}
