/*
 * Why this file exists
 *
 * The web app keeps a connection open to hear when a diagram is saved, so it can reread it. For
 * example, after the CLI applies a change, every open browser receives a `committed` message.
 *
 * This file writes the text of those messages (server-sent events): `connected` when a connection
 * opens, `committed` after each saved change, and a `keepalive` line. It never decides when to send
 * them. A `committed` message is only a hint: the web app rereads the saved state and keeps its
 * drafts.
 */
import type { EventFrames } from '../../contract/ports/transport.js';
import type { CommittedChange } from '../../contract/ports/notifications.js';
import type { Generation } from '../../contract/brands.js';

/** The frame names the change stream sends. */
type EventName = 'connected' | 'committed';

/**
 * The text of each change stream message. `connected` and `committed` carry version 1 and this
 * server run's `generation`; `keepalive` is a comment line that keeps an idle connection open.
 * Never fails.
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
