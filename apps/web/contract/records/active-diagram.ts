/*
 * The diagram the workspace has installed on the Canvas. A record only: no behaviour, no I/O.
 * The workspace session creates and replaces it; source, creation, connection and definitions read it.
 */
import type { Snapshot, RenderDocument, Canvas, SessionStore } from './owners.js';
import type { TransportGeneration } from '../brands.js';

/** The installed diagram: the transport generation it was read in, snapshot drawn, document and Canvas session. */
export interface ActiveDiagram {
  readonly generation: TransportGeneration;
  readonly base: Snapshot;
  readonly document: RenderDocument;
  readonly canvas: Canvas;
  readonly session: SessionStore;
}
