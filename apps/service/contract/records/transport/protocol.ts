/*
 * Why this file exists
 *
 * The browser and the CLI speak to the service in JSON over HTTP, and both sides must agree on the
 * shape. For example, a change is sent as `{ version: 1, generation, request, preview }`, and every
 * answer comes back as `{ version: 1, generation, outcome }`.
 *
 * This file holds that agreement: the checks for a change body (`mutationEnvelope`) and for every
 * answer (`responseEnvelope`), the list of API routes, and a call and its answer as the routes see
 * them. The failure codes are in wire-codes.ts.
 */
import { z } from 'zod';
import { generation } from '../../brands.js';
import type { Caller, HttpMetadata } from './http.js';
import type { Request } from '../capabilities.js';
import type { PrepareMode } from '../workspace/session.js';
import type { StaticFile } from './server.js';
import { wireFailure, type WireOutcome } from './wire-codes.js';
/**
 * Checks a change request's body: version 1, the server run it was made for (`generation`), the
 * Authoring request, whether to render preview images (`preview`, `false` when left out), and the
 * apply options (`{}` when left out). The `generation` stops a request made before a restart from
 * landing on the restarted workspace.
 */
export const mutationEnvelope = z.strictObject({
  version: z.literal(1),
  generation,
  request: z.unknown(),
  preview: z.boolean().default(false),
  options: z.unknown().default({}),
});
/**
 * A change request that admission accepted: the request, whether to render previews, the apply
 * options.
 */
export interface AdmittedMutation {
  readonly request: Request;
  readonly mode: PrepareMode;
  /** Untrusted apply options; Authoring parses them. */
  readonly options: unknown;
}

/**
 * Every API route the router answers, as `METHOD path`. The change stream (`GET /api/v1/events`)
 * is not here: it is answered before the router (core/transport/request-kind.ts).
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

/** A route's answer: JSON, or a file sent as it is. */
export type RouteOutcome =
  | { readonly kind: 'json'; readonly outcome: WireOutcome }
  | { readonly kind: 'bytes'; readonly file: StaticFile };

/** The query of an API call: every value sent for each key, in order. */
export type ApiQuery = Readonly<Record<string, readonly string[]>>;

/** One API call from a caller that admission has already let in. */
export interface ApiCall {
  /** The URL path, for example `/api/v1/render`. */
  readonly path: string;
  readonly query: ApiQuery;
  readonly caller: Caller;
  /** Aborts when the caller goes away. */
  readonly signal: AbortSignal;
  readonly metadata: HttpMetadata;
  /** The body text, as sent; the route checks it. */
  readonly body: string;
}
/**
 * Checks every service answer: version 1, the server run that answered (`generation`), and the
 * outcome, `{ ok: true, value }` or `{ ok: false, error }`. The value is checked later by whoever
 * reads it. A failure's code is from the closed list (wire-codes.ts); its evidence keeps each
 * capability's own codes.
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
/** A service answer that passed {@link responseEnvelope}. */
export type TransportResponse = z.infer<typeof responseEnvelope>;
