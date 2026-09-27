/*
 * render:png's failure contract: the faults the render finds itself, the evidence a failure can
 * carry, the `render-failed` record printed as JSON, faulted, which returns a fault as a failed
 * Result, and nativeFault, which turns a thrown native error into `provider-failed` evidence. Pure.
 * The render adapters catch their own native throws and call nativeFault; the caller corrects the
 * named input or resource and runs render:png again.
 */
import type { CliFailure, Result } from '../errors.js';
import type { Collection, FailureSource } from './foreign.js';
import type { ThemeChoice } from './render.js';
import { filePath, type CollectionName, type FilePath } from '../brands.js';

/** A native error's failing path, raw OS code (e.g. `ENOENT`) and syscall (e.g. `open`), when given. */
export interface NativeDetail {
  readonly path?: FilePath;
  readonly systemCode?: string;
  readonly syscall?: string;
}

/**
 * A render failure the CLI found itself. Consumers branch on the code, never the message.
 * - `missing-theme`: the theme override has no admitted pin.
 * - `collection-selection`: a collection name matched no recipe and not exactly one shipped
 *   collection; `matches` counts the shipped matches.
 * - `collection-required`: a theme override was asked for a source that is not a collection.
 * - `collection-title-required`: a theme override was asked for a collection without a title.
 * - `invalid-asset-pin`: a collection asset's digest is not Model's `sha256:` pin. Model
 *   validation refuses such a collection first, so no unchecked digest reaches Assets.
 * - `provider-failed`: a filesystem, temp-directory or wasm step threw; the native evidence is kept.
 */
export type RenderFault =
  | {
      readonly code: 'missing-theme';
      readonly theme: ThemeChoice;
    }
  | {
      readonly code: 'collection-selection';
      readonly id: CollectionName;
      readonly matches: number;
    }
  | { readonly code: 'collection-required' }
  | { readonly code: 'collection-title-required' }
  | {
      readonly code: 'invalid-asset-pin';
      readonly asset: Collection['assets'][number]['id'];
      /** The digest text as the collection gives it. */
      readonly digest: string;
    }
  | {
      readonly code: 'provider-failed';
      /** The native error's message. Human context only. */
      readonly message: string;
      readonly detail: NativeDetail;
    };

/** The one fault a native filesystem, temp-directory or wasm step fails with. */
export type ProviderFault = Extract<RenderFault, { readonly code: 'provider-failed' }>;

/**
 * What a failed render carries: the CLI's own fault, a CLI failure (theme grammar, resource
 * reads), or Language, Model, Assets, Templates, service or Export evidence kept whole.
 */
export type RenderEvidence = RenderFault | CliFailure | FailureSource;

/** The failure render:png prints. Stored collections are never changed by a render. */
export interface RenderFailure {
  readonly code: 'render-failed';
  readonly message: string;
  readonly recovery: string;
  readonly source: RenderEvidence;
}

/** `fault` as a failed Result; nothing else is returned with it. */
export function faulted(fault: RenderFault): Result<never, RenderFault> {
  return { ok: false, error: fault };
}

/**
 * A thrown native error as `provider-failed` evidence: its message, path, OS code and syscall.
 * Only data fields are read, never methods; absent evidence stays absent.
 */
export function nativeFault(error: unknown): ProviderFault {
  return {
    code: 'provider-failed',
    message: nativeMessage(error),
    detail: nativeDetail(error),
  };
}

/** The error's message as human context; no machine-readable field is invented. */
function nativeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The error's path, OS code and syscall, present ones only. When any present field is malformed
 * (not text, or an empty path) none is kept, so checked and unchecked evidence never mix.
 */
function nativeDetail(error: unknown): NativeDetail {
  const present = Object.fromEntries(
    Object.entries(nativeFields(error)).filter((field) => field[1] !== undefined),
  );
  if (!isNativeDetail(present)) return {};
  return present;
}

/** The three data fields of an object error under their detail names, unchecked; none otherwise. */
function nativeFields(error: unknown): { readonly [K in keyof NativeDetail]?: unknown } {
  if (typeof error !== 'object' || error === null) return {};
  return {
    path: Reflect.get(error, 'path'),
    systemCode: Reflect.get(error, 'code'),
    syscall: Reflect.get(error, 'syscall'),
  };
}

/** Whether every present field has its type: a non-empty path, a text code and a text syscall. */
function isNativeDetail(fields: object): fields is NativeDetail {
  return (
    isOptionalPath(Reflect.get(fields, 'path')) &&
    isOptionalText(Reflect.get(fields, 'systemCode')) &&
    isOptionalText(Reflect.get(fields, 'syscall'))
  );
}

/** Whether `value` is absent or a non-empty path. */
function isOptionalPath(value: unknown): value is FilePath | undefined {
  return value === undefined || filePath.safeParse(value).success;
}

/** Whether `value` is absent or text. */
function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
