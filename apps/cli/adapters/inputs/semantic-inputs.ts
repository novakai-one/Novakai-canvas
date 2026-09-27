import { snapshotSchema, requestSchema, receiptSchema } from '@novakai/canvas-authoring';
import type { Request, Snapshot, StoredRecord } from '@novakai/canvas-authoring';
import { validate } from '@novakai/canvas-model';
import type { Language } from '@novakai/canvas-language';
import { byteBackup } from '../../contract/records/resources.js';
import { z } from 'zod';
import type { SemanticInputs, ReceiptExpectation } from '../../contract/ports/runtime.js';
import type { Command } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
const manualTarget = z
  .strictObject({
    target: z.string(),
    kind: z.enum(['placement', 'route']),
    locked: z.boolean(),
  })
  .readonly();
/** The snapshot half is the browser's; the CLI checks only that a receipt is present. */
const appliedCommit = z.looseObject({ receipt: z.unknown() });
const readout = z.looseObject({
  source: z.string(),
  collection: z.string(),
  revision: z.number().int().nonnegative(),
  scope: z
    .union([
      z.object({ kind: z.literal('all') }),
      z.object({ kind: z.enum(['section', 'object']), id: z.string() }),
    ])
    .default({ kind: 'all' }),
  manual: z.array(manualTarget).readonly().optional(),
});
/** Parse the server snapshot through Authoring, rather than asserting the JSON response type. */
function snapshot(input: unknown): Result<Snapshot> {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success)
    return failure('invalid-response', 'Service returned an invalid workspace snapshot');
  return { ok: true, value: parsed.data };
}
/** Existing edits require the revision the agent actually read; storage preconditions remain tied to the same snapshot. */
function existingVersion(
  record: StoredRecord | undefined,
  revision: number | null,
): Result<number> {
  if (!record) return failure('not-found', 'The collection does not exist');
  const collection = validate(record.value);
  if (!collection.ok)
    return failure(
      'invalid-response',
      'The collection is not a valid Model document',
      'Correct the named Model diagnostics.',
      collection.error,
    );
  return matchedRevision(record, collection.value.revision, revision);
}
/** A missing revision is an actionable input error, not permission to overwrite newer authoring. */
function matchedRevision(
  record: StoredRecord,
  current: number,
  requested: number | null,
): Result<number> {
  if (requested === null)
    return failure('revision-required', 'Editing requires --revision from canvas read');
  if (requested !== current)
    return failure(
      'revision-conflict',
      `Read revision ${requested} differs from current revision ${current}`,
      'Read the collection and compare changes before submitting a new request.',
    );
  return { ok: true, value: record.version };
}
/** Create uses an absent precondition; even a tombstoned ID cannot be silently reintroduced as a new collection. */
function expectedVersion(
  command: Command,
  record: StoredRecord | undefined,
): Result<number | 'absent'> {
  if (command.mode !== 'create') return existingVersion(record, command.revision);
  if (record)
    return failure(
      'already-exists',
      'Collection identity already exists; choose a new collection ID',
    );
  return { ok: true, value: 'absent' };
}
/** Authoring's public schema mints every branded identity and verifies the generated envelope. */
function build(
  command: Command,
  source: string,
  state: Snapshot,
  id: string,
  collection: string,
): Result<Request> {
  const record = state.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === collection,
  );
  const expected = expectedVersion(command, record);
  if (!expected.ok) return expected;
  return withCatalog(command, source, state, id, collection, expected.value);
}
/** New diagrams register in the current library transaction; edits address only their existing collection. */
function withCatalog(
  command: Command,
  source: string,
  state: Snapshot,
  id: string,
  collection: string,
  version: number | 'absent',
): Result<Request> {
  const catalog = state.records.find((item) => item.key.kind === 'catalog' && !item.deleted);
  if (!catalog) return failure('invalid-response', 'Workspace catalog is missing');
  const key = { kind: 'collection', id: collection };
  const expected =
    command.mode === 'create'
      ? [
          { key, version },
          { key: catalog.key, version: catalog.version },
        ]
      : [{ key, version }];
  return checkedRequest({
    workspace: state.workspace,
    request: id,
    actor: { id: 'agent:cli', kind: 'agent' },
    version: 1,
    expected,
    scope: expected.map((item) => item.key),
    assets: [],
    intent: { kind: 'change', planner: 'dsl', payload: { source, mode: command.mode } },
  });
}
/** Invalid generated identities are ordinary CLI errors; no partially constructed request is submitted. */
function checkedRequest(input: unknown): Result<Request> {
  const checked = requestSchema.safeParse(input);
  if (!checked.success)
    return failure('invalid-input', 'Request identity or generated preconditions are invalid');
  return { ok: true, value: checked.data };
}
/** The actual Language parser identifies document scope; CLI never uses a regex to infer DSL meaning. */
function request(
  command: Command,
  source: string,
  state: Snapshot,
  id: string,
  language: Pick<Language, 'parse'>,
): Result<Request> {
  const parsed = language.parse(source);
  if (!parsed.ok)
    return failure(
      'invalid-source',
      'Language rejected this source',
      'Correct the named source diagnostics and retry.',
      parsed.error,
    );
  return build(command, source, state, id, parsed.value.collection);
}
/** List uses Model's checked labels and IDs; invalid canonical data cannot masquerade as an empty library. */
function collectionLine(record: StoredRecord): string {
  const collection = validate(record.value);
  if (!collection.ok) return `${record.key.id}\tInvalid collection — inspect service diagnostics`;
  return `${collection.value.id}\tr${collection.value.revision}\t${collection.value.title}\t${collection.value.sections.length} sections`;
}
/** Human geometry survives matching replacements; agents reset it explicitly when reflow is wanted. */
function manualNote(manual: ReadonlyArray<{ readonly target: string }> | undefined): string {
  if (manual === undefined || manual.length === 0) return '';
  return `\n# manual geometry: ${manual.length} target(s) — replace preserves these; reset layout @section / reset route @section/@wire to reflow`;
}
/** Read output declares the exact revision as a DSL comment, preserving fully authorable source. */
function sourceReadout(input: unknown): Result<string> {
  const parsed = readout.safeParse(input);
  if (!parsed.success)
    return failure('invalid-response', 'Service returned an invalid source readout');
  return {
    ok: true,
    value: `${scopeNotice(parsed.data.scope)}# ${parsed.data.collection} revision=${parsed.data.revision}${manualNote(parsed.data.manual)}\n${parsed.data.source}`,
  };
}

