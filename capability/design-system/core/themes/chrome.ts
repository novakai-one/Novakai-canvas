import type { TokenValues } from '../../contract/records/tokens.js';
import type { SourceSet } from '../../contract/records/source.js';
import { chromeName, type ChromeName, tokenId, type TokenId } from '../../contract/brands.js';
import { parsed, member } from '../validation/input.js';
import { resolveDefinitions } from '../tokens/resolve.js';
import { changedDefinitions } from './overrides.js';
/** Optional diagram chrome remains absent from legacy payloads until a preset selects it. */
function chromeExtension(id: TokenId): boolean {
  return /^(elevation\.|chrome\.|role\.[^.]+\.(header|secondary)$)/.test(id);
}
/** Browser-only canvas treatment never enters a portable diagram theme or its pinned payload. */
function browserExtension(id: TokenId): boolean {
  return /^(canvasDepth\.|canvasEmphasis\.|canvasTone\.|canvas\.)/.test(id);
}
/** Serialization omits browser values always and chrome values only for legacy payloads. */
function omitted(
  id: TokenId,
  chrome: unknown,
): boolean {
  if (browserExtension(id)) return true;
  return chrome === undefined && chromeExtension(id);
}
/** Legacy serialization retains exactly its original token vocabulary and digest. */
export function chromeTokens(
  values: TokenValues,
  chrome: unknown,
): TokenValues {
  return Object.fromEntries(
    Object.entries(values).filter(([id]) => !omitted(tokenId.parse(id), chrome)),
  );
}
/** Explicit selectors are validated once; absence never inserts a default into a hashed payload. */
export function chromeField(chrome: unknown): { readonly chrome?: ChromeName } {
  if (chrome === undefined) return {};
  return { chrome: parsed(chromeName, chrome, 'chrome') };
}
/** Fill every token the saved theme lacks from defaults derived from its own roots. */
export function completeChromeTokens(
  supplied: TokenValues,
  source: SourceSet,
): TokenValues {
  const roots = Object.fromEntries(
    source.definitions
      .filter((item) => item.expression.op === 'literal')
      .filter((item) => supplied[item.id] !== undefined)
      .map((item) => [item.id, member(supplied, item.id)]),
  );
  const defaults = resolveDefinitions(changedDefinitions(source, roots)).values;
  // A theme saved before a token existed takes that token's current default instead of failing to load.
  // A missing font takes the theme's body font: diagrams only accept the theme's own pinned fonts.
  const body = supplied[tokenId.parse('font.body')];
  const filled = Object.entries(defaults).map(([id, value]) => [
    id,
    value.type === 'fontFamily' && body ? body : value,
  ]);
  return { ...Object.fromEntries(filled), ...supplied };
}
