/*
 * Render source reading: collection matching by parsed identity, and theme override as text
 * surgery on parser-provided spans. Raw text stays unbranded until Language parses it; nothing
 * here trusts filenames or mutates sources. The source envelope schema lives with the boundary
 * vocabulary in contract/records.
 */
import type { Collection, Language } from '../../contract/records/foreign.js';
import type { CollectionName } from '../../contract/brands.js';
import { RenderAbort, accepted } from './faults.js';

/** A source matches when Language parses it and its collection id equals the requested one. */
export function sourceMatches(
  source: string,
  id: CollectionName,
  parse: Language['parse'],
): boolean {
  const parsed = parse(source);
  return parsed.ok && parsed.value.collection === id;
}

/** A render-only copy of the source with its theme replaced; pin verification happens at lowering. */
export function sourceWithTheme(
  source: string,
  theme: Collection['theme']['id'],
  parse: Language['parse'],
): string {
  const parsed = accepted(parse(source));
  if (parsed.kind !== 'canvas') throw new RenderAbort({ code: 'collection-required' });
  const themeField = parsed.declaration.fields.theme;
  if (themeField === undefined)
    return insertTheme(source, theme, parsed.declaration.fields.title?.span.end.offset);
  return (
    source.slice(0, themeField.span.start.offset) +
    JSON.stringify(theme) +
    source.slice(themeField.span.end.offset)
  );
}

/** Theme is inserted after the parsed title; a titleless collection cannot be overridden. */
function insertTheme(
  source: string,
  theme: Collection['theme']['id'],
  offset: number | undefined,
): string {
  if (offset === undefined) throw new RenderAbort({ code: 'collection-title-required' });
  return source.slice(0, offset) + ' theme=' + JSON.stringify(theme) + source.slice(offset);
}
