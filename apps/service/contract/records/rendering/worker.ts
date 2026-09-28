/*
 * The render worker's wire: the start-up handshake the worker posts first, the job envelope the
 * worker decodes, the render envelope a reply's value is checked against, and the result envelope
 * that carries it. Declarations only; the worker adapters decode with all four, and apps/web
 * parses `renderEnvelope` through the public index. Each capability checks its own payload. A
 * refused reply keeps the caller's last accepted scene. Web's bundle also carries the worker-only
 * `workerHandshake`, `resultEnvelope` and `diagnostic`.
 */
import { z } from 'zod';
import { failureSource } from '../transport/failure-source.js';
import { hostPath, renderJobId } from '../../brands.js';
import { errorCodes } from '../../errors.js';
/** Transport validates only host-owned fields; capability payloads are checked by the corresponding public owners. */
export const renderingEnvelope = z
  .strictObject({
    id: renderJobId,
    collection: z.unknown(),
    fonts: z.unknown(),
    style: z.unknown(),
    assets: z.array(z.unknown()).max(2000),
    options: z.unknown(),
    wasmResource: z.string().max(4096).pipe(hostPath),
  })
  .readonly();
/** Responses remain unknown until checked against the request's admitted collection and measurement sources. */
export const renderEnvelope = z
  .strictObject({
    collection: z.unknown(),
    projection: z.unknown(),
    measurements: z.unknown(),
    options: z.unknown(),
    scene: z.unknown(),
    fonts: z.unknown(),
    style: z.unknown(),
  })
  .readonly();
/** A worker failure carries a service code; owner-specific detail stays in `source`. */
const diagnostic = z
  .strictObject({
    code: z.enum(errorCodes),
    path: z.string(),
    message: z.string(),
    recovery: z.string(),
    source: failureSource.optional(),
  })
  .readonly();
/** An unknown success payload acquires its domain type only after owner decoding. */
export const resultEnvelope = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: diagnostic }),
]);
/**
 * The first message a worker realm posts: `{ ready: true }` once it can take jobs, or
 * `{ ready: false, error }` with the reason it could not start.
 */
export const workerHandshake = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(true) }),
  z.strictObject({ ready: z.literal(false), error: diagnostic }),
]);
/** A worker realm's start-up handshake; see {@link workerHandshake}. */
export type WorkerHandshake = z.infer<typeof workerHandshake>;
/** The handshake a worker realm posts once it can take jobs. */
export const READY_HANDSHAKE: WorkerHandshake = Object.freeze({ ready: true });
