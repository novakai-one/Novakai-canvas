/*
 * The request ID an authoring command is sent under: its `--request` when given, else a fresh ID
 * from the injected source. Pure; randomness stays in the source compose binds. A failed mint is
 * returned unchanged and nothing is sent, so the caller reruns with `--request`.
 */
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { RequestOption } from '../../contract/records/command.js';
import type { RequestId } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';

/**
 * The command's `--request` when given, so a script can look up its receipt; else a fresh ID.
 * Fails with `cli-unavailable` when the fresh ID does not match Authoring's request ID grammar.
 */
export function requestIdFor(
  command: RequestOption,
  ids: RequestIds,
): Result<RequestId> {
  if (command.request !== undefined) return success(command.request);
  return ids.next();
}
