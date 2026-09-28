/*
 * Connection draft lifecycle: which section a gesture means, the draft built from its two
 * endpoints with the relationship kinds they allow, panel edits applied to it, and the review
 * every draft passes before its request is built. Reads the active diagram only; Authoring owns
 * admission, commit and recovery.
 */
import type { Result } from '../../../contract/errors.js';
import type { Request, Section } from '../../../contract/records/owners.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';
import type {
  ConnectionDraft,
  ConnectionEdit,
  RelationshipKind,
} from '../../../contract/records/connection.js';
import type { ConnectionIntent, ConnectionPolicy, ResolvedEndpoints } from './types.js';
import { connectionFailure } from './failure.js';
import { resolveEndpoints } from './endpoints.js';
import { connectionKinds } from './policy.js';

/** A connection draft awaiting review, with its built request once submission has started. */
export interface ConnectionCapture {
  readonly draft: ConnectionDraft;
  readonly request: Request | null;
}

/** A draft that passed every review check, with the trimmed label to apply. */
export interface ConnectionReview {
  readonly capture: ConnectionCapture;
  readonly label: string;
}

/** Applies one panel edit to the draft, clearing its problem. */
export function editedConnection(
  draft: ConnectionDraft,
  edit: ConnectionEdit,
): ConnectionDraft {
  if (edit.kind === 'label') {
    return { ...draft, label: edit.value, problem: null };
  }
  if (edit.kind === 'relationship-kind') {
    return { ...draft, kind: edit.value, problem: null };
  }
  return { ...draft, [edit.side]: edit.value, problem: null };
}

/** The section a connection gesture targets, or why the gesture cannot start. */
export function resolveConnectionSection(
  active: ActiveDiagram,
  intent: ConnectionIntent,
  occupied: boolean,
): Result<Section> {
  if (occupied) {
    return connectionFailure(
      'pending-request',
      'Finish or cancel the current connection first.',
      'Apply or cancel the retained connection draft.',
    );
  }
  return sectionForGesture(active, intent);
}

/** Builds the draft from a gesture's two endpoints, with the relationship kinds they allow. */
export function buildConnectionDraft(
  policy: ConnectionPolicy,
  active: ActiveDiagram,
  intent: ConnectionIntent,
  section: Section,
): Result<ConnectionDraft> {
  const endpoints = resolveEndpoints(policy, active, intent);
  if (!endpoints.ok) {
    return endpoints;
  }
  return draftWithKinds(policy, active, intent, section, endpoints.value);
}

/** Every check a draft passes before its request is built: present, current and labelled. */
export function reviewConnection(
  capture: ConnectionCapture | null,
  active: ActiveDiagram | null,
): Result<ConnectionReview> {
  if (capture === null) {
    return connectionFailure(
      'invalid-edit',
      'No connection is awaiting review.',
      'Connect two compatible endpoints first.',
    );
  }
  return reviewCurrent(capture, active);
}

/** The gesture's section: the gesture must belong to the active collection. */
function sectionForGesture(
  active: ActiveDiagram,
  intent: ConnectionIntent,
): Result<Section> {
  if (intent.base.collectionId !== active.document.collection.id) {
    return connectionFailure(
      'stale-gesture',
      'The diagram changed while this connection was being edited.',
      'Reconnect the endpoints on the current diagram.',
    );
  }
  return findConnectionSection(active, intent.source.section);
}

/** The named section, which must exist and not be a sequence diagram. */
function findConnectionSection(
  active: ActiveDiagram,
  sectionId: string,
): Result<Section> {
  const section = active.document.collection.sections.find((item) => item.id === sectionId);
  if (section === undefined || section.mode === 'sequence') {
    return connectionFailure(
      'unsupported-edit',
      'Connections are unavailable in sequence diagrams.',
      'Choose a compatible diagram section.',
    );
  }
  return { ok: true, value: section };
}

/** The draft with its allowed kinds; no compatible kind means these endpoints cannot connect. */
function draftWithKinds(
  policy: ConnectionPolicy,
  active: ActiveDiagram,
  intent: ConnectionIntent,
  section: Section,
  endpoints: ResolvedEndpoints,
): Result<ConnectionDraft> {
  const kinds = connectionKinds(
    policy,
    section.mode,
    active.document.collection,
    endpoints.source.kind,
    endpoints.target,
  );
  const [kind] = kinds;
  if (kind === undefined) {
    return connectionFailure(
      'unsupported-edit',
      'These endpoints have no compatible relationship kind.',
      'Choose endpoints supported by this diagram.',
    );
  }
  return { ok: true, value: draftRecord(active, intent, section, endpoints, kinds, kind) };
}

/** The new draft: the first allowed kind preselected, an empty label and no cardinalities. */
function draftRecord(
  active: ActiveDiagram,
  intent: ConnectionIntent,
  section: Section,
  endpoints: ResolvedEndpoints,
  kinds: readonly RelationshipKind[],
  kind: RelationshipKind,
): ConnectionDraft {
  return {
    id: intent.id,
    base: active.base,
    generation: active.generation,
    collection: active.document.collection,
    section,
    source: endpoints.source,
    target: endpoints.target,
    kinds,
    kind,
    label: '',
    from: 'none',
    to: 'none',
    problem: null,
    requestState: 'draft',
  };
}

/** The draft must belong to the active collection and generation. */
function reviewCurrent(
  capture: ConnectionCapture,
  active: ActiveDiagram | null,
): Result<ConnectionReview> {
  if (active === null || !sameDiagram(active, capture.draft)) {
    return connectionFailure(
      'stale-gesture',
      'The connection belongs to another collection or generation.',
      'Return to the captured collection and retry, or cancel this draft.',
    );
  }
  return reviewLabel(capture);
}

/** Same collection, same generation. */
function sameDiagram(
  active: ActiveDiagram,
  draft: ConnectionDraft,
): boolean {
  return (
    active.document.collection.id === draft.collection.id && active.generation === draft.generation
  );
}

/** The label is required; it is trimmed before applying. */
function reviewLabel(capture: ConnectionCapture): Result<ConnectionReview> {
  const label = capture.draft.label.trim();
  if (label.length === 0) {
    return connectionFailure(
      'invalid-edit',
      'Give the connection a label before applying it.',
      'Enter a short relationship label.',
    );
  }
  return { ok: true, value: { capture, label } };
}
