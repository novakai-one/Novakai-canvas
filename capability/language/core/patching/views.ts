import type { Collection } from '../../contract/ports/model.js';
import type { Operation } from '../../contract/records/syntax.js';
import type { RawRecord } from '../lowering/fields.js';
import { reject } from '../validation/outcomes.js';
import { viewOwner } from './targets.js';
/** Membership changes operate on one view; canonical objects and relationships are not duplicated. */
export function editMembership(
  collection: Collection,
  operation: Operation,
): RawRecord {
  const section = viewOwner(collection, operation);
  if (operation.action === 'hide')
    return { op: 'hide', section: section.id, object: operation.address.id };
  if (operation.action === 'show') return show(collection, operation);
  return connect(collection, operation);
}
/** Showing an already visible object is an error, including represented group visibility. */
function show(
  collection: Collection,
  operation: Operation,
): RawRecord {
  const section = viewOwner(collection, operation);
  const visible = [
    ...section.appearances.map((item) => item.object),
    ...section.groups.map((item) => item.represents),
  ];
  if (visible.some((identity) => identity === operation.address.id))
    reject(
      'invalid-value',
      operation.span,
      'Not-yet-visible object',
      'Object is already visible',
      operation.address.id,
    );
  return {
    op: 'replace',
    target: 'sections',
    value: { ...section, appearances: [...section.appearances, { object: operation.address.id }] },
  };
}
/** Connect/disconnect only changes explicit wire appearances; endpoints are checked at final planning. */
function connect(
  collection: Collection,
  operation: Operation,
): RawRecord {
  const section = viewOwner(collection, operation);
  const existing = section.wires.find((item) => item.relationship === operation.address.id);
  const wires = changedWires(section.wires, existing !== undefined, operation);
  return { op: 'replace', target: 'sections', value: { ...section, wires } };
}
/** Missing disconnect and duplicate connect are typed target failures, never silent successful guesses. */
function changedWires(
  wires: readonly RawRecord[],
  exists: boolean,
  operation: Operation,
): readonly RawRecord[] {
  if (operation.action === 'disconnect') return removeWire(wires, exists, operation);
  if (exists)
    reject('invalid-value', operation.span, 'Not-yet-connected wire', 'Wire is already visible');
  return [...wires, { relationship: operation.address.id }];
}
/** Disconnect leaves the canonical relationship available in other sections. */
function removeWire(
  wires: readonly RawRecord[],
  exists: boolean,
  operation: Operation,
): readonly RawRecord[] {
  if (!exists) reject('unknown-target', operation.span, 'Connected wire', 'Wire is not visible');
  return wires.filter((item) => item.relationship !== operation.address.id);
}
