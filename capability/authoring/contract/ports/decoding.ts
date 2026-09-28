/**
 * A checked shape: anything that can parse untrusted data into `T`.
 *
 * Core code depends on this small structural interface instead of on a parsing library, so a
 * zod schema, or any other parser with the same method, can be passed in.
 */
export interface CheckedShape<T> {
  /**
   * Parses untrusted data.
   *
   * Data that does not match must return `{ success: false }`; Authoring turns that into a failure
   * with its own code. A parser that throws is treated as an unexpected fault: the Authoring facade
   * reports it as `storage-unavailable`. Parsing must give the same answer every time for the same
   * data, because a successful parse of frozen data is cached and reused.
   *
   * @param value - The untrusted data to parse.
   * @returns `{ success: true, data }` with the parsed value, or `{ success: false }`.
   */
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}
