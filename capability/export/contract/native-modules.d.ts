/**
 * Type declarations for the `wawoff2` package, which ships none. Export uses only its
 * asynchronous WOFF2 decompressor.
 */
declare module 'wawoff2' {
  /**
   * Decompresses a WOFF2 font into sfnt (TrueType/OpenType) bytes.
   *
   * @param bytes - WOFF2 font bytes.
   * @returns The decompressed font bytes, as a view into memory the library reuses; copy them
   * before the next call (`decompressFont` does). The promise rejects with a plain `Error`
   * ("ConvertWOFF2ToTTF failed") when the bytes cannot be converted; Export's font decoder
   * turns that into `encoding-failed`.
   */
  export function decompress(bytes: Uint8Array): Promise<Uint8Array>;
}
