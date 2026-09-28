/*
 * Request builders: the browser's Authoring requests (Model change, DSL, Library catalog, undo and
 * redo) built from a base the caller captured and a request ID the caller took from the ID source,
 * and the DSL text a source request carries. The actor and planners come from the request identity
 * checked at composition. Pure apart from the Language printer supplied at composition; nothing is
 * sent here. Every builder answers a `Result` and never throws; the caller that sends owns recovery.
 */
import { recordId, requestSchema, historyStatusSchema } from '@novakai/canvas-authoring';
import type { HistoryStatus } from '@novakai/canvas-authoring';
import type { Language } from '@novakai/canvas-language';
import type { OrganisationChange } from '@novakai/canvas-library';
import type {
  PlannerKind,
  RequestBuilders,
  RequestIdentity,
} from '../../contract/ports/request-builders.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { languageFailure } from '../../contract/foreign-failures.js';
import type { WebErrorCode } from '../../contract/records/error-codes.js';
import type { EditingBase } from '../../contract/records/editor-recovery.js';
import type {
  Collection,
  ReadVersion,
  RecordKey,
  Request,
  Snapshot,
} from '../../contract/records/owners.js';
import type { CollectionId, Direction, RequestId } from '../../contract/brands.js';
import { baseWorkspace, collectionRecord } from '../../contract/api.js';

/**
 * The request builders. Every request names `identity`'s actor, and each change names its
 * planner from `identity`. Language printing is supplied at composition, so this adapter does not
 * import a sibling. Each builder's failure codes are named on `RequestBuilders`.
 */
export function createRequestBuilders(
  language: Pick<Language, 'print'>,
  identity: RequestIdentity,
): RequestBuilders {
  return {
    model: (base, collection, changes, request) =>
      change(identity, {
        base,
        collection,
        request,
        planner: 'model',
        payload: { collection, changes },
        expectation: 'replace',
      }),
    dsl: (base, collection, source, mode, request) =>
      change(identity, {
        base,
        collection,
        request,
        planner: 'dsl',
        payload: { source, mode },
        expectation: mode,
      }),
    library: (snapshot, changes, request) => libraryRequest(identity, snapshot, changes, request),
    history: (input, direction, request) => history(identity, input, direction, request),
    source: (collection) => printSource(language, collection),
    newSource,
  };
}

/** Whether a change creates the collection or replaces its live record. */
type Expectation = 'create' | 'replace';

/** One change request: the collection it writes, the base it expects, its planner and payload. */
interface ChangeInput {
  readonly base: EditingBase;
  readonly collection: CollectionId;
  readonly request: RequestId;
  readonly planner: PlannerKind;
  readonly payload: unknown;
  readonly expectation: Expectation;
}

/** What differs between the browser's requests; `browserRequest` adds the rest. */
interface RequestParts {
  readonly workspace: Request['workspace'];
  readonly request: RequestId;
  readonly expected: readonly ReadVersion[];
  readonly scope: readonly RecordKey[];
  readonly intent: unknown;
}

/** The failure a builder answers when Authoring's schema rejects its request. */
interface Refusal {
  readonly code: WebErrorCode;
  readonly message: string;
}

/**
 * A change request whose expected versions all come from the caller's captured base. Fails with
 * `invalid-recovery` when a replace base lacks the live collection, or `invalid-request` when the
 * base cannot create or the request is invalid.
 */
function change(
  identity: RequestIdentity,
  input: ChangeInput,
): Result<Request> {
  const expected = expectedVersions[input.expectation](input.base, input.collection);
  if (!expected.ok) return expected;
  const planner = identity.planners[input.planner];
  return browserRequest(
    identity,
    {
      workspace: baseWorkspace(input.base),
      request: input.request,
      expected: expected.value,
      scope: expected.value.map((item) => item.key),
      intent: { kind: 'change', planner, payload: input.payload },
    },
    { code: 'invalid-request', message: 'The diagram change could not be prepared' },
  );
}

/** The versions each expectation claims. Every expectation has a rule (checked by the type). */
const expectedVersions: Readonly<
  Record<
    Expectation,
    (base: EditingBase, collection: CollectionId) => Result<readonly ReadVersion[]>
  >
