/*
 * Whether a delivered render may install. In order: the service answered from the ticket's
 * generation and the view is still on it; the document is the requested collection; the
 * workspace, generation and listed revision are still those the ticket captured, and the document
 * is at that revision; the checked snapshot lists the document's revision. A newer snapshot can
 * also invalidate a ticket before its response arrives. Pure; the session rereads the workspace
 * after a generation, admission or snapshot failure.
 */
import { diagnostic, type Result, type WebDiagnostic } from '../../../contract/errors.js';
import type { RenderCode } from '../../../contract/records/error-codes.js';
import type { RenderDocument, Snapshot } from '../../../contract/records/owners.js';
import type { WorkspaceView } from '../../../contract/records/workspace.js';
import { listedRevision, type RenderTicket } from './ticket.js';

/** A checked workspace snapshot with its collection catalogue. */
export interface LatestSnapshot {
  readonly snapshot: Snapshot;
  readonly collections: WorkspaceView['collections'];
}

/** The parts of the workspace view admission reads. */
export type AdmissionView = Pick<WorkspaceView, 'snapshot' | 'generation' | 'collections'>;

/** A render failure: the web's own, with a render code. */
export type RenderFailure = WebDiagnostic & { readonly code: RenderCode };

/** A failed step, whatever the success type. */
export type Refusal = { readonly ok: false; readonly error: RenderFailure };

/** The service answered from another generation than the ticket's, or the view has left it. */
export function generationChanged(
  delivered: string,
  ticket: RenderTicket,
  current: string,
): boolean {
  return delivered !== ticket.generation || ticket.generation !== current;
}

/** `workspace-generation`: the service generation changed while the collection opened. */
export function generationFailure(): Refusal {
  return refused(
    'workspace-generation',
    'The workspace changed while opening this collection',
    'Refresh the workspace, then try again.',
  );
}

/** The decoded document when it is the ticket's collection; otherwise `stale-diagram`. */
export function documentFor(
  document: RenderDocument,
  ticket: RenderTicket,
): Result<RenderDocument, RenderFailure> {
  if (document.collection.id !== ticket.id)
    return refused(
      'stale-diagram',
      'The response was for a different collection',
      'Choose the collection again to retry.',
    );
  return { ok: true, value: document };
}

/** Whether the document may install: the ticket's inputs still hold and the document is at its revision; otherwise `render-input-changed`. */
export function renderAdmission(
  view: AdmissionView,
  ticket: RenderTicket,
  document: RenderDocument,
): Result<void, RenderFailure> {
  if (inputsMoved(view, ticket) || document.collection.revision !== ticket.revision)
    return { ok: false, error: renderInputChanged() };
  return { ok: true, value: undefined };
}

/** The failure a newer snapshot gives an in-flight ticket (`render-input-changed`); null while the snapshot still matches it. */
export function renderInvalidation(
  ticket: RenderTicket,
  latest: LatestSnapshot,
  generation: string,
): RenderFailure | null {
  if (ticketMatches(ticket, latest, generation)) return null;
  return renderInputChanged();
}

/** The checked snapshot a document installs against, once it lists the document's revision; otherwise `snapshot-mismatch`. */
export function snapshotBase(
  view: AdmissionView,
  document: RenderDocument,
): Result<Snapshot, RenderFailure> {
  const snapshot = view.snapshot;
  if (snapshot === null || !listsRevision(view.collections, document))
    return refused(
      'snapshot-mismatch',
      'The collection changed while it was opening',
      'Refresh the library, then try the collection again.',
    );
  return { ok: true, value: snapshot };
}

/** Workspace, generation or listed revision moved since the ticket; an unlisted collection has moved. */
function inputsMoved(
  view: AdmissionView,
  ticket: RenderTicket,
): boolean {
  return (
    view.snapshot?.workspace !== ticket.workspace ||
    view.generation !== ticket.generation ||
    view.collections.find((item) => item.id === ticket.id)?.revision !== ticket.revision
  );
}

/** The snapshot still names the ticket's workspace, generation and revision; unlisted reads as -1. */
function ticketMatches(
  ticket: RenderTicket,
  latest: LatestSnapshot,
  generation: string,
): boolean {
  return (
    ticket.workspace === latest.snapshot.workspace &&
    ticket.generation === generation &&
    ticket.revision === listedRevision(latest.collections, ticket.id)
  );
}

/** The catalogue lists the document's collection at the document's revision. */
function listsRevision(
  collections: WorkspaceView['collections'],
  document: RenderDocument,
): boolean {
  const listed = collections.find((item) => item.id === document.collection.id);
  return listed?.revision === document.collection.revision;
}

/** `render-input-changed`: the workspace moved while the collection opened. */
function renderInputChanged(): RenderFailure {
  return diagnostic(
    'render-input-changed',
    'The workspace changed while opening this collection',
    'Choose the collection again to retry.',
  );
}

/** A failed step carrying the render failure `code`. */
function refused(
  code: RenderCode,
  message: string,
  recovery: string,
): Refusal {
  return { ok: false, error: diagnostic(code, message, recovery) };
}
