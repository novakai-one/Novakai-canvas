import type { LayoutIntent, Projection, VisualSection } from '../../contract/records/input.js';
import type { Result } from '../../contract/errors.js';
import { protect, reject } from './outcomes.js';
/** Independently check consumed column intent after Presentation decoding; public execute returns correction diagnostics. */
function check(
  layout: LayoutIntent,
  path: string,
): void {
  if (layout.columns === undefined) return;
  checkRange(layout.columns, path);
  if (layout.algorithm !== 'grid') reject('invalid-input', path, 'Columns require grid layout');
}
/** Never coerce malformed track counts; callers correct input and retry without side effects. */
function checkRange(
  columns: number,
  path: string,
): void {
  const inRange = columns >= 1 && columns <= 12;
  if (!Number.isInteger(columns) || !inRange)
    reject('invalid-input', path, 'Columns must be an integer from 1 to 12');
}
/** Every group has independent intent, including nested groups. */
function checkSection(section: VisualSection): void {
  check(section.layout, section.id);
  section.groups.forEach((group): void => check(group.layout, group.id));
}
/** Check consumed scope intent without writes; callers retain scene/draft, correct input and retry. Authoring owns commit recovery. */
export function checkColumns(projection: Projection): Result<void> {
  return protect(() => {
    check(projection.arrangement, 'arrangement');
    projection.sections.forEach(checkSection);
  });
}
