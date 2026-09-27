import type { OperationSource } from './failure-source.js';
import { operationSource } from './failure-source.js';
import { transportGeneration } from '../brands.js';
import { z } from 'zod';
import type { Result } from '../errors.js';
import type { Caller, HttpAdmission, HttpMetadata } from './http.js';
import type { Request } from './owners.js';
/** A transport generation prevents a retained request from silently targeting a restarted/restored owner set. */
export const mutationEnvelope = z.strictObject({
  version: z.literal(1),
  generation: transportGeneration,
  request: z.unknown(),
  preview: z.boolean().default(false),
  options: z.unknown().default({}),
});
export interface AdmittedMutation {
  readonly request: Request;
  readonly preview: boolean;
  readonly options: unknown;
}
export interface CommandAdmission {
  readonly caller: Caller;
  readonly metadata: HttpMetadata;
  readonly generation: string;
  readonly ingress: Pick<HttpAdmission, 'mutation'>;
}
/** A file answer (static web asset or export artifact): its bytes plus response metadata. */
export interface StaticFile {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename?: string;
  readonly headers?: Readonly<Record<string, string>>;
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
export interface ApiRouter {
  invoke(call: ApiCall): Promise<RouteOutcome>;
}
export interface CommandDecoder {
  read(
    body: string,
    context: CommandAdmission,
  ): Result<AdmittedMutation>;
}
/** HTTP consumers decode this envelope before handing success values to their respective capability readers. */
export const responseEnvelope = z.strictObject({
  version: z.literal(1),
  generation: transportGeneration,
  outcome: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.strictObject({
      ok: z.literal(false),
      error: operationSource,
    }),
  ]),
});
export type TransportResponse = z.infer<typeof responseEnvelope>;
