/*
 * Why this file exists
 *
 * Every change is sent under a request ID, so its receipt can be looked up later. When the agent
 * types `create my-diagram.canvas` without `--request`, the CLI makes a fresh ID. A fresh ID is
 * random, and core stays free of randomness so it always gives the same answer.
 *
 * This file names where fresh IDs come from, so the setup code (`contract/compose/`) can plug in
 * a random source.
 */
import type { RequestId } from '../brands.js';
import type { Result } from '../errors.js';

/** Makes fresh request IDs. */
export interface RequestIds {
  /**
   * Makes a fresh request ID that Authoring accepts. Fails with `cli-unavailable` if one doesn't
   * pass Authoring's check. Nothing was sent then; the agent can pass `--request` instead.
   */
  next(): Result<RequestId>;
}
