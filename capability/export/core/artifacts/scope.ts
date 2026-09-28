/*
 * Selects the part of the scene to export and checks export bounds.
 */
import { failure } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { Snapshot, Selection, Box } from '../../contract/records/artifact.js';
import type { Scope } from '../../contract/records/input.js';
import { success } from '../validation/outcomes.js';

/**
 * Selects what to draw. Scope `all` gives every section with the scene bounds; a section scope
 * gives that one section with its own box. Node geometry inside a section stays relative to
 * that section.
 *
 * @param snapshot - The leased snapshot.
 * @param scope - The requested scope.
 * @returns The selection, or `missing-section` if the section is not in this revision.
 * @throws Never for plain snapshot data. A throwing getter or proxy in the snapshot propagates;
 * `produce` runs this inside `protect`, which turns it into `encoding-failed`.
 */
export function selectScope(
  snapshot: Snapshot,
  scope: Scope,
): Result<Selection> {
  if (scope.kind === 'all')
    return success({ sections: snapshot.scene.sections, bounds: snapshot.scene.bounds });
  const section = snapshot.scene.sections.find(
    /** Whether this is the requested section. */ (item) => item.id === scope.id,
  );
  if (!section)
    return failure(
      'missing-section',
      'scope.id',
      'Requested section does not exist in this revision',
    );
  return success({ sections: [section], bounds: section.box });
}

/**
 * Whether a box can be allocated: all four numbers finite and both width and height above
 * zero. Negative `x` and `y` are allowed.
 *
 * @param box - The bounds to check.
 * @returns `true` when the box is usable.
 * @throws Never for plain snapshot data. A throwing getter or proxy in the snapshot propagates;
 * `produce` runs this inside `protect`, which turns it into `encoding-failed`.
 */
export function validBounds(box: Box): boolean {
  const finite = [box.x, box.y, box.width, box.height].every(Number.isFinite);
  if (!finite) return false;
  const bothSidesPositive = Math.min(box.width, box.height) > 0;
  return bothSidesPositive;
}
