/*
 * Building and comparing a ReadGeneration. Pure. Only `currentGeneration` can fail; the caller that
 * wanted to send reports it and keeps its draft.
 */
import type { TransportGeneration } from '../../contract/brands.js';
import type { ReadGeneration } from '../../contract/records/read-generation.js';
import { failure, type Result } from '../../contract/errors.js';

/** Nothing read yet: before the first workspace read answers. */
export const unreadGeneration: ReadGeneration = Object.freeze({ kind: 'unread' });

/** The read generation that names `generation`. */
export function readGeneration(generation: TransportGeneration): ReadGeneration {
  return { kind: 'read', generation };
}

/** Whether `read` is read and names `generation`. An unread generation matches none. */
export function atGeneration(
  read: ReadGeneration,
  generation: TransportGeneration,
): boolean {
  return read.kind === 'read' && read.generation === generation;
}

/** Whether both are read and name the same generation. Unread matches nothing, not even unread. */
export function sameGeneration(
  first: ReadGeneration,
  second: ReadGeneration,
): boolean {
  return first.kind === 'read' && atGeneration(second, first.generation);
}

/**
 * The generation a send posts under now: the latest read one. Fails with `not-read` before the
 * first workspace read; nothing is sent.
 */
export function currentGeneration(read: ReadGeneration): Result<TransportGeneration> {
  if (read.kind === 'unread')
    return failure('not-read', 'The workspace has not been read yet; nothing was sent');
  return { ok: true, value: read.generation };
}
