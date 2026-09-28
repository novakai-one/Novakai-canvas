/*
 * Why this file exists
 *
 * Some render problems are found by render:png itself, not by the parts it calls. Asking for
 * `--theme nope` finds no such theme, so the render stops with a `missing-theme` fault.
 *
 * This file lists those faults, and `provider-failed`: what a file, temp-folder or wasm step
 * becomes when it throws, with Node's details kept. It declares types only; `errors.ts` turns a
 * fault into a failed step.
 */
import type { ThemeChoice } from './render.js';
import type { AssetId, CollectionName, FilePath } from '../brands.js';

/** A render problem render:png found itself, named by its `code`. */
export type RenderFault =
  | {
      /** `--theme` or the `--theme-file`'s theme isn't one the render knows. */
      readonly code: 'missing-theme';
      readonly theme: ThemeChoice;
    }
  | {
      /** The name matched no recipe, and not exactly one shipped collection (`matches` of them). */
      readonly code: 'collection-selection';
      readonly id: CollectionName;
      readonly matches: number;
    }
  /** A theme was asked for, but the source isn't a collection. */
  | { readonly code: 'collection-required' }
  /** A theme was asked for, but the collection has no title. */
  | { readonly code: 'collection-title-required' }
  | {
      /** A font or image's pin isn't Model's `sha256:` form. */
      readonly code: 'invalid-asset-pin';
      readonly asset: AssetId;
      /** The digest text as the collection gives it. */
      readonly digest: string;
    }
  | {
      /** The source declares one font or image ID twice. */
      readonly code: 'duplicate-asset';
      readonly asset: AssetId;
    }
  | ProviderFault;

/**
 * A file, temp-folder or wasm step threw (Node calls this a native error), or a part threw when it
 * shouldn't have. Node's details are kept.
 */
export interface ProviderFault {
  readonly code: 'provider-failed';
  /** The error's message, for people to read. */
  readonly message: string;
  readonly detail: NativeDetail;
}

/** Node's details of a native error, when given: the path, OS code (`ENOENT`) and call (`open`). */
export interface NativeDetail {
  readonly path?: FilePath;
  readonly systemCode?: string;
  readonly syscall?: string;
}
