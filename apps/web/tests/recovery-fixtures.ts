import { folderIdSchema } from '@novakai/canvas-library';
import { createLibraryReader } from '../adapters/readers/library-reader.js';
import { createLibraryController } from '../adapters/sessions/library-session.js';
import { createWireSession } from '../contract/index.js';
import { readWireDrafts } from '../adapters/readers/wire-reader.js';
import { createInspectorSession } from '../contract/index.js';
import { readInspectorDrafts } from '../adapters/readers/inspector-reader.js';
import { createDefinitionSession } from '../adapters/sessions/definition-session.js';
import { readDefinitionDrafts } from '../adapters/readers/definition-reader.js';
import { createSourceController } from '../adapters/sessions/source-session.js';
import { assert } from 'vitest';
import { snapshotSchema, requestSchema, receiptSchema } from '@novakai/canvas-authoring';
import { validate, plan, stage } from '@novakai/canvas-model';
import { createLanguage } from '@novakai/canvas-language';
import { createCanvas } from '@novakai/canvas-canvas';
import { readDiagram, createSceneAdmission } from '../adapters/readers/diagram-reader.js';
import { createCanvasSessions } from '../adapters/sessions/canvas-session.js';
import type { ServiceClient } from '../contract/ports/client.js';
import type { DraftRetention } from '../contract/ports/workspace.js';
import type { Request, Receipt, TransportResponse } from '../contract/records/owners.js';
import type { SubmissionReaders } from '../contract/records/submission.js';
import type { Result } from '../contract/index.js';
import { failure } from '../contract/index.js';
import { createWorkspaceController } from '../adapters/sessions/workspace-session.js';
import { createWorkspaceInputs } from '../adapters/edge/workspace-inputs.js';
import { createSubmissionSession } from '../adapters/sessions/submission-session.js';
import { createSubmissionReaders } from '../adapters/readers/submission-readers.js';

/** Real owner schemas admit canonical fixtures; test transport scheduling is explicitly controlled. */
export function snapshot(revision: number) {
  const document = validate({
    schemaVersion: 1,
    id: 'demo',
    revision,
    title: 'Demo',
    theme: {
      id: 'paper',
      version: '1.0.0',
      digest: `sha256:${'a'.repeat(64)}`,
      roles: ['neutral'],
    },
    arrangement: { algorithm: 'grid' },
    objects: [],
    relationships: [],
    sections: [],
  });
  assert(document.ok, JSON.stringify(document));
  return snapshotSchema.parse({
    workspace: 'test-workspace',
    sequence: revision + 1,
    records: [
      {
        key: { kind: 'collection', id: 'demo' },
        version: revision,
        value: document.value,
        deleted: false,
        resources: [],
      },
    ],
  });
}
/** Receipt fixtures express the actual committed version separately from the submitted precondition. */
export function receipt(
  request: Request,
  revision: number,
): Receipt {
  return receiptSchema.parse({
    request: request.request,
    fingerprint: 'a'.repeat(64),
    sequence: revision + 1,
    versions: [{ key: { kind: 'collection', id: 'demo' }, version: revision }],
    outcome: {
      status: 'committed',
      transaction: request.request,
      pins: {},
      diff: {},
      warnings: [],
    },
  });
}
/** Test service envelope contains unknown owner payload, exactly as the browser transport does. */
export function response(
  value: unknown,
  generation = 'generation-one',
): Result<TransportResponse> {
  return { ok: true, value: { version: 1, generation, outcome: { ok: true, value } } };
}
/** JSON round trips model browser persistence rather than sharing live references with session state. */
export function memoryRetention(): DraftRetention {
  const values = new Map<string, string>();
  return {
    read: (key) => {
      const raw = values.get(key);
      return { ok: true, value: raw === undefined ? null : JSON.parse(raw) };
    },
    write: (key, value) => {
      values.set(key, JSON.stringify(value));
      return { ok: true, value: undefined };
    },
    remove: (key) => {
      values.delete(key);
      return { ok: true, value: undefined };
    },
  };
}
/** Recovery harness uses real Language and Canvas owners; only transport delivery and browser retention are controlled. */
export function controller(
  client: ServiceClient,
  retention: DraftRetention,
) {
  const canvas = createCanvas({ sceneAdmission: createSceneAdmission() });
  let identity = 0;
  const inputs = workspaceInputs();
  return createWorkspaceController({
    client,
    navigation: {
      current: () => ({ ok: true, value: null }),
      opened: () => ({ ok: true, value: undefined }),
    },
    panels: { open: () => undefined, restore: () => undefined },
    inputs,
    library: (callbacks) =>
      createLibraryController({
        retention,
        reader: createLibraryReader(),
        now: () => 1,
        nextFolderId: () => folderIdSchema().parse('folder'),
        ...callbacks,
      }),
    wires: (callbacks) => createWireSession({ retention, read: readWireDrafts, ...callbacks }),
    inspector: (callbacks) =>
      createInspectorSession({ retention, read: readInspectorDrafts, ...callbacks }),
    definitions: (callbacks) =>
      createDefinitionSession({ retention, read: readDefinitionDrafts, ...callbacks }),
    source: (callbacks) =>
      createSourceController({
        inputs,
        retention,
        nextId: () => `request-${++identity}`,
        ...callbacks,
      }),
    sessions: createCanvasSessions(canvas, () => ({ width: 1000, height: 700 })),
    edits: { plan: () => failure('unused', 'No gesture is planned') },
    nextId: () => `request-${++identity}`,
    submissions: (callbacks) =>
      createSubmissionSession({
        client,
        retention,
        readers: createSubmissionReaders(inputs),
        ...callbacks,
      }),
  });
}
/** Submission readers bound to the real workspace snapshot reader, exactly as composition binds them. */
export function submissionReaders(): SubmissionReaders {
  return createSubmissionReaders(workspaceInputs());
}
/** Controlled response completion exposes the newer-typing race without clocks or timers. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise is not initialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
/** Submitted envelope is checked instead of cast to the expected request shape. */
export function submitted(input: unknown): Request {
  assert(typeof input === 'object' && input !== null && 'request' in input);
  return requestSchema.parse(input.request);
}
/** Real Language and Model owners check every transported snapshot, diagram and request. */
function workspaceInputs() {
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  return createWorkspaceInputs(readDiagram, language);
}
