import type { ExtractedRecord, FieldDef } from '../electron/types';
import type { CellIssue } from './validation';
import GroupedReview from './GroupedReview';

interface Props {
  fields: FieldDef[];
  records: ExtractedRecord[];
  issues: CellIssue[];
  readOnly?: boolean;
  onChange: (r: ExtractedRecord[]) => void;
  onOpenPdf: (path: string, name: string) => void;
  /** giá trị "Lọc nâng cao" bác sĩ đã sửa tay, khoá "idValue:fieldKey" */
  aggOverrides: Record<string, string>;
  onAggOverride: (key: string, value: string) => void;
}

export default function ReviewTable({
  fields,
  records,
  issues,
  readOnly = false,
  onChange,
  onOpenPdf,
  aggOverrides,
  onAggOverride,
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
        issues={issues}
        onChange={onChange}
        onOpenPdf={onOpenPdf}
        aggOverrides={aggOverrides}
        onAggOverride={onAggOverride}
      />
    </div>
  );
}
