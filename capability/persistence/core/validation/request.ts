import { fail } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import { commitRequest } from '../../contract/records/transaction.js';
import type { CommitRequest } from '../../contract/records/transaction.js';
import { keyText, hasDuplicates } from '../transaction/keys.js';
import { boundedClone, parse, success } from './outcomes.js';

/**
 * Copies and checks an untrusted commit request.
 *
 * Steps, in order:
 * 1. The input is copied as bounded JSON ({@link boundedClone}), so later changes by the caller
 *    have no effect.
 * 2. The copy is parsed against the commit request schema. A schema failure is `invalid-input`
 *    at the first issue's path.
 * 3. The request rules run. Any broken rule fails with `invalid-input`, path `expected` and the
 *    message `Duplicate identities or missing write precondition`.
 *
 * Authoring corrects a rejected request before submitting a new one.
 *
 * @param input - The request as received.
 * @returns The parsed request, or `invalid-input` from the schema (step 2) or the rules (step 3).
 * @throws TypeError or RangeError from {@link boundedClone} for a non-JSON or oversized input.
 * The public API calls this inside `protect`, which turns the throw into `invalid-input`.
 */
export function validateRequest(input: unknown): Result<CommitRequest> {
  const parsed = parse(commitRequest, boundedClone(input), 'invalid-input');
  if (!parsed.ok) {
    return parsed;
  }
  if (requestRules.some((violated) => violated(parsed.value))) {
    return fail('invalid-input', 'expected', 'Duplicate identities or missing write precondition');
  }
  return success(parsed.value);
}

/**
 * Rules a parsed request must not break; each returns `true` when broken. Checked in order, and
 * checking stops at the first broken rule.
 *
 * A request may list more observed versions than it has writes (the extra ones are read-only
 * dependencies), but every write needs exactly one observed version.
 */
const requestRules: readonly ((request: CommitRequest) => boolean)[] = [
  /** The same record is listed twice among the observed versions. */
  (request) => hasDuplicates(request.expected.map((read) => keyText(read.key))),
  /** The same record is written twice. */
  (request) => hasDuplicates(request.writes.map((write) => keyText(write.key))),
  /** A write has no observed version for its record. */
  (request) =>
    request.writes.some(
      (write) => !request.expected.some((read) => keyText(read.key) === keyText(write.key)),
    ),
  /** A put lists the same asset twice. */
  (request) =>
    request.writes.some((write) => write.kind === 'put' && hasDuplicates(write.resources)),
];
