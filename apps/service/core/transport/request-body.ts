/*
 * The body of every API request, read before its route: at most `httpBodyLimit` bytes of strict
 * UTF-8. Pure over the injected chunk stream; the socket stays open when reading stops, so the
 * refusal can still be answered. A refused body is the caller's to correct or resend.
 */
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { andThen, failure, success, type Result } from '../../contract/errors.js';

/**
 * The chunks as UTF-8 text. Fails with `invalid-input` at `body` ("Request body was interrupted or
 * not valid UTF-8") when a chunk is not bytes, the total passes `httpBodyLimit` (reading stops
 * there), the stream fails (an interrupted upload) or the bytes are not valid UTF-8. The last two
 * are Node throws, caught where they happen (`receivedBytes`, `decodedText`).
 */
export async function requestBody(chunks: AsyncIterable<unknown>): Promise<Result<string>> {
  const bytes = await receivedBytes(chunks);
  return andThen(bytes, decodedText);
}

/**
 * The bounded bytes (see `boundedBytes`). Fails with `invalid-input` at `body` as `boundedBytes`
 * fails, or when the stream throws (an interrupted upload; caught here).
 */
async function receivedBytes(chunks: AsyncIterable<unknown>): Promise<Result<Buffer>> {
  try {
    return await boundedBytes(chunks);
  } catch {
    return bodyRefused();
  }
}

/**
 * Every chunk, joined, while each one is bytes and the total stays within the cap (see
 * `fitsLimit`). A chunk that does not fit stops reading at once (see `settledBytes`).
 */
async function boundedBytes(chunks: AsyncIterable<unknown>): Promise<Result<Buffer>> {
  const iterator = chunks[Symbol.asyncIterator]();
  const accepted: Buffer[] = [];
  let size = 0;
  let next = await iterator.next();
  while (!next.done && fitsLimit(next.value, size)) {
    accepted.push(next.value);
    size += next.value.byteLength;
    next = await iterator.next();
  }
  return settledBytes(iterator, next, accepted);
}

/** Whether the chunk is bytes and `size` plus it stays within `httpBodyLimit`. */
function fitsLimit(
  input: unknown,
  size: number,
): input is Buffer {
  return Buffer.isBuffer(input) && size + input.byteLength <= httpBodyLimit;
}

/**
 * The joined bytes when the stream ended. Otherwise a chunk did not fit: the iterator is closed,
 * as leaving a `for await` loop does, and the body is refused (`invalid-input` at `body`).
 */
async function settledBytes(
  iterator: AsyncIterator<unknown>,
  last: IteratorResult<unknown>,
  accepted: readonly Buffer[],
): Promise<Result<Buffer>> {
  if (last.done) return success(Buffer.concat(accepted));
  await iterator.return?.();
  return bodyRefused();
}

/**
 * The bytes as strict UTF-8 text. Fails with `invalid-input` at `body` when they are not valid
 * UTF-8 (the decoder's throw, caught here).
 */
function decodedText(bytes: Buffer): Result<string> {
  try {
    return success(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return bodyRefused();
  }
}

/** The one body refusal: `invalid-input` at `body`. */
function bodyRefused(): Result<never> {
  return failure('invalid-input', 'body', 'Request body was interrupted or not valid UTF-8');
}
