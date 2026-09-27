/*
 * The wire protocol: the mutation and response envelopes, an admitted mutation, every API route
 * key, a route's answer, the query and one authenticated API call. Declarations, the route key
 * list and the two envelope schemas; the wire codes and JSON outcome are in wire-codes.ts, the
 * router and command decoder ports in ports/transport.ts. A refused request is the caller's to
 * correct and resend; Authoring owns commit and receipt recovery.
 */
import { z } from 'zod';
import { generation } from '../../brands.js';
import type { Caller, HttpMetadata } from './http.js';
import type { Request } from '../capabilities.js';
import type { PrepareMode } from '../workspace/session.js';
import type { StaticFile } from './server.js';
import { wireFailure, type WireOutcome } from './wire-codes.js';
/** A transport generation prevents a retained request from silently targeting a restarted/restored owner set. */
export const mutationEnvelope = z.strictObject({
  version: z.literal(1),
  generation,
  request: z.unknown(),
  preview: z.boolean().default(false),
  options: z.unknown().default({}),
});
/** A mutation envelope the ingress admitted: the request, how to prepare it, the apply options. */
export interface AdmittedMutation {
  readonly request: Request;
  readonly mode: PrepareMode;
  /** Untrusted apply options; Authoring parses them. */
  readonly options: unknown;
}

/**
 * Every API route the router answers, as `METHOD path`. The change stream (`GET /api/v1/events`)
 * is answered before the router (core/transport/request-kind.ts).
 */
export const routeKeys = Object.freeze([
  'GET /api/v1/workspace',
  'GET /api/v1/history',
  'GET /api/v1/installation',
  'GET /api/v1/identity',
  'GET /api/v1/render',
  'GET /api/v1/inspect',
  'GET /api/v1/receipt',
  'POST /api/v1/export',
  'GET /api/v1/language',
  'GET /api/v1/source',
  'POST /api/v1/authoring/preview',
  'POST /api/v1/authoring/apply',
  'POST /api/v1/resources/stage',
  'POST /api/v1/resources/restore',
  'POST /api/v1/resources/blob',
  'POST /api/v1/resources/freeze',
  'POST /api/v1/resources/prepare',
  'POST /api/v1/resources/instantiate',
] as const);
/** One API route; see {@link routeKeys}. */
export type RouteKey = (typeof routeKeys)[number];

/** A route's answer: a JSON outcome, or a file sent as bytes. */
export type RouteOutcome =
  | { readonly kind: 'json'; readonly outcome: WireOutcome }
  | { readonly kind: 'bytes'; readonly file: StaticFile };

/** The query of an API call: every value given for each key, in order. */
export type ApiQuery = Readonly<Record<string, readonly string[]>>;

/** One authenticated API call: its path, query, caller, cancellation, head and body text. */
export interface ApiCall {
  readonly path: string;
  readonly query: ApiQuery;
  readonly caller: Caller;
  readonly signal: AbortSignal;
  readonly metadata: HttpMetadata;
  readonly body: string;
}
/**
 * HTTP consumers decode this envelope before handing success values to their respective capability
 * readers. A failure's top-level code is a closed wire code; its nested evidence keeps owner codes.
 */
export const responseEnvelope = z.strictObject({
  version: z.literal(1),
  generation,
  outcome: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.strictObject({
      ok: z.literal(false),
      error: wireFailure,
    }),
  ]),
});
export type TransportResponse = z.infer<typeof responseEnvelope>;
