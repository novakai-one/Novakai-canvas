/*
 * The render-only theme override: a copy of the collection source whose `theme` field names the
 * chosen theme, written on the spans Language parsed. Pure apart from the injected parser; the
 * source file is never written and nothing trusts its name. Pins are checked when the copy is
 * lowered. The caller picks another source or theme and runs render:png again.
 */
import type { RenderEnvironment } from '../../contract/ports/render.js';
import type { ParsedSource, Span } from '../../contract/records/foreign.js';
import type { ThemeChoice } from '../../contract/records/render.js';
import type { RenderEvidence, RenderFault } from '../../contract/records/render-failure.js';
import { faulted } from '../../contract/records/render-failure.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { mapped } from '../shared/results.js';

/**
 * A copy of `source` whose collection names `theme`: the existing theme field is replaced, or one
 * is written after the title. Fails with Language's diagnostics, `collection-required` when the
 * source is not a whole collection, or `collection-title-required` when it has no title to write
 * the theme after.
 */
export function withTheme(
  source: SourceFile,
  theme: ThemeChoice,
  parse: RenderEnvironment['parse'],
): Result<SourceFile, RenderEvidence> {
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
  if (parsed.kind !== 'canvas') return faulted({ code: 'collection-required' });
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
  if (title === undefined) return faulted({ code: 'collection-title-required' });
  const offset = title.end.offset;
  return success(
    source.slice(0, offset) + ' theme=' + JSON.stringify(theme) + source.slice(offset),
  );
}