function scopeNotice(scope: { readonly kind: string }): string {
  return scope.kind === 'all'
    ? ''
    : '# Read-only partial context; referenced objects/views and manual geometry may be omitted. Read those IDs separately or use the full collection.\n';
}
/** Receipt output reports confirmed identity and sequence, not an optimistic saved status. */
function receipt(
  input: unknown,
  expected: ReceiptExpectation,
): Result<string> {
  if (input === null) return absentReceipt(expected);
  return receiptReadout(input, expected.request);
}
/** An absent lookup is useful information; an absent apply confirmation remains an error requiring reconciliation. */
function absentReceipt(expected: ReceiptExpectation): Result<string> {
  if (expected.kind === 'lookup') return { ok: true, value: 'No committed receipt found.' };
  return failure(
    'invalid-response',
    'Apply returned no committed receipt',
    `Check canvas receipt ${expected.request} before retrying.`,
  );
}
/** An apply answer without its receipt half is as unconfirmed as a missing receipt. */
function appliedReceipt(
  input: unknown,
  request: string,
): Result<string> {
  const parsed = appliedCommit.safeParse(input);
  if (!parsed.success)
    return failure(
      'invalid-response',
      'Service returned an invalid apply confirmation',
      `Check canvas receipt ${request} before retrying.`,
    );
  return receipt(parsed.data.receipt, { kind: 'committed', request });
}
/** Malformed receipts cannot release a pending request or be reported as a successful write. */
function receiptReadout(
  input: unknown,
  request: string,
): Result<string> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return failure('invalid-response', 'Service returned an invalid receipt');
  if (parsed.data.request !== request)
    return failure('invalid-response', 'Service returned a receipt for another request');
  return {
    ok: true,
    value: `${parsed.data.outcome.status}: ${parsed.data.request}\nWorkspace sequence: ${parsed.data.sequence}`,
  };
}
/** All CLI semantic interpretation uses owning capability contracts; host output remains a small readable vocabulary. */
export function createSemanticInputs(language: Pick<Language, 'parse'>): SemanticInputs {
  return {
    profileParse: (source) => {
      const result = language.parse(source);
      if (!result.ok)
        return failure(
          'invalid-source',
          'Language rejected this source',
          'Correct the named source diagnostics and retry.',
          { code: 'validation-failed', diagnostics: result.error.diagnostics },
        );
      return { ok: true, value: result.value };
    },
    snapshot,
    checkedRequest,
    requests: (source) => {
      const result = language.parse(source);
      if (!result.ok)
        return failure(
          'invalid-source',
          'Language rejected this source',
          'Correct the named source diagnostics and retry.',
          result.error,
        );
      return { ok: true, value: result.value.resources };
    },
    admissionDigest: (input) => {
      const result = z
        .looseObject({ descriptor: z.looseObject({ digest: z.string().regex(/^[a-f0-9]{64}$/) }) })
        .safeParse(input);
      if (!result.success) return failure('invalid-response', 'Invalid Assets admission');
      return { ok: true, value: result.data.descriptor.digest };
    },
    backup: (input) => {
      const result = z
        .looseObject({ descriptor: z.looseObject({ digest: z.string() }), base64: z.string() })
        .safeParse(input);
      if (!result.success) return failure('invalid-response', 'Invalid normalized Assets bytes');
      const checked = byteBackup.safeParse({
        digest: result.data.descriptor.digest,
        base64: result.data.base64,
      });
      if (!checked.success) return failure('invalid-response', 'Invalid normalized Assets digest');
      return { ok: true, value: checked.data };
    },
    receipt,
    applied: appliedReceipt,
    readout: sourceReadout,
    request: (command, source, state, id) => request(command, source, state, id, language),
    collections: (input) => {
      const current = snapshot(input);
      if (!current.ok) return current;
      const records = current.value.records.filter(
        (item) => item.key.kind === 'collection' && !item.deleted,
      );
      return {
        ok: true,
        value:
          records.map(collectionLine).join('\n') ||
          'No collections yet. Use canvas create diagram.canvas.',
      };
    },
  };
}
