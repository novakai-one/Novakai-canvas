/*
 * Request builders: the browser's Authoring requests (Model change, DSL, Library catalog, undo and
 * redo) built from a base the caller captured, and the DSL text a source request carries. Pure
 * apart from the Language printer supplied at composition; nothing is sent here. Every builder
 * answers a `Result` and never throws; the caller that sends owns recovery.
 */
import { requestSchema, historyStatusSchema } from '@novakai/canvas-authoring';
import type { HistoryStatus, Snapshot, Request } from '@novakai/canvas-authoring';
import type { Collection } from '@novakai/canvas-model';
import type { Language } from '@novakai/canvas-language';
import type { OrganisationChange } from '@novakai/canvas-library';
import type { RequestBuilders } from '../../contract/ports/request-builders.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { languageFailure } from '../../contract/foreign-failures.js';
import type { WebErrorCode } from '../../contract/records/error-codes.js';
import type { EditingBase } from '../../contract/records/editor-recovery.js';
import { baseWorkspace, collectionRecord } from '../../contract/api.js';

/**
 * The request builders. Language printing is supplied at composition, so this adapter does not
 * import a sibling. Each builder's failure codes are named on `RequestBuilders`.
 */
export function createRequestBuilders(language: Pick<Language, 'print'>): RequestBuilders {
  return {
    model: (snapshot, collection, changes, id) =>
      change(snapshot, id, 'model', { collection, changes }, collection, 'replace'),
    dsl: (snapshot, collection, source, mode, id) =>
      change(snapshot, id, 'dsl', { source, mode }, collection, mode),
    library: libraryRequest,
    history,
    source: (collection) => printSource(language, collection),
    newSource,
  };
}

/** Whether a change creates the collection or replaces its live record. */
type Expectation = 'create' | 'replace';

type ExpectedVersion = {
  readonly key: { readonly kind: string; readonly id: string };
  readonly version: number | 'absent';
};

/** What differs between the browser's requests; `browserRequest` adds the rest. */
interface RequestParts {
  readonly workspace: Request['workspace'];
  readonly request: string;
  readonly expected: unknown;
  readonly scope: unknown;
  readonly intent: unknown;
}

/** The failure a builder answers when Authoring's schema rejects its request. */
interface Refusal {
  readonly code: WebErrorCode;
  readonly message: string;
}

/**
 * A change request whose identity is credential-derived and whose expected versions all come from
 * the caller's captured `snapshot`. Fails with `invalid-recovery` when a replace base lacks the
 * live collection, or `invalid-request` when the base cannot create or the request is invalid.
 */
function change(
  snapshot: EditingBase,
  id: string,
  planner: string,
  payload: unknown,
  collection: string,
  expectation: Expectation,
): Result<Request> {
  const expected = expectedVersions[expectation](snapshot, collection);
  if (!expected.ok) return expected;
  return browserRequest(
    {
      workspace: baseWorkspace(snapshot),
      request: id,
      expected: expected.value,
      scope: expected.value.map((item) => item.key),
      intent: { kind: 'change', planner, payload },
    },
    { code: 'invalid-request', message: 'The diagram change could not be prepared' },
  );
}

/** The versions each expectation claims. Every expectation has a rule (checked by the type). */
const expectedVersions: Readonly<
  Record<Expectation, (base: EditingBase, collection: string) => Result<readonly ExpectedVersion[]>>
> = Object.freeze({ create: createVersions, replace: replaceVersions });

/**
 * A new collection must be absent, under the live catalog records. Fails with `invalid-request`
 * when the base is a captured collection, which carries no catalog.
 */
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
  return { ok: true, value: [{ key, version: 'absent' }, ...catalogVersions(base)] };
}

/** A replaced collection must still have the version the base captured. Fails with `invalid-recovery`. */
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

/**
 * Organisation changes acquire only the observed catalog's write scope; Library owns their
 * validation. Fails with `invalid-library-request`.
 */
function libraryRequest(
  snapshot: Snapshot,
  changes: readonly OrganisationChange[],
  id: string,
): Result<Request> {
  const expected = catalogVersions(snapshot);
  return browserRequest(
    {
      workspace: snapshot.workspace,
      request: id,
      expected,
      scope: expected.map((item) => item.key),
      intent: { kind: 'change', planner: 'library', payload: { changes } },
    },
    { code: 'invalid-library-request', message: 'The catalog change could not be prepared' },
  );
}

/** The versions of the live catalog records in `snapshot`. Cannot fail. */
function catalogVersions(snapshot: Snapshot): readonly ExpectedVersion[] {
  return snapshot.records
    .filter((item) => item.key.kind === 'catalog' && !item.deleted)
    .map((item) => ({ key: item.key, version: item.version }));
}

/**
 * The undo or redo request for Authoring's history status, or `null` when there is nothing to undo
 * or redo. Fails with `invalid-history` when the status or the request is invalid.
 */
function history(
  input: unknown,
  direction: 'undo' | 'redo',
  id: string,
): Result<Request | null> {
  const checked = historyStatusSchema.safeParse(input);
  if (!checked.success) return failure('invalid-history', 'History status is invalid');
  return historyRequest(checked.data, direction, id);
}

/** Inverse requests use the selected target's exact snapshot and never claim reserved history scope. */
function historyRequest(
  status: HistoryStatus,
  direction: 'undo' | 'redo',
  id: string,
): Result<Request | null> {
  const action = status[direction];
  if (action === null) return { ok: true, value: null };
  return browserRequest(
    {
      workspace: status.workspace,
      request: id,
      scope: action.scope,
      expected: action.expected,
      intent: { kind: direction, transaction: action.transaction },
    },
    { code: 'invalid-history', message: 'History request is invalid' },
  );
}

/** The actor of every request this browser builds. */
const humanBrowser = Object.freeze({ id: 'human:browser', kind: 'human' });

/**
 * `parts` as a version 1 request from the human browser with no assets, checked with Authoring's
 * schema. Fails with `refusal` when the schema rejects it.
 */
function browserRequest(
  parts: RequestParts,
  refusal: Refusal,
): Result<Request> {
  const parsed = requestSchema.safeParse({ ...parts, version: 1, actor: humanBrowser, assets: [] });
  if (!parsed.success) return failure(refusal.code, refusal.message);
  return { ok: true, value: parsed.data };
}

/** The collection printed as DSL by Language. Fails with `source-unavailable`, keeping Language's failure. */
function printSource(
  language: Pick<Language, 'print'>,
  collection: Collection,
): Result<string> {
  const result = language.print({ collection, scope: { kind: 'all' } });
  if (!result.ok)
    return failure(
      'source-unavailable',
      'Language could not print this collection',
      languageFailure(result.error),
    );
  return { ok: true, value: result.value.source };
}

/**
 * Human starter content is ordinary readable DSL, admitted through the same Language and Authoring
 * path as agent source. Cannot fail.
 */
function newSource(
  id: string,
  title: string,
): string {
  return `canvas 1\ncollection @${id} ${JSON.stringify(title)} theme=paper {\n  node @start start "Start" {}\n  node @step step "Describe the next step" {}\n  node @end end "Done" {}\n  wire @first @start -> @step "begin"\n  wire @next @step -> @end "complete"\n  section @process "Process" mode=flow layout=flow direction=right {\n    show @start @step @end\n    connect @first @next\n  }\n}`;
}
