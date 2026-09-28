/*
 * Why this file exists
 *
 * The commands behind `/api/v1/resources/…` take JSON bodies from the browser or the CLI. For
 * example, `POST /api/v1/resources/instantiate` with `{ pin, namespace: 'my-diagram' }` turns a
 * stored recipe into DSL for a new collection called `my-diagram`.
 *
 * This file holds the checks for those bodies (prepare, restore, instantiate), and the mistake a
 * resource command answers with. Field names are the ones sent over HTTP, so they stay as they
 * are. Declarations only; the commands are in ports/workspace.ts.
 */
import { z } from 'zod';
import type { FailureSource } from '../transport/failure-source.js';
import type { Result } from '../../errors.js';
import type { AuthoringErrorCode, TemplatesErrorCode } from '../capability-types.js';

/** Checks a prepare request: the preset to save, and the uploaded files it may use. */
export const preparationInput = z.strictObject({
  /** The preset to save, as sent (a theme or a recipe). Templates checks it. */
  admission: z.json(),
  /** Each uploaded file the preset may use, as a name and a digest. None when left out. */
  assets: z.array(z.strictObject({ alias: z.string(), digest: z.string() })).default([]),
});
/** A prepare request that passed {@link preparationInput}. */
export type PreparationInput = z.infer<typeof preparationInput>;

/** Checks a restore request: the file's digest and its bytes as base64 text. */
export const restoreInput = z.strictObject({ digest: z.string(), base64: z.string() });
/** A restore request that passed {@link restoreInput}. */
export type RestoreInput = z.infer<typeof restoreInput>;

/** Checks an instantiate request: which stored recipe, and the ID of the new collection. */
export const instantiateInput = z.strictObject({
  /** The recipe's exact version, as sent; Templates checks it. */
  pin: z.unknown(),
  /** The ID of the new collection, as sent. */
  namespace: z.string(),
});
/** An instantiate request that passed {@link instantiateInput}. */
export type InstantiateInput = z.infer<typeof instantiateInput>;

/**
 * The codes a resource command can refuse with: Authoring's (selection, theme saving, and the
 * service's own input checks) and Templates' (the catalog, saving presets and reading recipes).
 */
export type ResourceErrorCode = AuthoringErrorCode | TemplatesErrorCode;

/**
 * The mistake a resource command found. Like `Diagnostic` (errors.ts), but the code can be
 * Authoring's or Templates'.
 */
export interface ResourceDiagnostic {
  readonly code: ResourceErrorCode;
  /** Where the mistake is, for example `resources` or `preset.kind`. */
  readonly path: string;
  /** A sentence for people. Code never branches on it. */
  readonly message: string;
  /** What the caller should do next. */
  readonly recovery: string;
  /** The capability's own failure, kept as evidence. */
  readonly source?: FailureSource | undefined;
}

/** What a resource command answers: its value, or a `ResourceDiagnostic`. */
export type ResourceResult<T> = Result<T, ResourceDiagnostic>;
