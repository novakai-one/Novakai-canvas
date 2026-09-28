/*
 * The `provider-failed` fault: what a native throw becomes (a filesystem, temp-directory or wasm
 * step, or an owner that threw unexpectedly), with the native evidence kept. Data only;
 * `nativeFault` in errors.ts builds it. The caller corrects the named input or resource and runs
 * render:png again.
 */
import type { FilePath } from '../brands.js';

/** A native error's failing path, raw OS code (e.g. `ENOENT`) and syscall (e.g. `open`), when given. */
export interface NativeDetail {
  readonly path?: FilePath;
  readonly systemCode?: string;
  readonly syscall?: string;
}

/** The one fault a native filesystem, temp-directory or wasm step fails with. */
export interface ProviderFault {
  readonly code: 'provider-failed';
  /** The native error's message. Human context only. */
  readonly message: string;
  readonly detail: NativeDetail;
}
