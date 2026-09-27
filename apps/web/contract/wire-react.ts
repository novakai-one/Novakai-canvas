import type { Collection } from './records/owners.js';
import type { EditedWire, WireEdit } from './records/wire-editor.js';
/** Field groups are pure form views; the session owns persistence and the captured revision. */
export interface WireFieldsProps {
  readonly value: EditedWire;
  readonly collection: Collection;
  edit(command: WireEdit): void;
}
