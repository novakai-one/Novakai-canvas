import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpMetadata } from '../../contract/records/http.js';
import { httpBodyLimit } from '../../contract/records/http.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { BodyStream, HttpIo, StaticFile } from '../../contract/records/server.js';
import type { WireOutcome } from '../../contract/records/protocol.js';
/** Ambiguous duplicated headers are rejected by returning a value that cannot pass exact admission. */
function header(
  request: IncomingMessage,
  name: string,
): string {
  const values = request.headersDistinct[name] ?? [];
  if (values.length > 1) return '<duplicate>';
  return values[0] ?? '';
}
/** Normalize headers only; credentials and origin are still untrusted until ingress admission. */
function metadata(request: IncomingMessage): HttpMetadata {
  return {
    method: request.method ?? '',
    host: header(request, 'host'),
    origin: header(request, 'origin'),
    site: header(request, 'sec-fetch-site'),
    mode: header(request, 'sec-fetch-mode'),
    destination: header(request, 'sec-fetch-dest'),
    authorization: header(request, 'authorization'),
    cookie: header(request, 'cookie'),
    contentType: header(request, 'content-type'),
  };
}
/** Bound streaming bytes before decoding UTF-8. The caller authenticates first and closes rejected requests. */
async function body(request: BodyStream): Promise<Result<string>> {
  try {
    const chunks = await consume(request);
    return {
      ok: true,
      value: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    };
  } catch {
    return failure('invalid-input', 'body', 'Request body was interrupted or not valid UTF-8');
  }
}
/** Private socket rejection is converted by body() into an invalid-input outcome; the caller corrects or resends its retained request. */
class BodyRejected extends Error {}
/** Validate a native chunk before it can consume the bounded buffer budget. */
function checkedChunk(input: unknown): Buffer {
  if (!Buffer.isBuffer(input)) throw new BodyRejected();
  return input;
}
/** Fail before allocating a concatenated body beyond the advertised limit. */
function checkedSize(
  previous: number,
  chunk: Buffer,
): number {
  const next = previous + chunk.byteLength;
  if (next > httpBodyLimit) throw new BodyRejected();
  return next;
}
/** Native buffering is confined to one request; no chunks or counters survive across calls. */
async function consume(request: BodyStream): Promise<readonly Buffer[]> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const input of request.iterator({ destroyOnReturn: false })) {
    const chunk = checkedChunk(input);
    size = checkedSize(size, chunk);
    chunks.push(chunk);
  }
  return chunks;
}
/** Stable owner codes determine status; clients never inspect message wording to choose recovery. */
function status(outcome: WireOutcome): number {
  if (outcome.ok) return 200;
  const codes: Readonly<Record<string, number>> = {
    unauthorized: 401,
    'permission-denied': 403,
    'not-found': 404,
    conflict: 409,
    'revision-conflict': 409,
    'request-reused': 409,
    unavailable: 503,
    'storage-unavailable': 503,
    cancelled: 409,
  };
  return codes[outcome.error.code] ?? 422;
}
/** All routes use no-store and browser isolation headers; SVG/image exports cannot become same-origin active documents. */
function headers(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}
/** Version and generation accompany every result, including failure; uncertain clients reconcile the original receipt. */
function json(
  response: ServerResponse,
  outcome: WireOutcome,
  generation: string,
): void {
  if (response.destroyed) return;
  headers(response);
  response.statusCode = status(outcome);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ version: 1, generation, outcome: wireValue(outcome) }));
}
/** Static content is already constrained to the built web root; bytes are sent without interpolation. */
function bytes(
  response: ServerResponse,
  file: StaticFile,
): void {
  headers(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', file.mediaType);
  if (file.filename !== undefined)
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  for (const [name, value] of Object.entries(file.headers ?? {})) response.setHeader(name, value);
  response.end(file.bytes);
}
/** Pure policy is supplied elsewhere; this binding owns native socket encoding and bounded body reads. */
export function createHttpIo(): HttpIo {
  return { metadata, body, json, bytes };
}

/** Void owner successes use an explicit JSON null so the versioned transport envelope remains valid. */
function wireValue(outcome: WireOutcome): WireOutcome {
  if (!outcome.ok) return outcome;
  return { ok: true, value: outcome.value ?? null };
}
