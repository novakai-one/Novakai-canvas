import { EventEmitter } from 'node:events';
import type { ChangeChannel, CommittedChange } from '../../contract/ports/notifications.js';
import { failure } from '@novakai/canvas-authoring';
import type { Result } from '@novakai/canvas-authoring';
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
/** The session owns listener lifetime; reconnect always rereads authoritative data rather than replaying this ephemeral channel. */
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
