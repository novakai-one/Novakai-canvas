/*
 * The `/api/v1` route table: one handler per `METHOD path`, each forwarding to the session facade,
 * the mutation decoder or the source readout. Pure over the injected owners; no route writes
 * storage, and Authoring owns commit and receipt recovery. The HTTP server authenticates before
 * `invoke`; a handler throw reaches its `receive`, which answers `unavailable` at `request`.
 */
import type {
  AdmittedMutation,
  ApiCall,
  ApiRouter,
  CommandDecoder,
  RouteOutcome,
  WireOutcome,
} from '../../contract/records/transport/protocol.js';
import type { HttpAdmission } from '../../contract/records/transport/http.js';
import type { Scope, Snapshot } from '../../contract/records/capabilities.js';
import type { ResourceCommands } from '../../contract/records/presets/preparation.js';
import type { WorkspaceSession } from '../../contract/types.js';
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { historyVersionsOnly } from '../session/history-versions.js';
import { sourceScope } from './source-scope.js';

/** Language's vocabulary and DSL printing, as the source routes read them. */
export interface SourceReadout {
  describe(): unknown;
  print(
    collection: unknown,
    scope?: Scope,
  ): Result<unknown>;
}

/** The owners the routes forward to. `generation` is the current transport generation. */
export interface RouteOwners {
  readonly session: Pick<
    WorkspaceSession,
    | 'workspace'
    | 'installation'
    | 'read'
    | 'history'
    | 'apply'
    | 'prepare'
    | 'receipt'
    | 'render'
    | 'inspect'
    | 'resources'
    | 'exportArtifact'
  >;
  readonly generation: string;
  readonly admission: Pick<HttpAdmission, 'mutation'>;
  readonly decoder: CommandDecoder;
  readonly source: SourceReadout;
}

type RouteHandler = (call: ApiCall) => Promise<RouteOutcome>;
type ResourceHandler = (input: unknown) => Promise<WireOutcome>;
/** Which Authoring step a mutation route runs. */
type MutationRoute = 'prepare' | 'apply';

/**
 * Binds the route table to the owners. `invoke` looks up `METHOD path` and runs its handler.
 * Fails with `not-found` at `route` when no handler matches; otherwise answers as the handler.
 */
export function createHttpRouter(owners: RouteOwners): ApiRouter {
  const routes = routeTable(owners);
  return {
    invoke: async (call) => {
      const handler = routes[`${call.metadata.method} ${call.path}`];
      if (!handler) return noRoute();
      return handler(call);
    },
  };
}

/** The frozen table of every API route. Handler failures are named on each handler below. */
function routeTable(owners: RouteOwners): Readonly<Record<string, RouteHandler>> {
  const freeze = semanticResource(owners, (commands, input, snapshot) =>
    commands.freeze(input, snapshot),
  );
  const prepare = semanticResource(owners, (commands, input, snapshot) =>
    commands.preparePreset(input, snapshot),
  );
  const instantiate = semanticResource(owners, (commands, input, snapshot) =>
    commands.instantiate(input, snapshot),
  );
  return Object.freeze({
    'POST /api/v1/resources/stage': (call) =>
      resource(call, (input) => owners.session.resources.stage(input)),
    'POST /api/v1/resources/restore': (call) =>
      resource(call, (input) => owners.session.resources.restore(input)),
    'POST /api/v1/resources/blob': (call) =>
      resource(call, async (input) => owners.session.resources.blob(input)),
    'POST /api/v1/resources/freeze': (call) => resource(call, freeze),
    'POST /api/v1/resources/prepare': (call) => resource(call, prepare),
    'POST /api/v1/resources/instantiate': (call) => resource(call, instantiate),
    'GET /api/v1/workspace': (call) => workspace(call, owners),
    'GET /api/v1/history': () => owners.session.history(),
    'GET /api/v1/installation': async () =>
      success({
        fonts: owners.session.installation.fonts,
        tokens: owners.session.installation.tokens,
      }),
    'GET /api/v1/language': async () => success(owners.source.describe()),
    'GET /api/v1/identity': async () => success({ workspace: owners.session.workspace }),
    'GET /api/v1/source': (call) => source(call, owners),
    'GET /api/v1/render': (call) => owners.session.render(call.query.id ?? '', call.signal),
    'GET /api/v1/inspect': (call) => owners.session.inspect(call.query.id ?? '', call.signal),
    'GET /api/v1/receipt': (call) => owners.session.receipt(call.query.id),
    'POST /api/v1/authoring/preview': (call) => mutate(call, owners, 'prepare'),
    'POST /api/v1/authoring/apply': (call) => mutate(call, owners, 'apply'),
    'POST /api/v1/export': (call) => exportRoute(call, owners),
  });
}

/**
 * The workspace snapshot; with `?history=versions`, history contents are stripped and navigation
 * kept. Authoring's read failures pass through.
 */
