import { z } from 'zod';
import { snapshotSchema, requestSchema, historyStatusSchema } from '@novakai/canvas-authoring';
import type { Snapshot, Request } from '@novakai/canvas-authoring';
import { validate } from '@novakai/canvas-model';
import type { Collection, Change } from '@novakai/canvas-model';
import type { Language } from '@novakai/canvas-language';
import type { WorkspaceInputs } from '../../contract/ports/workspace-inputs.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type {
  CapturedCollectionBase,
  EditingBase,
} from '../../contract/records/editor-recovery.js';
import { baseWorkspace, captureCollectionBase, collectionRecord } from '../../contract/api.js';
import {
  capturedCollectionBaseSchema,
  hasRecoveryTag,
} from '../../contract/schemas/editor-recovery.js';
/** Invalid canonical data is surfaced, not hidden as an empty collection. */
function collections(snapshot: Snapshot): Result<readonly Collection[]> {
  const candidates = snapshot.records
    .filter((item) => item.key.kind === 'collection' && !item.deleted)
    .map((item) => validate(item.value));
  if (candidates.some((item) => !item.ok))
    return failure('invalid-workspace', 'A collection failed Model validation');
  return { ok: true, value: candidates.flatMap((item) => (item.ok ? [item.value] : [])) };
}
/** Authoring owns snapshot shape; Model owns each live collection document. */
function snapshot(input: unknown): ReturnType<WorkspaceInputs['snapshot']> {
  const checked = snapshotSchema.safeParse(input);
  if (!checked.success) return failure('invalid-workspace', 'Workspace response was invalid');
  const content = collections(checked.data);
  if (!content.ok) return content;
  return { ok: true, value: { snapshot: checked.data, collections: content.value } };
}
/** Request identity is credential-derived and all expected versions come from the caller's captured snapshot. */
function request(
  snapshot: EditingBase,
  id: string,
  planner: string,
  payload: unknown,
  collection: string,
  create: boolean,
): Result<Request> {
  const expected = expectedVersions(snapshot, collection, create);
  if (!expected.ok) return expected;
  const checked = requestSchema.safeParse({
    workspace: baseWorkspace(snapshot),
    request: id,
    version: 1,
    actor: { id: 'human:browser', kind: 'human' },
    assets: [],
    expected: expected.value,
    scope: expected.value.map((item) => item.key),
    intent: { kind: 'change', planner, payload },
  });
  if (!checked.success)
    return failure('invalid-request', 'The diagram change could not be prepared');
  return { ok: true, value: checked.data };
}
function expectedVersions(
  base: EditingBase,
  collection: string,
  create: boolean,
): Result<readonly ExpectedVersion[]> {
  return create ? createVersions(base, collection) : replaceVersions(base, collection);
}
function createVersions(
  base: EditingBase,
  collection: string,
): Result<readonly ExpectedVersion[]> {
  if ('record' in base)
    return failure(
      'invalid-request',
      'A captured collection cannot be used to create a collection',
    );
  const key = { kind: 'collection' as const, id: collection };
  const catalog = base.records
    .filter((item) => item.key.kind === 'catalog' && !item.deleted)
    .map((item) => ({ key: item.key, version: item.version }));
  return { ok: true, value: [{ key, version: 'absent' }, ...catalog] };
}
function replaceVersions(
  base: EditingBase,
  collection: string,
): Result<readonly ExpectedVersion[]> {
  const record = collectionRecord(base, collection);
  if (!record.ok) return record;
  return {
    ok: true,
    value: [{ key: record.value.key, version: record.value.version }],
  };
}
type ExpectedVersion = {
  readonly key: { readonly kind: string; readonly id: string };
  readonly version: number | 'absent';
};
/** Human starter content is ordinary readable DSL, admitted through the same Language and Authoring path as agent source. */
function newSource(
  id: string,
  title: string,
): string {
  return `canvas 1\ncollection @${id} ${JSON.stringify(title)} theme=paper {\n  node @start start "Start" {}\n  node @step step "Describe the next step" {}\n  node @end end "Done" {}\n  wire @first @start -> @step "begin"\n  wire @next @step -> @end "complete"\n  section @process "Process" mode=flow layout=flow direction=right {\n    show @start @step @end\n    connect @first @next\n  }\n}`;
}
/** Inputs are owner-based translators. Diagram readout and Language printing are supplied at composition, avoiding sibling imports. */
export function createWorkspaceInputs(
  diagram: WorkspaceInputs['diagram'],
  language: Pick<Language, 'print'>,
): WorkspaceInputs {
  return {
    snapshot,
    history,
    diagram,
    newSource,
    library: libraryRequest,
    sourceRecovery,
    dsl: (snapshot, collection, source, mode, id) =>
      request(snapshot, id, 'dsl', { source, mode }, collection, mode === 'create'),
    model: (snapshot, collection, changes: readonly Change[], id) =>
      request(snapshot, id, 'model', { collection, changes }, collection, false),
    source: (collection) => {
      const result = language.print({ collection, scope: { kind: 'all' } });
      if (!result.ok)
        return failure(
          'source-unavailable',
          'Language could not print this collection',
          result.error,
        );
      return { ok: true, value: result.value.source };
    },
  };
}

