/*
 * Theme-pin freezing: a retained DSL request gets each theme alias replaced by the exact pin the
 * selector chose, so a later apply uses the same theme version. Pure over the selector; a refusal
 * throws PreparationFault or zod's error (`guarded` in refusal.ts turns both into a
 * ResourceResult), and Authoring owns the canonical write and receipt.
 */
import type { Request, Snapshot } from '../../../contract/records/capabilities.js';
import type { ResourceSelector } from '../../../contract/records/planning/planning.js';
import { dslCommand } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { accepted } from './refusal.js';

/** The owner freezing selects through. */
export interface FreezeOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
}

/**
 * Retained DSL requests carry checked alias-to-exact-pin selections, including patch theme
 * changes; any other request is returned unchanged. Throws zod's error for a malformed request or
 * DSL payload, and PreparationFault with the selector's diagnostic when selection refuses.
 */
export function freeze(
  raw: unknown,
  snapshot: Snapshot,
  owners: FreezeOwners,
): Request {
  const request = requestSchema.parse(raw);
  if (request.intent.kind !== 'change') return request;
  if (request.intent.planner !== 'dsl') return request;
  const command = dslCommand.parse(request.intent.payload);
  const selected = accepted(owners.selector.select(request, snapshot));
  const themePins = Object.fromEntries(
    Object.entries(selected.resources.themes).map(([alias, pin]) => [
      alias,
      `${pin.id}@${pin.version}#${pin.digest}`,
    ]),
  );
  return requestSchema.parse({
    ...request,
    intent: { ...request.intent, payload: { ...command, themePins } },
  });
}
