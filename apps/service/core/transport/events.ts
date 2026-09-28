/*
 * Why this file exists
 *
 * The web app keeps a connection open to hear when a diagram is saved, so it can reread it. For
 * example, after the CLI applies a change, every open browser receives a `committed` message.
 *
 * This file writes the text of those messages, called frames: `connected` when a connection
 * opens, `committed` after each saved change, and `keepalive`, sent now and then so an idle
 * connection stays open. It never decides when to send them.
 */
import type { EventFrames } from '../../contract/ports/transport.js';
import type { CommittedChange } from '../../contract/ports/notifications.js';
import type { Generation } from '../../contract/brands.js';

/** The frame names the change stream sends. */
type EventName = 'connected' | 'committed';

/**
 * Writes the text of each change stream frame. `connected(generation)` and
 * `committed(generation, change)` return the frame's text, carrying version 1 and this server
 * run's `generation`. `keepalive` is fixed text the browser ignores. Never fails.
 */
export const eventFrames: EventFrames = Object.freeze({
  connected,
  committed,
  keepalive: ': keepalive\n\n',
});

/** Writes the first frame on every connection. */
function connected(generation: Generation): string {
  const message = { version: 1, generation };
  return frame('connected', message);
}

/** Writes the frame sent after each commit, carrying the committed change. */
function committed(
  generation: Generation,
  change: CommittedChange,
): string {
  const message = { version: 1, generation, change };
  return frame('committed', message);
}

/** Writes one frame: its name line, the message as one JSON line, and the blank line that ends it. */
function frame(
  name: EventName,
  message: object,
): string {
  const json = JSON.stringify(message);
  return `event: ${name}\ndata: ${json}\n\n`;
}
