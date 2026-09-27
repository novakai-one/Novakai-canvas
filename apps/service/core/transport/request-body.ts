/*
 * The body of every API request, read before its route: at most `httpBodyLimit` bytes of strict
 * UTF-8. Pure over the injected chunk stream; the socket stays open when reading stops, so the
 * refusal can still be answered. A refused body is the caller's to correct or resend.
 */
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * The chunks as UTF-8 text. Fails with `invalid-input` at `body` when a chunk is not bytes, the
 * total passes `httpBodyLimit` (reading stops there), the stream fails (an interrupted upload) or
 * the bytes are not valid UTF-8.
 */
export async function requestBody(chunks: AsyncIterable<unknown>): Promise<Result<string>> {
  try {
    const bytes = Buffer.concat(await boundedChunks(chunks));
    return success(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return failure('invalid-input', 'body', 'Request body was interrupted or not valid UTF-8');
  }
}

/** A chunk that is not bytes, or one that passes the limit; `requestBody` turns it into its failure. */
class BodyRejected extends Error {}

/** Every chunk, throwing `BodyRejected` before the total passes the limit. */
async function boundedChunks(chunks: AsyncIterable<unknown>): Promise<readonly Buffer[]> {
  const accepted: Buffer[] = [];
  let size = 0;
  for await (const input of chunks) {
    const chunk = acceptedChunk(input, size);
    size += chunk.byteLength;
    accepted.push(chunk);
  }
  return accepted;
}

/** The chunk as bytes; throws `BodyRejected` when it is not bytes or `size` plus it passes the cap. */
function acceptedChunk(
  input: unknown,
  size: number,
): Buffer {
  if (!Buffer.isBuffer(input) || size + input.byteLength > httpBodyLimit) throw new BodyRejected();
  return input;
}
