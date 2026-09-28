/*
 * Literal edits in the expression editor. The literal controls report text; these functions
 * decide what that text means under a kind. Number text that is not yet a complete finite number
 * (for example `1e`) stays a literal draft so typing is never lost; everything else commits a
 * literal value at its path.
 */
import type {
  ExpressionPath,
  LiteralCommit,
  LiteralDraft,
  LiteralKind,
  LiteralValue,
} from '../../contract/records/definitions.js';
import { samePath } from './paths.js';

/** The kind a literal value has. */
export function literalKindOf(value: LiteralValue): LiteralKind {
  if (typeof value === 'number') return 'number';
  return typeof value === 'boolean' ? 'boolean' : 'string';
}

/** Switching kind reinterprets the current text; incomplete number text stays a draft. */
export function literalKindChange(
  kind: LiteralKind,
  text: string,
  path: ExpressionPath,
): LiteralCommit {
  if (kind === 'boolean') return literalBooleanChange(text, path);
  return literalTextChange(kind, text, path);
}

/** Typing reinterprets the text under the current kind. */
export function literalTextChange(
  kind: 'string' | 'number',
  text: string,
  path: ExpressionPath,
): LiteralCommit {
  return kind === 'string' ? literalValue(text, path) : numberCommit(text, path);
}

/** Choosing `true` or `false` commits that boolean. */
export function literalBooleanChange(
  text: string,
  path: ExpressionPath,
): LiteralCommit {
  return literalValue(text === 'true', path);
}

/** The retained draft at a path, as stored (never a copy, so the editor's text is not reset). */
export function literalDraftAt(
  drafts: readonly LiteralDraft[],
  path: ExpressionPath,
): LiteralDraft | null {
  return drafts.find((draft) => samePath(draft.path, path)) ?? null;
}

/** A finite number commits; other text is kept as a number draft (keys in order path, kind, text). */
function numberCommit(
  text: string,
  path: ExpressionPath,
): LiteralCommit {
  const value = finiteNumber(text);
  if (value === null) return { kind: 'draft', draft: { path, kind: 'number', text } };
  return literalValue(value, path);
}

/** A committed literal at a path. */
function literalValue(
  value: LiteralValue,
  path: ExpressionPath,
): LiteralCommit {
  return { kind: 'value', expression: { kind: 'literal', value }, path };
}

/** The number the text spells, when it is complete and finite; null otherwise. */
function finiteNumber(text: string): number | null {
  if (!completeNumber(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Whether the text is a whole decimal number, optionally signed and with an exponent. */
function completeNumber(text: string): boolean {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text);
}
