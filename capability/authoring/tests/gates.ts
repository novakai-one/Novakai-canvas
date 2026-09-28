import { vi } from 'vitest';
import {
  createAuthoring,
  type Result,
  type Receipt,
  type Request,
  type FeasibilityReport,
} from '../contract/index.js';
import type { Dependencies } from '../contract/index.js';

/** A promise the test opens by hand, to hold code at an exact point without sleeps or polling. */
export interface Gate {
  /** Settles when `open` is called. */
  readonly promise: Promise<void>;
  /** Lets everything waiting on `promise` continue. Calling it again does nothing. */
  open(): void;
}

/**
 * Creates a closed gate.
 *
 * @returns A gate whose promise settles when `open` is called.
 */
export function gate(): Gate {
  // The Promise constructor runs its callback immediately, so `resolve` is replaced before
  // `gate` returns. The starting value only gives the variable a function type.
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, open: () => resolve() };
}

/**
 * Applies two requests at the same time and lets real SQLite pick one atomic winner.
 *
 * Both requests are held at the feasibility check, after each has read its snapshot. Once both
 * have arrived they are released together, so they race to commit from the same snapshot.
 *
 * @param deps - The collaborators to build Authoring with. Feasibility is replaced by the gate.
 * @param first - The first request.
 * @param second - The second request.
 * @returns Both apply results, in the order the requests were given.
 */
export async function race(
  deps: Dependencies,
  first: Request,
  second: Request,
): Promise<readonly Result<Receipt>[]> {
  const bothArrived = gate();
  const release = gate();
  const check = vi.fn(async (): Promise<Result<FeasibilityReport>> => {
    if (check.mock.calls.length === 2) bothArrived.open();
    await release.promise;
    return { ok: true, value: { warnings: [], diff: [], preview: null } };
  });
  const api = createAuthoring({ ...deps, feasibility: { check } });

  const pending = [api.apply(first), api.apply(second)];
  await bothArrived.promise;
  release.open();
  return Promise.all(pending);
}
