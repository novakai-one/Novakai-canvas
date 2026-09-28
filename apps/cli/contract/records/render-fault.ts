/*
 * Why this file exists
 *
 * Some render problems are found by render:png itself, not by the parts it calls. Asking for
 * `--theme nope` finds no such theme, so the render stops with a `missing-theme` fault.
 *
 * This file lists those faults, and `provider-failed`. A provider is code that reaches outside the
 * CLI: reading files, the temp folder, and the layout and PNG engines (loaded as WebAssembly). When
 * one throws, it becomes `provider-failed`, with Node's details kept. It declares types only.
 */
import type { ThemeChoice } from './render.js';
import type { AssetId, RecipeOrCollectionId, FilePath } from '../brands.js';

/** A render problem render:png found itself, named by its `code`. */
export type RenderFault =
  | {
      /** `--theme` or the `--theme-file`'s theme isn't one the render knows. */
      readonly code: 'missing-theme';
      readonly theme: ThemeChoice;
    }
  | {
      /** The name matched no recipe, and no shipped collection or more than one (`matches`). */
      readonly code: 'collection-selection';
      readonly id: RecipeOrCollectionId;
      readonly matches: number;
    }
  /** A theme was asked for, but the source is a patch (`patch 1`), not a whole collection. */
  | { readonly code: 'collection-required' }
  /** A theme was asked for, but the collection has no title to write the theme after. */
  | { readonly code: 'collection-title-required' }
  | {
      /** A font or image's pin (its `sha256:` digest in the collection) isn't well formed. */
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
 * A provider threw: reading a file, the temp folder, or a WebAssembly engine. Also used when a
 * part throws when it shouldn't. Node's details are kept.
 */
export interface ProviderFault {
  readonly code: 'provider-failed';
  /** The error's message, for people to read. */
  readonly message: string;
  readonly detail: NativeDetail;
}

/** Node's details of a thrown error, when given: the path, OS code (`ENOENT`) and call (`open`). */
export interface NativeDetail {
  readonly path?: FilePath;
  readonly systemCode?: string;
  readonly syscall?: string;
}
