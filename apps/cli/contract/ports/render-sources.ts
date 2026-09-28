/*
 * The render environment's source rules: Language parses and lowers DSL, Model checks the
 * collection. Declaration only; adapters/render/sources.ts implements it. Reads no file and
 * changes nothing stored. Every failure is the owner's diagnostics, returned as a value.
 */
import type { RenderEvidence } from '../records/render-failure.js';
import type { Collection, ParsedSource, ResolvedResources } from '../records/foreign.js';
import type { Result } from '../errors.js';

/** Language and Model over one render's DSL sources. */
export interface RenderSources {
  /** Language's parse of one source. Fails with Language's diagnostics. */
  parse(source: string): Result<ParsedSource, RenderEvidence>;
  /** Lower `source` as a new collection against `resources`. Fails with Language's diagnostics. */
  lower(
    source: string,
    resources: ResolvedResources,
  ): Result<Collection, RenderEvidence>;
  /** Model's check of a whole collection. Fails with Model's diagnostics. */
  validate(value: unknown): Result<Collection, RenderEvidence>;
}
