/*
 * Parsing a whole source: `canvas 1 collection @id … { … }` or `patch 1 @id { … }`. A scoped
 * `view` readout is refused. The result also lists the themes and assets the source asks for
 * and where each record was written; nothing is read from files or the network. Language owns
 * correcting the source; Authoring owns commit recovery.
 */
import type { ParsedSource, Document, Patch } from '../../contract/records/syntax.js';
import { documentResources, patchResources } from '../lowering/resources.js';
import { sourceMappings } from '../lowering/diagnostics.js';
import { tokenize } from '../lexing/tokens.js';
import { readSource } from '../validation/input.js';
import { reject, accepted } from '../validation/outcomes.js';
import {
  peek,
  advance,
  consume,
  enter,
  leave,
  consumedSpan,
  type Cursor,
  type Parsed,
} from './cursor.js';
import { readDeclaration } from './declarations.js';
import { readIdentity } from './references.js';
import { readOperation } from './patch.js';
import { repeat } from './repetition.js';

/** The most operations one patch may have. */
const maxPatchOperations = 1000;

/**
 * Parses a whole source. Steps: check the text (`readSource`), split it into tokens, refuse a
 * `view`, check the version, read the document or patch, require the end of the source, then
 * list resources and source mappings.
 *
 * @throws A `LanguageFault`: `display-only` for a `view`; `unsupported-version` for a version
 * other than 1; `syntax` for an unknown envelope, bad grammar or trailing source; `limit` for
 * too many tokens, too much nesting or more than 1000 patch operations; `unknown-property` and
 * `invalid-value` from reading attributes; and the diagnostics of `readSource`.
 */
export function parseSource(source: string): ParsedSource {
  const tokens = accepted(tokenize(readSource(source)));
  const cursor: Cursor = { tokens, index: 0, depth: 0 };
  if (peek(cursor).text === 'view')
    reject('display-only', peek(cursor).span, 'canvas or patch', 'A scoped view cannot be applied');
  const parsed = readEnvelope(cursor);
  if (peek(parsed.next).kind !== 'eof')
    reject('syntax', peek(parsed.next).span, 'End of source', 'Unexpected trailing source');
  return describeParsedSource(parsed.value);
}

/** Checks the version (the second token must be `1`), then reads the envelope. */
function readEnvelope(cursor: Cursor): Parsed<Document | Patch> {
  if (peek(cursor, 1).text !== '1')
    reject(
      'unsupported-version',
      peek(cursor, 1).span,
      'Version 1',
      'Unsupported language version',
    );
  return readSupportedEnvelope(cursor);
}

/** Reads a `canvas` or `patch` envelope; any other first word is a `syntax` error. */
function readSupportedEnvelope(cursor: Cursor): Parsed<Document | Patch> {
  if (peek(cursor).text === 'canvas') return readCanvas(cursor);
  if (peek(cursor).text === 'patch') return readPatch(cursor);
  reject('syntax', peek(cursor).span, 'canvas or patch', 'Unknown document envelope');
}

/** Reads `canvas 1` and its single `collection` declaration; the ID is the collection's. */
function readCanvas(cursor: Cursor): Parsed<Document> {
  const declaration = readDeclaration(advance(cursor, 2), ['collection']);
  const identity = readIdentity(advance(cursor, 3));
  return {
    value: {
      kind: 'canvas',
      version: 1,
      collection: identity.value,
      declaration: declaration.value,
      span: consumedSpan(cursor, declaration.next),
    },
    next: declaration.next,
  };
}

/** Reads `patch 1 @id { operations }`, keeping the operations in source order. */
function readPatch(cursor: Cursor): Parsed<Patch> {
  const identity = readIdentity(advance(cursor, 2));
  const start = enter(consume(identity.next, '{'));
  const operations = accepted(
    repeat(start, (item) => peek(item).text !== '}', readOperation, maxPatchOperations),
  );
  if (operations.value.length > maxPatchOperations)
    reject('limit', peek(start).span, 'At most 1000 operations', 'Patch operation limit exceeded');
  const end = leave(consume(operations.next, '}'));
  return {
    value: {
      kind: 'patch',
      version: 1,
      collection: identity.value,
      operations: operations.value,
      span: consumedSpan(cursor, end),
    },
    next: end,
  };
}

/**
 * Adds the resource requests and source mappings. For a document they come from its
 * declarations; for a patch, from its operations (each mapping is the operation's target ID).
 */
function describeParsedSource(parsed: Document | Patch): ParsedSource {
  if (parsed.kind === 'canvas')
    return {
      ...parsed,
      resources: documentResources(parsed.declaration),
      sourceMap: sourceMappings(parsed.declaration),
    };
  return {
    ...parsed,
    resources: parsed.operations.flatMap(patchResources),
    sourceMap: parsed.operations.map((operation) => ({
      path: operation.address.id,
      span: operation.span,
    })),
  };
}
