/*
 * Why this file exists
 *
 * Every change is sent under a request ID, so its receipt can be looked up later. A script can
 * choose the ID itself, as in `create plan.canvas --request req-1`, so it knows what to ask for.
 * Otherwise the CLI makes a fresh one.
 *
 * This file picks between the two. A fresh ID comes from the tool it is handed, so this file never
 * uses randomness itself.
 */
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { RequestOption } from '../../contract/records/command.js';
import type { RequestId } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';

/**
 * Chooses the ID a change is sent under: the typed `--request`, or else a fresh one.
 * The mistake it can find: a fresh ID that Authoring wouldn't accept (`cli-unavailable`). Nothing
 * is sent then; the agent can pass `--request` instead.
 */
export function chooseRequestId(
  command: RequestOption,
  freshIds: RequestIds,
): Result<RequestId> {
  if (command.request !== undefined) return success(command.request);
  return freshIds.next();
}
