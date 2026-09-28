/*
 * Why this file exists
 *
 * `--theme atlas` draws a collection with the `atlas` theme instead of its own. To do that, the
 * CLI changes a copy of the source text: `collection @shop "Shop" theme=onyx` becomes
 * `collection @shop "Shop" theme="atlas"`. A collection with no theme gets one after its title.
 *
 * This file makes that changed copy, at the places Language found when it parsed the text. It
 * never writes the file. Whether the theme exists is checked later, in `collection.ts`.
 */
import type { RenderSources } from '../../contract/ports/render-sources.js';
import type { ParsedSource, Span } from '../../contract/records/foreign.js';
import type { ThemeChoice } from '../../contract/records/render.js';
import type { RenderFailureSource } from '../../contract/records/render-failure.js';
import type { RenderFault } from '../../contract/records/render-fault.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { Result } from '../../contract/errors.js';
import { renderFaultFailure, success } from '../../contract/errors.js';
import { mapped } from '../shared/results.js';

/**
 * Gives back a copy of `source` whose collection uses `theme`: its theme is replaced, or written
 * after its title. `parse` is Language's parser.
 * Mistakes: Language can't parse the text, the text is a patch rather than a whole collection
 * (`collection-required`), or the collection has no title (`collection-title-required`).
 */
export function setSourceTheme(
  source: SourceFile,
  theme: ThemeChoice,
  parse: RenderSources['parse'],
): Result<SourceFile, RenderFailureSource> {
  const parsed = parse(source.source);
  if (!parsed.ok) return parsed;
  return mapped(themedText(source.source, parsed.value, theme), (text) => ({
    ...source,
    source: text,
  }));
}

/**
 * The source text with its theme set. Fails with `collection-required` or
 * `collection-title-required`.
 */
function themedText(
  source: string,
  parsed: ParsedSource,
  theme: ThemeChoice,
): Result<string, RenderFault> {
  if (parsed.kind !== 'canvas') return renderFaultFailure({ code: 'collection-required' });
  const field = parsed.declaration.fields.theme;
  if (field === undefined) return inserted(source, theme, parsed.declaration.fields.title?.span);
  return success(replaced(source, field.span, theme));
}

/** The theme field's value replaced by the quoted theme. */
function replaced(
  source: string,
  span: Span,
  theme: ThemeChoice,
): string {
  return source.slice(0, span.start.offset) + JSON.stringify(theme) + source.slice(span.end.offset);
}

/**
 * ` theme="…"` written right after the parsed title. Fails with `collection-title-required` when
 * the collection has no title.
 */
function inserted(
  source: string,
  theme: ThemeChoice,
  title: Span | undefined,
): Result<string, RenderFault> {
  if (title === undefined) return renderFaultFailure({ code: 'collection-title-required' });
  const offset = title.end.offset;
  return success(
    source.slice(0, offset) + ' theme=' + JSON.stringify(theme) + source.slice(offset),
  );
}
