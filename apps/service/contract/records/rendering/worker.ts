/*
 * Why this file exists
 *
 * The service and its render worker threads talk by passing messages. A message crosses between
 * threads as plain data, so each side must check what arrives. For example, a reply must have
 * exactly the fields of a drawn document.
 *
 * This file holds the checks for every message: the worker's first "ready" message, a job, a reply,
 * and the drawn document inside a reply. They check only the outer fields; each capability checks
 * its own part. The web app checks drawn documents with `renderDocumentMessage` too.
 */
import { z } from 'zod';
import { failureSource } from '../transport/failure-source.js';
import { hostPath, renderJobId } from '../../brands.js';
import { errorCodes } from '../../errors.js';
/**
 * Checks a job as the worker receives it: the job ID, at most 2000 images, and the WebAssembly
 * file path (libavoid), at most 4096 characters. The other fields are checked by their
 * capabilities.
 */
export const renderJobMessage = z
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
/**
 * Checks the outer shape of a drawn document. Each field stays unchecked until it is compared with
 * the job's own collection and inputs.
 */
export const renderDocumentMessage = z
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
/** Checks a worker's mistake: a service code, with a capability's own detail kept in `source`. */
const diagnostic = z
  .strictObject({
    code: z.enum(errorCodes),
    path: z.string(),
    message: z.string(),
    recovery: z.string(),
    source: failureSource.optional(),
  })
  .readonly();
/** Checks a worker's reply: `{ ok: true, value }` (not yet checked) or `{ ok: false, error }`. */
export const workerReplyMessage = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: diagnostic }),
]);
/**
 * Checks the first message a worker sends: `{ ready: true }` once it can take jobs, or
 * `{ ready: false, error }` with the reason it could not start.
 */
export const workerHandshake = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(true) }),
  z.strictObject({ ready: z.literal(false), error: diagnostic }),
]);
/** A worker's first message that passed {@link workerHandshake}. */
export type WorkerHandshake = z.infer<typeof workerHandshake>;
/** The message a worker sends once it can take jobs. */
export const READY_HANDSHAKE: WorkerHandshake = Object.freeze({ ready: true });
