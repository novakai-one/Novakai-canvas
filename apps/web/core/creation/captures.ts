/*
 * The Add forms' captures. The first edit or submit of a form captures the new item's ID and the
 * snapshot, collection and generation it is added against; the request built from them is kept, so
 * a retry resends the same body. While any capture holds a request, every form is locked. A
 * confirmed or dismissed request releases its capture, and so does a refused or unsent one; an
 * uncertain one keeps it, so a retry cannot add the item twice. Pure; the session mints the IDs,
 * builds the requests and publishes.
 */
import type { CreationKind } from '../../contract/records/creation.js';
import type {
  Collection,
  DiagramObject,
  Group,
  Request,
  Section,
  Snapshot,
} from '../../contract/records/owners.js';
import type { Submission } from '../../contract/records/submission.js';
import type { ActiveDiagram } from '../../contract/records/workspace.js';

/** The ID type each form adds. */
export interface CaptureIdMap {
  readonly diagram: Section['id'];
  readonly object: DiagramObject['id'];
  readonly group: Group['id'];
}

/** One form's capture: the new ID, what it is added against, and its request once built. */
export interface CreationCapture<Id> {
  readonly id: Id;
  readonly base: Snapshot;
  readonly collection: Collection;
  readonly generation: string;
  readonly request: Request | null;
}

/** Every form's capture; null until the form is first edited or submitted. */
export type CreationCaptures = {
  readonly [K in CreationKind]: CreationCapture<CaptureIdMap[K]> | null;
};

/** Mints each form's new ID; called only when that form's capture is made. */
export type CaptureIds = { readonly [K in CreationKind]: () => CaptureIdMap[K] };

/** The Add forms in the order they are checked. */
export const creationKinds: readonly CreationKind[] = ['diagram', 'object', 'group'];

/** No form captured. */
export const noCaptures: CreationCaptures = { diagram: null, object: null, group: null };

/** The form's capture, made from the open diagram the first time; `mint` runs only then. */
export function captureFor<K extends CreationKind>(
  captures: CreationCaptures,
  kind: K,
  active: ActiveDiagram,
  mint: () => CaptureIdMap[K],
): CreationCapture<CaptureIdMap[K]> {
  return captures[kind] ?? freshCapture(active, mint());
}

/** The captures holding this capture for its form. */
export function holding<K extends CreationKind>(
  captures: CreationCaptures,
  kind: K,
  capture: CreationCapture<CaptureIdMap[K]>,
): CreationCaptures {
  return { ...captures, [kind]: capture };
}

/** The captures with the form's request kept, unless it already keeps one. */
export function withRequest(
  captures: CreationCaptures,
  kind: CreationKind,
  request: Request,
): CreationCaptures {
  const capture = captures[kind];
  if (capture === null || capture.request !== null) return captures;
  return { ...captures, [kind]: { ...capture, request } };
}

/** The captures without the form's capture. */
export function released(
  captures: CreationCaptures,
  kind: CreationKind,
): CreationCaptures {
  return { ...captures, [kind]: null };
}

/** A confirmed request releases every capture that sent it; `cleared` names those forms. */
export function settledCaptures(
  captures: CreationCaptures,
  requestId: string,
): { readonly captures: CreationCaptures; readonly cleared: readonly CreationKind[] } {
  const cleared = creationKinds.filter((kind) => sentRequest(captures, kind, requestId));
  return { captures: cleared.reduce(released, captures), cleared };
}

/** A dismissed request releases the first capture that sent it; null when none did. */
export function dismissedCaptures(
  captures: CreationCaptures,
  requestId: string,
): CreationCaptures | null {
  const kind = creationKinds.find((item) => sentRequest(captures, item, requestId));
  return kind === undefined ? null : released(captures, kind);
}

/** A refused or unsent add releases its capture; a request still in the journal keeps it. */
export function refusedCaptures(
  captures: CreationCaptures,
  kind: CreationKind,
  pending: readonly Submission[],
): CreationCaptures {
  const id = captures[kind]?.request?.request;
  const item = pending.find((entry) => entry.request.request === id);
  return item !== undefined && item.state !== 'rejected' ? captures : released(captures, kind);
}

/** Any form holds a request, so every form is locked. */
export function creationLocked(captures: CreationCaptures): boolean {
  return creationKinds.some((kind) => hasRequest(captures[kind]));
}

/** An add finished after another collection opened, and no other add is in flight. */
export function landedElsewhere(
  origin: Collection | undefined,
  active: ActiveDiagram | null,
  captures: CreationCaptures,
): origin is Collection {
  return (
    origin !== undefined &&
    origin.id !== active?.document.collection.id &&
    !creationLocked(captures)
  );
}

/** The capture for this form, if any, belongs to another collection than the open one. */
export function capturedElsewhere(
  capture: CreationCapture<unknown> | null,
  active: ActiveDiagram,
): boolean {
  return capture !== null && capture.collection.id !== active.document.collection.id;
}

/** A capture of the open diagram as it is now. */
function freshCapture<Id>(
  active: ActiveDiagram,
  id: Id,
): CreationCapture<Id> {
  return {
    id,
    base: active.base,
    collection: active.document.collection,
    generation: active.generation,
    request: null,
  };
}

/** The capture holds a request. */
function hasRequest(capture: CreationCapture<unknown> | null): boolean {
  return capture !== null && capture.request !== null;
}

/** The form's capture sent this request. */
function sentRequest(
  captures: CreationCaptures,
  kind: CreationKind,
  requestId: string,
): boolean {
  return captures[kind]?.request?.request === requestId;
}
