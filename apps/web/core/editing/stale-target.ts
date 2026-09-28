/*
 * The `stale-target` refusal: the Canvas named a diagram, group or node that the open collection
 * no longer has. Every lookup of Canvas text in the collection builds this refusal here, so its
 * wording lives in one place. Pure; the caller decides how the refusal is shown.
 */
import type { TargetId } from '../../contract/brands.js';
import { diagnostic, type Diagnostic } from '../../contract/errors.js';

/** What the person can do next: keep an edit's draft, or drop the palette item again. */
export type StaleRecovery = 'keep-draft' | 'drop-again';

/** `stale-target` for the Canvas's `target` text, with the recovery the caller's case allows. */
export function staleTarget(
  target: TargetId,
  recovery: StaleRecovery,
): Diagnostic {
  const message = `This diagram target is no longer available: ${target}`;
  return diagnostic('stale-target', message, recoveries[recovery]);
}

/** The recovery text for each case. */
const recoveries: Readonly<Record<StaleRecovery, string>> = Object.freeze({
  'keep-draft': 'Keep the draft and compare it with the current collection.',
  'drop-again': 'Nothing was changed. Drop it again on the current diagram.',
});
