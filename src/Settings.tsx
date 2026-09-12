import type { FieldDef } from '../electron/types';
import FieldsEditor from './FieldsEditor';

interface Props {
  fields: FieldDef[];
  signedIn: boolean;
  onSaveSharedFields: (fields: FieldDef[]) => Promise<FieldDef[]>;
  onTabsChanged: () => void;
}

export default function Settings({
  fields,
  signedIn,
  onSaveSharedFields,
  onTabsChanged,
}: Props) {
  return (
    <FieldsEditor
      fields={fields}
      signedIn={signedIn}
      onSaveShared={onSaveSharedFields}
      onTabsChanged={onTabsChanged}
    />
  );
}
