/*
 * Why this file exists
 *
 * When a change is saved, every open browser tab should find out. For example, after the CLI saves
 * `my-diagram`, a browser showing it hears about the change on `GET /api/v1/events`.
 *
 * This file is the in-memory channel for that: Authoring announces each saved change, and every
 * listener hears it. It keeps nothing, so a listener that missed a change reads the workspace
 * again. A listener that throws never undoes the saved change.
 */
import { EventEmitter } from 'node:events';
import type { ChangeChannel, CommittedChange } from '../../contract/ports/notifications.js';
import { failure } from '@novakai/canvas-authoring';
import type { Result } from '@novakai/canvas-authoring';
/**
 * Makes an empty change channel. `publish` tells every listener about one saved change,
 * `subscribe` adds a listener, and `close` removes them all.
 * `publish` fails with `storage-unavailable` at `subscription` when a listener throws; the change
 * stays saved.
 */
export function createChangeChannel(): ChangeChannel {
  const emitter = new EventEmitter();
  return {
    publish: async (workspace, receipt) => publish(emitter, { workspace, receipt }),
    subscribe(listener): () => void {
      emitter.on('committed', listener);
      return () => {
        emitter.off('committed', listener);
      };
    },
    close: () => {
      emitter.removeAllListeners();
    },
  };
}
/** Listener failure never reverses a committed transaction; Authoring returns the receipt with delivery recovery semantics. */
function publish(
  emitter: EventEmitter,
  change: CommittedChange,
): Result<void> {
  try {
    emitter.emit('committed', change);
    return { ok: true, value: undefined };
  } catch {
    return failure(
      'storage-unavailable',
      'subscription',
      'A committed-change listener could not be notified',
    );
  }
}
