import type { ExtractedRecord, FieldDef, CellNote } from '../electron/types';
import GroupedReview from './GroupedReview';

interface Props {
  fields: FieldDef[];
  records: ExtractedRecord[];
  readOnly?: boolean;
  onChange: (r: ExtractedRecord[]) => void;
  onOpenPdf: (path: string, name: string) => void;
  /** giá trị "Lọc nâng cao" bác sĩ đã sửa tay, khoá "idValue:fieldKey" */
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

export default function ReviewTable({
  fields,
  records,
  readOnly = false,
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
  return (
    <div
      style={readOnly ? { pointerEvents: 'none', opacity: 0.55 } : undefined}
    >
      <div className="review-toolbar">
        <span className="review-count">
          {records.length} hồ sơ · {fields.length} trường
        </span>
      </div>

      <GroupedReview
        fields={fields}
        records={records}
        onChange={onChange}
        onOpenPdf={onOpenPdf}
        aggOverrides={aggOverrides}
        onAggOverride={onAggOverride}
        aggResults={aggResults}
        aggNotes={aggNotes}
        aggLoadingKeys={aggLoadingKeys}
        originalRecords={originalRecords}
        onSaveGroupToCache={onSaveGroupToCache}
      />
    </div>
  );
}
