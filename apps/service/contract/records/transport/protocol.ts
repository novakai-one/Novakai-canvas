/*
 * The wire protocol: the mutation and response envelopes, an admitted mutation, the route outcome
 * and one authenticated API call. Declarations and the two envelope schemas; the router and
 * command decoder ports are in ports/transport.ts. A refused request is the caller's to correct
 * and resend; Authoring owns commit and receipt recovery.
 */
import type { OperationSource } from './failure-source.js';
import { operationSource } from './failure-source.js';
import { z } from 'zod';
import { generation } from '../../brands.js';
import type { Result } from '../../errors.js';
import type { Caller, HttpMetadata } from './http.js';
import type { Request } from '../capabilities.js';
import type { StaticFile } from './server.js';
/** A transport generation prevents a retained request from silently targeting a restarted/restored owner set. */
export const mutationEnvelope = z.strictObject({
  version: z.literal(1),
  generation,
  request: z.unknown(),
  preview: z.boolean().default(false),
  options: z.unknown().default({}),
});
export interface AdmittedMutation {
  readonly request: Request;
  readonly preview: boolean;
  readonly options: unknown;
}
/** Owner error codes remain stable in transport; consumers can retain richer owner-specific diagnostics. */
export type WireOutcome = Result<unknown, OperationSource>;
export type RouteOutcome = WireOutcome | { readonly kind: 'bytes'; readonly file: StaticFile };

export interface ApiCall {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly caller: Caller;
  readonly signal: AbortSignal;
  readonly metadata: HttpMetadata;
  readonly body: string;
}
/** HTTP consumers decode this envelope before handing success values to their respective capability readers. */
export const responseEnvelope = z.strictObject({
  version: z.literal(1),
  generation,
  outcome: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.strictObject({
      ok: z.literal(false),
      error: operationSource,
    }),
  ]),
});
export type TransportResponse = z.infer<typeof responseEnvelope>;
