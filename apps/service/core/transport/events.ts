/*
 * The server-sent event frames of `GET /api/v1/events`. Pure. Every connection first receives
 * `connected` with the server's generation; `committed` is a hint only, so a client rereads
 * authoritative state and keeps its drafts. Authoring owns commit and receipt recovery.
 */
import type { EventFrames } from '../../contract/ports/transport.js';
import type { CommittedChange } from '../../contract/ports/notifications.js';
import type { Generation } from '../../contract/brands.js';

/** The frame names the change stream sends. */
type EventName = 'connected' | 'committed';

/**
 * The frames of the change stream: `connected` and `committed` carry version 1 and the
 * generation; `keepalive` is a comment line that holds an idle connection open. Cannot fail.
 */
export const eventFrames: EventFrames = Object.freeze({
  connected,
  committed,
  keepalive: ': keepalive\n\n',
});

/** The first frame on every connection. */
function connected(generation: Generation): string {
  return frame('connected', { version: 1, generation });
}

/** The frame sent after each commit, carrying the committed change. */
function committed(
  generation: Generation,
  change: CommittedChange,
): string {
  return frame('committed', { version: 1, generation, change });
}

/** One event: its name line, its JSON data line and the blank line that ends it. */
function frame(
  name: EventName,
  data: unknown,
): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
