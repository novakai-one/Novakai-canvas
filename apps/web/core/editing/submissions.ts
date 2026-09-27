import type { Submission } from '../../contract/records/submission.js';
import type { Request } from '../../contract/records/owners.js';

/** One in-flight request per collection prevents overlapping browser edits; different collections remain independent. */
export function blocksSubmission(
  pending: readonly Submission[],
  request: Request,
): boolean {
  return pending
    .filter((item) => item.state !== 'rejected')
    .some((item) => sameCollection(item.request, request));
}
/** Non-collection operations conflict only with an identical key in their declared write scopes. */
function sameCollection(
  left: Request,
  right: Request,
): boolean {
  if (left.workspace !== right.workspace) return false;
  return left.scope.some((key) =>
    right.scope.some((other) => key.kind === other.kind && key.id === other.id),
  );
}
/** Replace a status by immutable identity; this never changes request contents or captured versions. */
export function submissionStatus(
  pending: readonly Submission[],
  id: string,
  state: Submission['state'],
): readonly Submission[] {
  return pending.map((item) => (item.request.request === id ? { ...item, state } : item));
}

/** When each retained request first appeared and when it was refused, on one increasing counter. */
export interface RefusalOrder {
  readonly tick: number;
  readonly started: ReadonlyMap<string, number>;
  readonly refused: ReadonlyMap<string, number>;
}
export const emptyRefusalOrder: RefusalOrder = { tick: 0, started: new Map(), refused: new Map() };
/** Stamp new requests and new refusals; requests that left the journal are forgotten. */
export function observeRefusals(
  order: RefusalOrder,
  pending: readonly Submission[],
): RefusalOrder {
  let tick = order.tick;
  const stamp = (known: number | undefined): number => known ?? ++tick;
  const started = new Map(
    pending.map((item) => [item.request.request, stamp(order.started.get(item.request.request))]),
  );
  const refused = new Map(
    pending
      .filter((item) => item.state === 'rejected')
      .map((item) => [item.request.request, stamp(order.refused.get(item.request.request))]),
  );
  return { tick, started, refused };
}
/** Only the most recent refusal is shown, and only until another request starts after it. */
export function supersededRefusal(order: RefusalOrder): string | undefined {
  const newest = Math.max(0, ...order.refused.values());
  const latestStart = Math.max(0, ...order.started.values());
  return [...order.refused].find(([, at]) => at < newest || latestStart > at)?.[0];
}
