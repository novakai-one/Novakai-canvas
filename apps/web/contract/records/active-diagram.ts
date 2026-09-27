/*
 * The diagram the workspace has installed on the Canvas. A record only: no behaviour, no I/O.
 * The workspace session creates and replaces it; source, creation, connection and definitions read it.
 */
import type { Snapshot, RenderDocument, Canvas, SessionStore } from './owners.js';

/** The installed diagram: render generation, snapshot drawn, document and Canvas session. */
export interface ActiveDiagram {
  readonly generation: string;
  readonly base: Snapshot;
  readonly document: RenderDocument;
  readonly canvas: Canvas;
  readonly session: SessionStore;
}
