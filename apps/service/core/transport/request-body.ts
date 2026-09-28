/*
 * Why this file exists
 *
 * A request body arrives from the socket in pieces, and it may be too big, cut off, or not text.
 * For example, a 30 MiB upload must be stopped at 24 MiB, not read to the end.
 *
 * This file reads the pieces into the body text: at most `httpBodyLimit` bytes of valid UTF-8. It
 * stops reading once the body is too big, but leaves the socket open so the refusal can be sent.
 * It never parses the text; each route does that.
 *
 * Each step answers a `Result` (see `contract/errors.ts`); the one mistake is made in
 * `bodyRefused`.
 */
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { andThen, failure, success, type Result } from '../../contract/errors.js';

/**
 * Reads the body pieces into text. The text is not checked any further here; each route parses it.
 * Fails with `invalid-input` at `body` when a piece isn't bytes, the body passes 24 MiB, the upload
 * is cut off, or the bytes aren't valid UTF-8.
 */
export async function readRequestBody(chunks: AsyncIterable<unknown>): Promise<Result<string>> {
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