async function workspace(
  call: ApiCall,
  owners: RouteOwners,
): Promise<WireOutcome> {
  const read = await owners.session.read();
  if (!read.ok || call.query.history !== 'versions') return read;
  return success(historyVersionsOnly(read.value));
}

/**
 * One current collection printed as DSL for the `section` or `object` scope (all when neither).
 * Fails with `invalid-input` at `scope` as `sourceScope` (source-scope.ts), and as
 * `readSourceRecord`.
 */
async function source(
  call: ApiCall,
  owners: RouteOwners,
): Promise<WireOutcome> {
  const scope = sourceScope(call.query);
  if (!scope.ok) return scope;
  return readSourceRecord(call, owners, scope.value);
}

/**
 * Reads the live collection named by `?id` and prints it without reinterpreting its shape;
 * Language validates it. Fails with `not-found` at `collection` when it is absent or deleted.
 * Authoring's read failures and the readout's `invalid-input` at `source` pass through.
 */
async function readSourceRecord(
  call: ApiCall,
  owners: RouteOwners,
  scope: Scope,
): Promise<WireOutcome> {
  const snapshot = await owners.session.read();
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === call.query.id && !item.deleted,
  );
  if (!record) return failure('not-found', 'collection', 'Collection was not found');
  return owners.source.print(record.value, scope);
}

/**
 * Decodes the mutation envelope and runs it through the session; no route writes storage directly.
 * Fails as the decoder: `invalid-input` at `content-type`, `body` or `request`, `conflict` at
 * `generation`, `unauthorized` at `actor` or `intent.planner`. Authoring outcomes pass through.
 */
async function mutate(
  call: ApiCall,
  owners: RouteOwners,
  route: MutationRoute,
): Promise<WireOutcome> {
  const admitted = owners.decoder.read(call.body, {
    caller: call.caller,
    metadata: call.metadata,
    generation: owners.generation,
    ingress: owners.admission,
  });
  if (!admitted.ok) return admitted;
  return runMutation(admitted.value, call.signal, owners, route);
}

/** `prepare` previews or plans the request; `apply` commits it. */
function runMutation(
  mutation: AdmittedMutation,
  signal: AbortSignal,
  owners: RouteOwners,
  route: MutationRoute,
): Promise<WireOutcome> {
  switch (route) {
    case 'prepare':
      return owners.session.prepare(mutation.request, signal, mutation.preview);
    case 'apply':
      return owners.session.apply(mutation.request, signal, mutation.options);
    default:
      return unsupported(route);
  }
}

/**
 * The failure for a mutation route of no known kind. The route table makes this unreachable; the
 * `never` type proves both routes are handled.
 */
async function unsupported(route: never): Promise<WireOutcome> {
  void route;
  return noRoute();
}

/** `not-found` at `route`: no handler serves this method and path. */
function noRoute(): WireOutcome {
  return failure('not-found', 'route', 'This method and API route are not available');
}

/**
 * Runs a resource handler on the admitted JSON body. Fails as `resourcePolicy`; handler outcomes
 * pass through. The server authenticates before reading the body.
 */
async function resource(
  call: ApiCall,
  handler: ResourceHandler,
): Promise<WireOutcome> {
  const policy = resourcePolicy(call);
  if (!policy.ok) return policy;
  return handler(policy.value);
}

/**
 * The parsed body. Fails with `invalid-input` at `content-type` unless the type is
 * `application/json`, and at `body` when it exceeds the transport limit or is not JSON.
 */
function resourcePolicy(call: ApiCall): WireOutcome {
  if (call.metadata.contentType.split(';')[0]?.trim() !== 'application/json')
    return failure('invalid-input', 'content-type', 'Use application/json');
  if (new TextEncoder().encode(call.body).byteLength > httpBodyLimit)
    return failure('invalid-input', 'body', 'Request exceeds 24 MiB');
  return resourceJson(call.body);
}

/** The body as JSON. Fails with `invalid-input` at `body` on a syntax error. */
function resourceJson(body: string): WireOutcome {
  try {
    const value: unknown = JSON.parse(body);
    return success(value);
  } catch {
    return failure('invalid-input', 'body', 'Expected valid resource JSON');
  }
}

/**
 * A resource handler that reads the current snapshot first. The operation stays mutation-free
 * until an Authoring apply. Authoring's read failures pass through.
 */
function semanticResource(
  owners: RouteOwners,
  operation: (commands: ResourceCommands, input: unknown, snapshot: Snapshot) => WireOutcome,
): ResourceHandler {
  return async (input) => {
    const snapshot = await owners.session.read();
    if (!snapshot.ok) return snapshot;
    return operation(owners.session.resources, input, snapshot.value);
  };
}

/** Exports the admitted JSON body. Fails as `resourcePolicy`; export outcomes pass through. */
async function exportRoute(
  call: ApiCall,
  owners: RouteOwners,
): Promise<RouteOutcome> {
  const checked = resourcePolicy(call);
  if (!checked.ok) return checked;
  return owners.session.exportArtifact(checked.value, call.signal);
}
