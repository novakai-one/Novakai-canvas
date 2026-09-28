/*
 * Why this file exists
 *
 * A request body arrives from the socket in chunks, and it may be too big, cut off, or not text.
 * For example, a 30 MiB upload must be stopped at 24 MiB, not read to the end.
 *
 * This file joins the chunks into the body text: at most `httpBodyLimit` bytes of valid UTF-8. It
 * stops reading once the body is too big, but leaves the socket open so the refusal can be sent.
 * It never parses the text; each route does that.
 *
 * The one mistake it can make is `invalid-input` at `body`, meaning the body was wrong.
 */
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * Reads the body's chunks into text. The text is not checked any further here; each route parses
 * it. Fails with `invalid-input` at `body` when a chunk isn't bytes, the body passes 24 MiB, the
 * upload is cut off, or the bytes aren't valid UTF-8.
 */
export async function readRequestBody(chunks: AsyncIterable<unknown>): Promise<Result<string>> {
  const bytes = await receiveBytes(chunks);
  if (!bytes.ok) {
    return bytes;
  }
  return decodeText(bytes.value);
}

/** Receives the body's bytes; an upload that is cut off (the stream throws) is refused. */
async function receiveBytes(chunks: AsyncIterable<unknown>): Promise<Result<Buffer>> {
  try {
    return await readWithinLimit(chunks);
  } catch {
    return unreadableBodyFailure();
  }
}

/**
 * Reads chunks while each one is bytes and the total stays within `httpBodyLimit`, then finishes:
 * all read, or stopped at the first chunk that doesn't fit.
 */
async function readWithinLimit(chunks: AsyncIterable<unknown>): Promise<Result<Buffer>> {
  const iterator = chunks[Symbol.asyncIterator]();
  const accepted: Buffer[] = [];
  let size = 0;
  let next = await iterator.next();
  while (!next.done && fitsLimit(next.value, size)) {
    accepted.push(next.value);
    size += next.value.byteLength;
    next = await iterator.next();
  }
  return finishReading(iterator, next, accepted);
}

/** Whether the chunk is bytes and `size` plus it stays within `httpBodyLimit`. */
function fitsLimit(
  chunk: unknown,
  size: number,
): chunk is Buffer {
  return Buffer.isBuffer(chunk) && size + chunk.byteLength <= httpBodyLimit;
}

/** Joins the accepted chunks when the stream ended; otherwise stops reading and refuses the body. */
async function finishReading(
  iterator: AsyncIterator<unknown>,
  last: IteratorResult<unknown>,
  accepted: readonly Buffer[],
): Promise<Result<Buffer>> {
  if (!last.done) {
    return stopReading(iterator);
  }
  const bytes = Buffer.concat(accepted);
  return success(bytes);
}

/** Closes the stream early, as leaving a `for await` loop does, and refuses the body. */
async function stopReading(iterator: AsyncIterator<unknown>): Promise<Result<Buffer>> {
  await iterator.return?.();
  return unreadableBodyFailure();
}

/** Decodes the bytes as strict UTF-8 text; bytes that aren't valid UTF-8 are refused. */
function decodeText(bytes: Buffer): Result<string> {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const text = decoder.decode(bytes);
    return success(text);
  } catch {
    return unreadableBodyFailure();
  }
}

/** Makes the one body mistake: too big, cut off, not bytes, or not valid UTF-8. */
function unreadableBodyFailure(): Result<never> {
  return failure('invalid-input', 'body', 'Request body was interrupted or not valid UTF-8');
}
