import type {
  ApiCall,
  ApiRouter,
  RouteOutcome,
  WireOutcome,
} from '../../contract/records/transport/protocol.js';
import type { Snapshot } from '@novakai/canvas-authoring';
import type { RouterBindings } from '../../contract/records/transport/server.js';
import { httpBodyLimit } from '../../contract/records/transport/http.js';
import { failure } from '../../contract/errors.js';
import type { Result } from '../../contract/errors.js';
import type { ResourceCommands } from '../../contract/records/presets/preparation.js';
import { historyVersionsOnly } from '../../contract/api.js';
type ResourceHandler = (input: unknown) => Promise<WireOutcome>;
/** Read one current collection without reinterpreting its semantic shape; Language/Presentation validate before their use. */
async function source(
  call: ApiCall,
  owners: RouterBindings,
): Promise<WireOutcome> {
  const scope = sourceScope(call.query);
  if (!scope.ok) return scope;
  return readSourceRecord(call, owners, scope.value);
}

async function readSourceRecord(
  call: ApiCall,
  owners: RouterBindings,
  scope: import('@novakai/canvas-language').Scope,
): Promise<WireOutcome> {
  const snapshot = await owners.session.read();
  if (!snapshot.ok) return snapshot;
  const record = snapshot.value.records.find(
    (item) => item.key.kind === 'collection' && item.key.id === call.query.id && !item.deleted,
  );
  if (!record) return failure('not-found', 'collection', 'Collection was not found');
  return owners.source.print(record.value, scope);
}

function sourceScope(
  query: Readonly<Record<string, string>>,
): Result<import('@novakai/canvas-language').Scope> {
  const section = query.section;
  const object = query.object;
  if (bothScopes(section, object))
    return failure('invalid-input', 'scope', 'Use either section or object, not both');
  const selected = section === undefined ? object : section;
  return validSourceScope(section, selected);
}

function bothScopes(
  section: string | undefined,
  object: string | undefined,
): boolean {
  return section !== undefined && object !== undefined;
}

function validSourceScope(
  section: string | undefined,
  selected: string | undefined,
): Result<import('@novakai/canvas-language').Scope> {
  const duplicate = duplicateScopeError(section, selected);
  if (duplicate !== undefined) return duplicate;
  return sourceScopeValue(section, selected);
}

function duplicateScopeError(
  section: string | undefined,
  selected: string | undefined,
): Result<import('@novakai/canvas-language').Scope> | undefined {
  return hasDuplicateScopeValue(section) || hasDuplicateScopeValue(selected)
    ? failure('invalid-input', 'scope', 'Each read scope query may be provided only once')
    : undefined;
}

function hasDuplicateScopeValue(value: string | undefined): boolean {
  return value?.includes('\u0000') ?? false;
}

function sourceScopeValue(
  section: string | undefined,
  id: string | undefined,
): Result<import('@novakai/canvas-language').Scope> {
  if (id === undefined) return { ok: true, value: { kind: 'all' } };
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))
    return failure('invalid-input', 'scope', 'Scope IDs must be non-empty canonical IDs');
  return sourceScopeChoice(section, id);
}

