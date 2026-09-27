/*
 * Language's reading of a DSL source and the Authoring request a DSL change sends: the source's
 * collection, resource declarations and the change's storage preconditions against the observed
 * snapshot. Pure apart from the injected Language parser. Fails with `invalid-source` (fix the
 * DSL), `invalid-input` (the built request fails Authoring's schema), `invalid-response` (the
 * snapshot lacks a record the change needs), or a precondition code: `not-found`,
 * `already-exists`, `revision-required`, `revision-conflict`. The caller fixes the named input and
 * runs again.
 */
import type { Request, Snapshot, StoredRecord } from '@novakai/canvas-authoring';
import { requestSchema } from '../../contract/schemas.js';
import type { CollectionRevision, RequestId } from '../../contract/brands.js';
import { validate } from '@novakai/canvas-model';
import type { Language } from '@novakai/canvas-language';
import type { SemanticInputs } from '../../contract/ports/runtime.js';
import type { ChangeIntent } from '../../contract/records/command.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import type { FailureSource } from '../../contract/records/foreign.js';
import { failure, success } from '../../contract/errors.js';

/** All CLI semantic interpretation uses owning capability contracts; host output remains a small readable vocabulary. */
export function createSemanticInputs(language: Pick<Language, 'parse'>): SemanticInputs {
  return {
    profileParse: (source) => {
      const result = language.parse(source);
      if (!result.ok)
        return invalidSource({ code: 'validation-failed', diagnostics: result.error.diagnostics });
      return success(result.value);
    },
    requests: (source) => {
      const result = language.parse(source);
      if (!result.ok) return invalidSource(result.error);
      return success(result.value.resources);
    },
    request: (intent, source, state, id) => request(intent, source, state, id, language),
  };
}

/** Existing edits require the revision the agent actually read; storage preconditions remain tied to the same snapshot. */
function existingVersion(
  record: StoredRecord | undefined,
  revision: CollectionRevision | undefined,
): Result<number> {
  if (!record) return failure({ code: 'not-found', message: 'The collection does not exist' });
  const collection = validate(record.value);
  if (!collection.ok)
    return failure({
      code: 'invalid-response',
      message: 'The collection is not a valid Model document',
      recovery: 'Correct the named Model diagnostics.',
      source: collection.error,
    });
  return matchedRevision(record, collection.value.revision, revision);
}
/** A missing revision is an actionable input error, not permission to overwrite newer authoring. */
function matchedRevision(
  record: StoredRecord,
  current: number,
  requested: CollectionRevision | undefined,
): Result<number> {
  if (requested === undefined)
    return failure({
      code: 'revision-required',
      message: 'Editing requires --revision from canvas read',
    });
  if (requested !== current)
    return failure({
      code: 'revision-conflict',
      message: `Read revision ${requested} differs from current revision ${current}`,
      recovery: 'Read the collection and compare changes before submitting a new request.',
    });
  return success(record.version);
}
/** Create uses an absent precondition; even a tombstoned ID cannot be silently reintroduced as a new collection. */
function expectedVersion(
  intent: ChangeIntent,
  record: StoredRecord | undefined,
): Result<number | 'absent'> {
  if (intent.mode !== 'create') return existingVersion(record, intent.revision);
  if (record)
    return failure({
      code: 'already-exists',
      message: 'Collection identity already exists; choose a new collection ID',
    });
  return success('absent');
}
/** Authoring's public schema mints every branded identity and verifies the generated envelope. */
function build(
  intent: ChangeIntent,
  source: string,
  state: Snapshot,
  id: RequestId,
  collection: string,
): Result<Request> {
  const record = state.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === collection,
  );
  const expected = expectedVersion(intent, record);
  if (!expected.ok) return expected;
  return withCatalog(intent, source, state, id, collection, expected.value);
}
/** New diagrams register in the current library transaction; edits address only their existing collection. */
function withCatalog(
  intent: ChangeIntent,
  source: string,
  state: Snapshot,
  id: RequestId,
  collection: string,
  version: number | 'absent',
): Result<Request> {
  const catalog = state.records.find((item) => item.key.kind === 'catalog' && !item.deleted);
  if (!catalog) return invalidResponse('Workspace catalog is missing');
  const key = { kind: 'collection', id: collection };
  const expected =
    intent.mode === 'create'
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
    intent: { kind: 'change', planner: 'dsl', payload: { source, mode: intent.mode } },
  });
}
/** Invalid generated identities are ordinary CLI errors; no partially constructed request is submitted. */
function checkedRequest(input: unknown): Result<Request> {
  const checked = requestSchema.safeParse(input);
  if (!checked.success)
    return failure({
      code: 'invalid-input',
      message: 'Request identity or generated preconditions are invalid',
    });
  return success(checked.data);
}
/** The actual Language parser identifies document scope; CLI never uses a regex to infer DSL meaning. */
function request(
  intent: ChangeIntent,
  source: string,
  state: Snapshot,
  id: RequestId,
  language: Pick<Language, 'parse'>,
): Result<Request> {
  const parsed = language.parse(source);
  if (!parsed.ok) return invalidSource(parsed.error);
  return build(intent, source, state, id, parsed.value.collection);
}
/** Language's diagnostics under `invalid-source`. */
function invalidSource(source: FailureSource): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-source',
    message: 'Language rejected this source',
    recovery: 'Correct the named source diagnostics and retry.',
    source,
  });
}

/** A service answer that does not match its schema or lacks a record the command needs. */
function invalidResponse(message: string): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message });
}