const currentSource = z.strictObject({
  kind: z.literal('source-draft'),
  schemaVersion: z.literal(1),
  source: z.string(),
  base: capturedCollectionBaseSchema,
  generation: z.string(),
  collection: z.string(),
  edit: z.number().int().nonnegative(),
});
const legacySource = z.strictObject({
  source: z.string(),
  snapshot: snapshotSchema,
  generation: z.string(),
  collection: z.string(),
  edit: z.number().int().nonnegative(),
});
interface SourceInput {
  readonly source: string;
  readonly base: EditingBase;
  readonly generation: string;
  readonly collection: string;
  readonly edit: number;
}
function sourceRecovery(input: unknown): ReturnType<WorkspaceInputs['sourceRecovery']> {
  const parsed = sourceInput(input);
  if (!parsed.ok) return parsed;
  const base = captureCollectionBase(parsed.value.base, parsed.value.collection);
  if (!base.ok) return base;
  return admitSource({ ...parsed.value, base: base.value });
}
function sourceInput(input: unknown): Result<SourceInput> {
  const checked = parseSource(input);
  if (!checked.success)
    return failure(
      'invalid-recovery',
      'Stored source draft is invalid; it was preserved for recovery',
    );
  return 'base' in checked.data
    ? currentSourceValue(checked.data)
    : legacySourceValue(checked.data);
}
function parseSource(input: unknown) {
  return hasRecoveryTag(input) ? currentSource.safeParse(input) : legacySource.safeParse(input);
}
function currentSourceValue(input: z.infer<typeof currentSource>): Result<SourceInput> {
  return { ok: true, value: input };
}
function legacySourceValue(input: z.infer<typeof legacySource>): Result<SourceInput> {
  return {
    ok: true,
    value: {
      source: input.source,
      base: input.snapshot,
      generation: input.generation,
      collection: input.collection,
      edit: input.edit,
    },
  };
}
function admitSource(
  input: SourceInput & { readonly base: CapturedCollectionBase },
): ReturnType<WorkspaceInputs['sourceRecovery']> {
  const collection = admittedCollection(input);
  if (!collection.ok) return collection;
  return {
    ok: true,
    value: {
      source: input.source,
      base: input.base,
      generation: input.generation,
      collection: input.collection,
      edit: input.edit,
    },
  };
}
function admittedCollection(
  input: SourceInput & { readonly base: CapturedCollectionBase },
): Result<Collection> {
  const collection = validate(input.base.record.value);
  if (!collection.ok)
    return failure('invalid-recovery', 'Stored source collection identity is invalid');
  return checkedSourceCollection(collection.value, input.collection, input.base.record.version);
}
function checkedSourceCollection(
  collection: Collection,
  id: string,
  version: number,
): Result<Collection> {
  if (collection.id !== id)
    return failure('invalid-recovery', 'Stored source collection identity is invalid');
  if (collection.revision !== version)
    return failure('invalid-recovery', 'Stored source collection revision is invalid');
  return { ok: true, value: collection };
}

/** Organisation changes acquire only the observed catalog's write scope; Library owns their validation. */
function libraryRequest(
  snapshot: Snapshot,
  changes: readonly import('@novakai/canvas-library').OrganisationChange[],
  id: string,
): Result<Request> {
  const expected = snapshot.records
    .filter((item) => item.key.kind === 'catalog' && !item.deleted)
    .map((item) => ({ key: item.key, version: item.version }));
  const parsed = requestSchema.safeParse({
    version: 1,
    workspace: snapshot.workspace,
    request: id,
    actor: { id: 'human:browser', kind: 'human' },
    assets: [],
    expected,
    scope: expected.map((item) => item.key),
    intent: { kind: 'change', planner: 'library', payload: { changes } },
  });
  if (!parsed.success)
    return failure('invalid-library-request', 'The catalog change could not be prepared');
  return { ok: true, value: parsed.data };
}

/** Inverse requests use the selected target's exact snapshot and never claim reserved history scope. */
function history(
  input: unknown,
  direction: 'undo' | 'redo',
  id: string,
): Result<Request | null> {
  const checked = historyStatusSchema.safeParse(input);
  if (!checked.success) return failure('invalid-history', 'History status is invalid');
  return historyRequest(checked.data, direction, id);
}
function historyRequest(
  status: import('@novakai/canvas-authoring').HistoryStatus,
  direction: 'undo' | 'redo',
  id: string,
): Result<Request | null> {
  const action = status[direction];
  if (action === null) return { ok: true, value: null };
  const parsed = requestSchema.safeParse({
    version: 1,
    workspace: status.workspace,
    request: id,
    actor: { id: 'human:browser', kind: 'human' },
    assets: [],
    scope: action.scope,
    expected: action.expected,
    intent: { kind: direction, transaction: action.transaction },
  });
  if (!parsed.success) return failure('invalid-history', 'History request is invalid');
  return { ok: true, value: parsed.data };
}
