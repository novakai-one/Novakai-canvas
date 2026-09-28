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
import { success } from '../../contract/errors.js';

/** The event name every saved change travels under. */
const COMMITTED = 'committed';

/** Hears about one saved change. */
type ChangeListener = (change: CommittedChange) => void;

/**
 * Makes an empty change channel. `publish` tells every listener about one saved change,
 * `subscribe` adds a listener, and `close` removes them all.
 * When a listener throws, `publish` fails with `storage-unavailable` at `subscription`: Authoring
 * has no code for a listener failure. The change stays saved.
 */
export function createChangeChannel(): ChangeChannel {
  const emitter = new EventEmitter();
  return {
    publish: async (workspace, receipt) => publishChange(emitter, { workspace, receipt }),
    subscribe: (listener) => addListener(emitter, listener),
    close: () => {
      emitter.removeAllListeners();
    },
  };
}

/**
 * Tells every listener about one saved change. A listener that throws gives the listener mistake,
 * but never undoes the change: Authoring still answers with its receipt.
 */
function publishChange(
  emitter: EventEmitter,
  change: CommittedChange,
): Result<void> {
  try {
    emitter.emit(COMMITTED, change);
    return success(undefined);
  } catch {
    return listenerFailure();
  }
}

/** Adds a listener, and gives back the function that removes it again. */
function addListener(
  emitter: EventEmitter,
  listener: ChangeListener,
): () => void {
  emitter.on(COMMITTED, listener);
  const unsubscribe = (): void => {
    emitter.off(COMMITTED, listener);
  };
  return unsubscribe;
}

/** Makes the mistake for a listener that threw; Authoring has no code of its own for it. */
function listenerFailure(): Result<never> {
  return failure(
    'storage-unavailable',
    'subscription',
    'A committed-change listener could not be notified',
  );
}
