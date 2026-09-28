import type { Result } from './errors.js';
import type { PresetId, Digest } from './brands.js';
import type { Catalog, Pin, Preset } from './records/preset.js';
import type { RecipePort, ThemePort } from './ports/codecs.js';
import type { IdentityPort } from './ports/identity.js';

/**
 * The providers Templates needs. The host supplies the recipe and theme codecs; `identity` hashes
 * content. `T` is the diagram intent type a recipe expands into.
 */
export interface Dependencies<T> {
  /** Checks recipe source and expands it into intent (owned by Language). */
  readonly recipe: RecipePort<T>;
  /** Resolves theme token input into complete values (owned by Design System). */
  readonly theme: ThemePort;
  /** Hashes canonical content into a digest. */
  readonly identity: IdentityPort;
}

/**
 * The result of planning one admission. Templates never saves it; Authoring commits
 * `candidate` if it chooses to.
 */
export interface PresetPlan {
  /** The whole catalog after admission: unchanged when `changed` is false. */
  readonly candidate: Catalog;
  /** The pin of the admitted (or already present) version. */
  readonly pin: Pin;
  /** False when the same version with the same content already existed. */
  readonly changed: boolean;
}

/** One catalog entry as `list` returns it: its pin and readable metadata, without the payload. */
export interface Summary {
  /** The exact pin of this version. */
  readonly pin: Pin;
  /** The preset's title. */
  readonly title: string;
  /** The preset's description (may be empty). */
  readonly description: string;
  /** The recipe's diagram family; `null` for themes. */
  readonly family: string | null;
}

/** The result of instantiating a recipe. Nothing is placed; Authoring merges `intent`. */
export interface Expansion<T> {
  /** The recipe pin that was requested. */
  readonly pin: Pin;
  /** The namespace every recipe alias was remapped into. */
  readonly namespace: PresetId;
  /** The editable diagram intent the recipe codec returned. */
  readonly intent: T;
  /** Media digests the recipe needs: its own assets plus fonts of every reachable theme, sorted and without duplicates. */
  readonly assets: readonly Digest[];
  /** Pins of every theme the recipe reaches, including inherited bases. */
  readonly themes: readonly Pin[];
}

/**
 * The Templates facade. Every method takes the catalog as plain input, checks it in full, and
 * never saves anything; Authoring owns admission commits and retries. Every method returns a
 * frozen copy on success and a `Diagnostic` on failure. A method throws only when inspecting a
 * thrown value itself throws (`instanceof`, or reading its `code`, `path` or `message`; see
 * `createTemplates`).
 */
export interface Templates<T> {
  /**
   * Checks a whole catalog: schemas, duplicate keys, every digest, payload rules, pins and cycles.
   *
   * @param input - The untrusted catalog.
   * @returns The frozen catalog, or the first failure (`invalid-input`, `duplicate-preset`,
   * `digest-mismatch`, `missing-preset`, `dependency-cycle`, `provider-failed`, or the hashing
   * provider's own failure).
   */
  readCatalog(input: unknown): Result<Catalog>;
  /**
   * Checks that `input` could be admitted: it admits it through the codecs, then also plans the
   * admission, so a version conflict (`version-exists`) and the new catalog's pins and cycles are
   * checked. Nothing is saved.
   *
   * @param catalog - The untrusted catalog (checked as in `readCatalog`).
   * @param input - The untrusted admission.
   * @returns The frozen admitted preset, or the first failure (including a codec's own failure).
   */
  validatePreset(
    catalog: unknown,
    input: unknown,
  ): Result<Preset>;
  /**
   * Admits `input` and plans adding it. An existing version with the same content is a no-op plan
   * (`changed: false`); with different content it is `version-exists`.
   *
   * @param catalog - The untrusted catalog (checked as in `readCatalog`).
   * @param input - The untrusted admission.
   * @returns The frozen plan, or the first failure (including a codec's own failure).
   */
  planAdmission(
    catalog: unknown,
    input: unknown,
  ): Result<PresetPlan>;
  /**
   * Lists presets matching the query: `kind` if given, and `search` found in the id, title,
   * description or recipe family. Ordered by kind/id, then by version numerically ascending.
   *
   * @param catalog - The untrusted catalog (checked as in `readCatalog`).
   * @param query - The untrusted query (`search` defaults to empty).
   * @returns The frozen summaries, or the first failure (`invalid-input` for a bad query).
   */
  list(
    catalog: unknown,
    query: unknown,
  ): Result<readonly Summary[]>;
  /**
   * Returns one preset: the named version, or the latest when none is given. A digest may be
   * given only with an exact version, and must then match.
   *
   * @param catalog - The untrusted catalog (checked as in `readCatalog`).
   * @param selection - The untrusted selection.
   * @returns The frozen preset, or `invalid-input`, `missing-preset` or `digest-mismatch`.
   */
  read(
    catalog: unknown,
    selection: unknown,
  ): Result<Preset>;
  /**
   * Expands a pinned recipe into diagram intent under a namespace. The recipe is re-inspected by
   * the codec first and must match its admitted payload.
   *
   * @param catalog - The untrusted catalog (checked as in `readCatalog`).
   * @param request - The untrusted request: the recipe pin and the namespace.
   * @returns The frozen expansion, or the first failure (`invalid-input` for a theme pin,
   * `missing-preset`, `digest-mismatch`, or a codec's own failure).
   */
  instantiate(
    catalog: unknown,
    request: unknown,
  ): Result<Expansion<T>>;
}
