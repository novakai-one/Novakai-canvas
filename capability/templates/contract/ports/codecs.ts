import type { PresetId } from '../brands.js';
import type { Result } from '../errors.js';
import type { RecipePayload, ThemePayload, ThemePreset } from '../records/preset.js';

/**
 * The recipe codec the host supplies, backed by Language's public parser. Templates never edits
 * recipe source with regular expressions. `T` is the diagram intent type `expand` returns.
 */
export interface RecipePort<T> {
  /**
   * Checks complete recipe source (pinned `canvas1` syntax) and returns its canonical source plus
   * the exact asset and theme references it uses. No I/O.
   *
   * @param source - The recipe source text.
   * @param family - The diagram family the recipe declares.
   * @returns The canonical payload, or a typed failure.
   * @throws Must not throw. A throw becomes `provider-failed` at `$` (Templates' `protect`).
   */
  inspect(
    source: string,
    family: RecipePayload['family'],
  ): Result<RecipePayload>;
  /**
   * Remaps every alias and reference in the source into `namespace`. The same source and
   * namespace always give the same result.
   *
   * @param source - The canonical recipe source.
   * @param namespace - The namespace to remap into.
   * @returns Plain editable diagram intent as JSON data, or a typed failure.
   * @throws Must not throw. A throw becomes `provider-failed` at `$` (Templates' `protect`).
   */
  expand(
    source: string,
    namespace: PresetId,
  ): Result<T>;
}

/**
 * The theme codec the host supplies, backed by Design System. It owns token IDs, bounds and
 * contrast. Templates parses the returned payload's shape and checks its font manifest,
 * duplicate roles and base pin.
 */
export interface ThemePort {
  /**
   * Resolves theme input (possibly a change on top of a base) into complete token values. Every
   * font name becomes an admitted font digest. Must do no I/O and return the same payload for the
   * same input.
   *
   * @param raw - The theme input as the caller gave it.
   * @param availableThemes - The themes already in the catalog, usable as bases.
   * @returns The complete theme payload, or a typed failure.
   * @throws Must not throw. A throw becomes `provider-failed` at `$` (Templates' `protect`).
   */
  resolve(
    raw: unknown,
    availableThemes: readonly ThemePreset[],
  ): Result<ThemePayload>;
}
