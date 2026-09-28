/*
 * Lowering a whole `canvas 1` document: first to the raw collection record, then, with Model's
 * reader, stage and planner, to the change list Authoring commits. No writes, so a retry gives
 * the same result. Language owns correcting the source; Authoring owns commit recovery.
 */
import type { Declaration, Document } from '../../contract/records/syntax.js';
import type { LowerRequest, LoweredIntent } from '../../contract/records/requests.js';
import type { Dependencies } from '../../contract/types.js';
import { textOr, withoutField, type RawRecord } from './fields.js';
import { lowerRecord, lowerNode } from './content.js';
import { lowerSection } from './views.js';
import { lowerLayout } from './layout.js';
import { lowerAsset, resolveTheme, documentResources } from './resources.js';
import { ownerValue, sourceMappings } from './diagnostics.js';
import { partitionLayout } from './layout-fields.js';
import type { Result } from '../../contract/errors.js';
import { accepted, protect, reject } from '../validation/outcomes.js';
import { lowerDefinition } from './definitions.js';
import { defaults } from '../vocabulary/defaults.js';

/**
 * Lowers a document to the change list for `create` or `replace`.
 *
 * Steps, in order:
 * 1. Checks the mode: `create` needs no snapshot; `replace` needs the snapshot with the
 *    document's collection ID; `patch` is rejected here.
 * 2. Lowers the raw record (`lowerDocumentData`) and has Model validate it.
 * 3. Builds an empty shell of the new collection (no records, no layout constraints). The
 *    starting point is the snapshot, or for `create` the shell after Model validates it.
 * 4. Stages one `replace-document` change, then has Model's planner check it.
 *
 * A Model rejection is mapped back to the source span of the record it names.
 *
 * Fails with `invalid-input` for a wrong mode or a snapshot given to `create`, `unknown-target`
 * for a missing or different snapshot on `replace`, any lowering or Model diagnostic, or
 * `provider-failure` when a Model role throws. No writes.
 */
export function lowerDocument(
  document: Document,
  request: LowerRequest,
  deps: Dependencies,
): Result<LoweredIntent> {
  return protect(() => {
    checkMode(document, request);
    const mappings = sourceMappings(document.declaration);
    const raw = accepted(lowerDocumentData(document, request));
    const candidate = ownerValue(deps.reader.validate(raw), mappings, document.span);
    const shell = emptyShell(candidate);
    const original =
      request.snapshot ?? ownerValue(deps.reader.validate(shell), mappings, document.span);
    const changes = [{ op: 'replace-document', value: candidate }];
    const staged = ownerValue(deps.stage.stage(original, changes), mappings, document.span);
    const planned = ownerValue(
      deps.planner.plan(original, staged.changes),
      mappings,
      document.span,
    );
    return {
      mode: request.mode,
      collection: planned.candidate,
      changes: staged.changes,
      resources: documentResources(document.declaration),
      sourceMap: mappings,
    };
  });
}

/**
 * Lowers a parsed document to the raw collection record, before Model checks it. The written
 * `theme=` (default `paper`) is replaced by the resolved theme; the layout attributes become
 * `arrangement` (default algorithm `grid`). Nodes, wires, sections, sources, assets and type
 * definitions keep their written order. Model checks IDs and relations afterwards.
 */
function lowerDocumentData(
  document: Document,
  request: LowerRequest,
): Result<RawRecord> {
  return protect(() => {
    const item = document.declaration;
    const metadata = lowerRecord(item);
    const remaining = withoutField(partitionLayout(metadata).remaining, 'theme');
    const theme = resolveTheme(
      textOr(item.fields, 'theme', defaults.theme),
      request.resources,
      item.span,
    );
    return {
      ...remaining,
      schemaVersion: 1,
      revision: request.snapshot?.revision ?? 0,
      theme,
      arrangement: accepted(lowerLayout(item.fields, item.children, defaults.collectionLayout)),
      objects: lowerEach(item, 'node', lowerNode),
      relationships: lowerEach(item, 'wire', lowerRecord),
      sections: lowerEach(item, 'section', (section) => accepted(lowerSection(section))),
      sources: lowerEach(item, 'source', lowerRecord),
      assets: lowerEach(item, 'asset', (asset) => lowerAsset(asset, request.resources)),
      definitions: lowerEach(item, 'type', lowerDefinition),
    };
  });
}

/** Lowers each top-level declaration of one construct, in written order. */
function lowerEach(
  item: Declaration,
  kind: Declaration['kind'],
  lower: (declaration: Declaration) => RawRecord,
): readonly RawRecord[] {
  const found = records(item, kind);
  return found.map(lower);
}

/** The top-level declarations of one construct, in written order. */
function records(
  item: Declaration,
  kind: Declaration['kind'],
): readonly Declaration[] {
  return item.children.filter((child) => child.kind === kind);
}

/** The collection with no records and no layout constraints: where `create` starts. */
function emptyShell(candidate: LoweredIntent['collection']): RawRecord {
  return {
    ...candidate,
    objects: [],
    relationships: [],
    sections: [],
    assets: [],
    sources: [],
    definitions: [],
    arrangement: { ...candidate.arrangement, constraints: [] },
  };
}

/** `create` needs no snapshot; any other mode must be `replace` with the matching snapshot. */
function checkMode(
  document: Document,
  request: LowerRequest,
): void {
  if (request.mode === 'create') {
    requireAbsent(document, request);
    return;
  }
  requireReplacement(document, request);
}

/** Rejects a mode other than `replace`, then a snapshot missing or with another collection ID. */
function requireReplacement(
  document: Document,
  request: LowerRequest,
): void {
  if (request.mode !== 'replace')
    reject(
      'invalid-input',
      document.span,
      'create or replace for canvas',
      'Document mode mismatch',
    );
  if (request.snapshot?.id !== document.collection)
    reject(
      'unknown-target',
      document.span,
      'Matching collection snapshot',
      'Replacement snapshot is missing or has another identity',
    );
}

/**
 * Rejects `create` with a snapshot. Language checks only the request; Authoring checks that the
 * collection does not already exist when it commits.
 */
function requireAbsent(
  document: Document,
  request: LowerRequest,
): void {
  if (request.snapshot !== null)
    reject(
      'invalid-input',
      document.span,
      'Null snapshot for create',
      'Create does not replace an existing collection',
    );
}
