/*
 * WOFF2 font decompression through `wawoff2`. The library returns a view into native memory
 * that its next call reuses, so calls are run one at a time and each result is copied before
 * the next call starts.
 */
import { decompress } from 'wawoff2';

/**
 * The most recent decompression, settled either way. Each new call waits for it. Shared by
 * every Export composition in the process, because the library's memory is shared too.
 */
let pending: Promise<void> = Promise.resolve();

/**
 * Decompresses a WOFF2 font into sfnt (TrueType/OpenType) bytes. Calls run one after another
 * in call order, across all Export compositions; one call's failure does not affect the next.
 * A call that never settles blocks every later call; there is no timeout (the library waits for
 * its WebAssembly runtime to load).
 *
 * @param bytes - WOFF2 font bytes.
 * @returns A promise of a detached copy of the decompressed bytes. It rejects with the
 * library's plain `Error` ("ConvertWOFF2ToTTF failed") when the bytes cannot be converted.
 * Export's font decoder turns a rejection into `encoding-failed` at `fonts`.
 * @throws Never synchronously; failures are rejections.
 */
export function decompressFont(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = pending.then(
    /** Decompresses the font once the previous call has settled, as a detached copy. */ async () =>
      Uint8Array.from(await decompress(bytes)),
  );
  pending = decoded.then(
    /** Lets the next call start after a success. */ () => undefined,
    /** Lets the next call start after a failure too. */ () => undefined,
  );
  return decoded;
}