function sourceScopeChoice(
  section: string | undefined,
  id: string,
): Result<import('@novakai/canvas-language').Scope> {
  return section === undefined
    ? { ok: true, value: { kind: 'object', id } }
    : { ok: true, value: { kind: 'section', id } };
}
/** Mutation routes share the exact decoder and Authoring session; no route writes storage directly. */
async function mutate(
  call: ApiCall,
  owners: RouterBindings,
  preview: boolean,
): Promise<WireOutcome> {
  const admitted = owners.decoder.read(call.body, {
    caller: call.caller,
    metadata: call.metadata,
    generation: owners.generation,
    ingress: owners.admission,
  });
  if (!admitted.ok) return admitted;
  if (preview)
    return owners.session.prepare(admitted.value.request, call.signal, admitted.value.preview);
  return owners.session.apply(admitted.value.request, call.signal, admitted.value.options);
}
/** Authentication precedes body consumption in the server; resource routes share its bounded JSON policy. */
async function resource(
  call: ApiCall,
  handler: ResourceHandler,
): Promise<WireOutcome> {
  const policy = resourcePolicy(call);
  if (!policy.ok) return policy;
  return handler(policy.value);
}
/** Resource transport validates content type, size and JSON before invoking any owner operation. */
function resourcePolicy(call: ApiCall): WireOutcome {
  if (call.metadata.contentType.split(';')[0]?.trim() !== 'application/json')
    return failure('invalid-input', 'content-type', 'Use application/json');
  if (Buffer.byteLength(call.body) > httpBodyLimit)
    return failure('invalid-input', 'body', 'Request exceeds 24 MiB');
  return resourceJson(call.body);
}
/** JSON syntax is translated here; provider failures retain their own typed boundary or reach server recovery. */
function resourceJson(body: string): WireOutcome {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return failure('invalid-input', 'body', 'Expected valid resource JSON');
  }
}
/** Snapshot-bound semantic operations read current truth but remain mutation-free until Authoring apply. */
function semanticResource(
  owners: RouterBindings,
  operation: (commands: ResourceCommands, input: unknown, snapshot: Snapshot) => WireOutcome,
): ResourceHandler {
  return async (input) => {
    const snapshot = await owners.session.read();
    if (!snapshot.ok) return snapshot;
    return operation(owners.session.resources, input, snapshot.value);
  };
}
/** Fixed route registration keeps method/path dispatch separate from handler behavior; unsupported operations fail explicitly. */
export function createHttpRouter(owners: RouterBindings): ApiRouter {
  const freeze = semanticResource(owners, (commands, input, snapshot) =>
    commands.freeze(input, snapshot),
  );
  const prepare = semanticResource(owners, (commands, input, snapshot) =>
    commands.preparePreset(input, snapshot),
  );
  const instantiate = semanticResource(owners, (commands, input, snapshot) =>
    commands.instantiate(input, snapshot),
  );
  const routes: Readonly<Record<string, (call: ApiCall) => Promise<RouteOutcome>>> = {
    'POST /api/v1/resources/stage': (call) =>
      resource(call, (input) => owners.session.resources.stage(input)),
    'POST /api/v1/resources/restore': (call) =>
      resource(call, (input) => owners.session.resources.restore(input)),
    'POST /api/v1/resources/blob': (call) =>
      resource(call, async (input) => owners.session.resources.blob(input)),
    'POST /api/v1/resources/freeze': (call) => resource(call, freeze),
    'POST /api/v1/resources/prepare': (call) => resource(call, prepare),
    'POST /api/v1/resources/instantiate': (call) => resource(call, instantiate),
    'GET /api/v1/workspace': async (call) => {
      const read = await owners.session.read();
      if (!read.ok || call.query.history !== 'versions') return read;
      return { ok: true, value: historyVersionsOnly(read.value) };
    },
    'GET /api/v1/history': () => owners.session.history(),
    'GET /api/v1/installation': async () => ({
      ok: true,
      value: {
        fonts: owners.session.installation.fonts,
        tokens: owners.session.installation.tokens,
      },
    }),
    'GET /api/v1/language': async () => ({ ok: true, value: owners.source.describe() }),
    'GET /api/v1/identity': async () => ({
      ok: true,
      value: { workspace: owners.session.workspace },
    }),
    'GET /api/v1/source': (call) => source(call, owners),
    'GET /api/v1/render': (call) => owners.session.render(call.query.id ?? '', call.signal),
    'GET /api/v1/inspect': (call) => owners.session.inspect(call.query.id ?? '', call.signal),
    'GET /api/v1/receipt': (call) => owners.session.receipt(call.query.id),
    'POST /api/v1/authoring/preview': (call) => mutate(call, owners, true),
    'POST /api/v1/authoring/apply': (call) => mutate(call, owners, false),
    'POST /api/v1/export': (call) => exportRoute(call, owners),
  };
  return {
    invoke: async (call) => {
      const handler = routes[`${call.metadata.method} ${call.path}`];
      if (!handler)
        return failure('not-found', 'route', 'This method and API route are not available');
      return handler(call);
    },
  };
}

async function exportRoute(
  call: ApiCall,
  owners: RouterBindings,
): Promise<RouteOutcome> {
  const checked = resourcePolicy(call);
  if (!checked.ok) return checked;
  if (owners.exporter === undefined)
    return failure('unavailable', 'export', 'Export is unavailable in this service composition');
  return owners.exporter(checked.value, call.signal);
}
