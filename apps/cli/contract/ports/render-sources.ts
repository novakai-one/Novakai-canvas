/*
 * Why this file exists
 *
 * A render starts from `.canvas` text, but can only draw a checked collection. Language reads the
 * text and turns it into a collection ("lowers" it), and Model checks the result. A source with a
 * wire to a box that doesn't exist stops here, with Language's or Model's findings.
 *
 * This file names those three steps. None reads a file or changes anything saved.
 * `adapters/render/sources.ts` asks Language and Model.
 */
import type { RenderFailureSource } from '../records/render-failure.js';
import type { Collection, ParsedSource, ResolvedResources } from '../records/foreign.js';
import type { Result } from '../errors.js';

/** What a render asks of Language and Model about its `.canvas` sources. */
export interface RenderSources {
  /** Parses one source's text with Language. Fails with Language's findings. */
  parse(source: string): Result<ParsedSource, RenderFailureSource>;
  /**
   * Turns `source` text into a new collection, with its font, image and theme names filled in from
   * `resources`. It parses the text itself, so `parse` need not run first. Fails with Language's
   * findings.
   */
  lower(
    source: string,
    resources: ResolvedResources,
  ): Result<Collection, RenderFailureSource>;
  /** Checks a whole collection with Model, and gives it back typed. Fails with Model's findings. */
  validate(candidate: unknown): Result<Collection, RenderFailureSource>;
}