> = Object.freeze({ create: createVersions, replace: replaceVersions });

/**
 * A new collection must be absent, under the live catalog records. Fails with `invalid-request`
 * when the base is a captured collection, which carries no catalog, or when the collection ID is
 * not a valid Authoring record ID.
 */
function createVersions(
  base: EditingBase,
  collection: CollectionId,
): Result<readonly ReadVersion[]> {
  if ('record' in base)
    return failure(
      'invalid-request',
      'A captured collection cannot be used to create a collection',
    );
  const key = newCollectionKey(collection);
  if (!key.ok) return key;
  return { ok: true, value: [{ key: key.value, version: 'absent' }, ...catalogVersions(base)] };
}

/** The record key of a new collection. Fails with `invalid-request` when Authoring rejects the ID. */
function newCollectionKey(collection: CollectionId): Result<RecordKey> {
  const id = recordId.safeParse(collection);
  if (!id.success)
    return failure('invalid-request', 'The new collection ID is not a valid record ID');
  return { ok: true, value: { kind: 'collection', id: id.data } };
}

/** A replaced collection must still have the version the base captured. Fails with `invalid-recovery`. */
function replaceVersions(
  base: EditingBase,
  collection: CollectionId,
): Result<readonly ReadVersion[]> {
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
  identity: RequestIdentity,
  snapshot: Snapshot,
  changes: readonly OrganisationChange[],
  request: RequestId,
): Result<Request> {
  const expected = catalogVersions(snapshot);
  const planner = identity.planners.library;
  return browserRequest(
    identity,
    {
      workspace: snapshot.workspace,
      request,
      expected,
      scope: expected.map((item) => item.key),
      intent: { kind: 'change', planner, payload: { changes } },
    },
    { code: 'invalid-library-request', message: 'The catalog change could not be prepared' },
  );
}

/** The versions of the live catalog records in `snapshot`. Cannot fail. */
function catalogVersions(snapshot: Snapshot): readonly ReadVersion[] {
  return snapshot.records
    .filter((item) => item.key.kind === 'catalog' && !item.deleted)
    .map((item) => ({ key: item.key, version: item.version }));
}

/**
 * The undo or redo request for Authoring's history status, or `null` when there is nothing to undo
 * or redo. Fails with `invalid-history` when the status or the request is invalid.
 */
function history(
  identity: RequestIdentity,
  input: unknown,
  direction: Direction,
  request: RequestId,
): Result<Request | null> {
  const checked = historyStatusSchema.safeParse(input);
  if (!checked.success) return failure('invalid-history', 'History status is invalid');
  return historyRequest(identity, checked.data, direction, request);
}

/** Inverse requests use the selected target's exact snapshot and never claim reserved history scope. */
function historyRequest(
  identity: RequestIdentity,
  status: HistoryStatus,
  direction: Direction,
  request: RequestId,
): Result<Request | null> {
  const action = status[direction];
  if (action === null) return { ok: true, value: null };
  return browserRequest(
    identity,
    {
      workspace: status.workspace,
      request,
      scope: action.scope,
      expected: action.expected,
      intent: { kind: direction, transaction: action.transaction },
    },
    { code: 'invalid-history', message: 'History request is invalid' },
  );
}

/**
 * `parts` as a version 1 request from `identity`'s actor with no assets, checked with Authoring's
 * schema. Fails with `refusal` when the schema rejects it.
 */
function browserRequest(
  identity: RequestIdentity,
  parts: RequestParts,
  refusal: Refusal,
): Result<Request> {
  const parsed = requestSchema.safeParse({
    ...parts,
    version: 1,
    actor: identity.actor,
    assets: [],
  });
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
  id: CollectionId,
  title: string,
): string {
  return `canvas 1\ncollection @${id} ${JSON.stringify(title)} theme=paper {\n  node @start start "Start" {}\n  node @step step "Describe the next step" {}\n  node @end end "Done" {}\n  wire @first @start -> @step "begin"\n  wire @next @step -> @end "complete"\n  section @process "Process" mode=flow layout=flow direction=right {\n    show @start @step @end\n    connect @first @next\n  }\n}`;
}
