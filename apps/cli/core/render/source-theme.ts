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
  if (!parsed.ok) {
    return parsed;
  }
  const themedText = writeTheme(source.source, parsed.value, theme);
  if (!themedText.ok) {
    return themedText;
  }
  return success({ ...source, source: themedText.value });
}

/**
 * Writes the theme into the collection's text: in place of its theme, or after its title when it
 * has none. A patch isn't a whole collection, so it can't take a theme.
 */
function writeTheme(
  text: string,
  parsed: ParsedSource,
  theme: ThemeChoice,
): Result<string, RenderFault> {
  if (parsed.kind !== 'canvas') {
    return collectionRequiredFailure();
  }
  const fields = parsed.declaration.fields;
  if (fields.theme === undefined) {
    return insertTheme(text, theme, fields.title?.span);
  }
  const replaced = replaceTheme(text, fields.theme.span, theme);
  return success(replaced);
}

/** Puts the quoted theme in place of the theme field's value. */
function replaceTheme(
  text: string,
  valueSpan: Span,
  theme: ThemeChoice,
): string {
  const before = text.slice(0, valueSpan.start.offset);
  const after = text.slice(valueSpan.end.offset);
  const quotedTheme = JSON.stringify(theme);
  return before + quotedTheme + after;
}

/** Writes ` theme="…"` right after the collection's title. With no title, it can't. */
function insertTheme(
  text: string,
  theme: ThemeChoice,
  titleSpan: Span | undefined,
): Result<string, RenderFault> {
  if (titleSpan === undefined) {
    return collectionTitleRequiredFailure();
  }
  const before = text.slice(0, titleSpan.end.offset);
  const after = text.slice(titleSpan.end.offset);
  const quotedTheme = JSON.stringify(theme);
  const inserted = before + ' theme=' + quotedTheme + after;
  return success(inserted);
}

/** Makes the mistake for a theme asked for on a patch, not a whole collection. */
function collectionRequiredFailure(): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'collection-required' });
}

/** Makes the mistake for a theme asked for on a collection with no title. */
function collectionTitleRequiredFailure(): Result<never, RenderFault> {
  return renderFaultFailure({ code: 'collection-title-required' });
}
