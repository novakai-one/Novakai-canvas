import { assert, expect, it, vi } from 'vitest';

// Each test boots a real in-process workspace service; that can exceed the 5s default under load.
const slow = { timeout: 30_000 };
import type { ServiceClient } from '../contract/ports/client.js';
import type { Request, TransportResponse } from '../contract/records/owners.js';
import type { Result } from '../contract/index.js';
import type { DraftRetention } from '../contract/ports/workspace.js';
import type { WorkspaceSession } from '@novakai/canvas-service';
import { definitionDraftId, failure, planPaletteDrop } from '../contract/index.js';
import { controller, memoryRetention, submitted } from './recovery-fixtures.js';
import { workspaceFixture, request, source } from './host-workspace-fixture.js';

/** The owner refusal a layout failure produces; its message is raw JSON on purpose. */
function refusal(): Result<TransportResponse> {
  return envelope({
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'changes/0',
      message: '{"code":"unroutable-leg"}',
      recovery: 'Nothing was changed.',
    },
  });
}
function envelope(outcome: unknown): Result<TransportResponse> {
  return {
    ok: true,
    value: { version: 1, generation: 'generation-one', outcome } as TransportResponse,
  };
}
/** Real in-process service; only the next `refuse.count` applies are answered with a refusal instead. */
function serviceClient(
  service: WorkspaceSession,
  sent: Request[],
  refuse: { count: number },
): ServiceClient {
  const signal = new AbortController().signal;
  const reads: Record<string, (query: URLSearchParams) => Promise<unknown>> = {
    '/api/v1/workspace': () => service.read(),
    '/api/v1/history': () => service.history(),
    '/api/v1/render': (query) => service.render(query.get('id') ?? '', signal),
    '/api/v1/receipt': (query) => service.receipt(query.get('id')),
  };
  return {
    get: async (path) => {
      const [route = '', query = ''] = path.split('?');
      const read = reads[route];
      assert(read, `unexpected GET ${route}`);
      return envelope(await read(new URLSearchParams(query)));
    },
    post: async (_path, input) => {
      const body = submitted(input);
      sent.push(body);
      if (refuse.count-- > 0) return refusal();
      return envelope(await service.apply(body, signal));
    },
    changes: () => () => undefined,
  };
}
async function withSample(test: (service: WorkspaceSession) => Promise<void>): Promise<void> {
  const fixture = await workspaceFixture();
  try {
    const before = await fixture.session.read();
    assert(before.ok);
    const created = await fixture.session.apply(
      request(before.value, 'sample', 'sample', 'dsl', { source, mode: 'create' }, true),
      new AbortController().signal,
    );
    assert(created.ok, JSON.stringify(created));
    await test(fixture.session);
  } finally {
    await fixture.close();
  }
}
async function opened(
  client: ServiceClient,
  retention: DraftRetention = memoryRetention(),
) {
  const human = controller(client, retention);
  await human.start();
  await human.open('sample');
  assert(human.getSnapshot().active !== null, JSON.stringify(human.getSnapshot().problem));
  return human;
}
const module = {
  section: 'process',
  group: null,
  kind: 'module' as const,
  label: 'Parser',
  reuseObject: null,
};

it(
  'a refused creation releases its request so the Add form is editable and the next add is a new request',
  slow,
  async () => {
    await withSample(async (service) => {
      const sent: Request[] = [];
      const human = await opened(serviceClient(service, sent, { count: 1 }));
      expect(await human.addObject(module)).toMatchObject({ ok: false });
      expect(human.getSnapshot().creation.busy).toBe(false);
      expect(human.getSnapshot().status).not.toContain('{');
      expect(await human.addObject(module)).toMatchObject({ ok: true });
      expect(sent).toHaveLength(2);
      expect(sent[1]?.request).not.toBe(sent[0]?.request);
      human.dispose();
    });
  },
);

it('shows one refusal at a time and clears it when a later edit starts', slow, async () => {
  await withSample(async (service) => {
    const sent: Request[] = [];
    const human = await opened(serviceClient(service, sent, { count: 2 }));
    await human.addObject(module);
    await human.addObject({ ...module, label: 'Lexer' });
    const refused = human.getSnapshot().pending;
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ state: 'rejected', request: { request: sent[1]?.request } });
    expect(await human.addObject({ ...module, label: 'Emitter' })).toMatchObject({ ok: true });
    expect(human.getSnapshot().pending).toEqual([]);
    // The answer's snapshot starts the re-render at once; Saved shows once it settles.
    await vi.waitFor(() => expect(human.getSnapshot().status).toBe('Saved'));
    human.dispose();
  });
});

it('blocks palette drops on tree sections with a plain message and sends nothing', () => {
  const sections = [
    { id: 'outline', mode: 'tree', title: 'Outline' },
    { id: 'process', mode: 'flow', title: 'Process' },
  ];
  const tree = planPaletteDrop(sections, 'module', { section: 'outline', group: null });
  assert(tree.kind === 'refuse');
  expect(tree.problem.message).toBe(
    "Modules can't be dropped into a tree. Drop it into a diagram section instead.",
  );
  expect(planPaletteDrop(sections, 'module', { section: 'process', group: null })).toMatchObject({
    kind: 'add',
    draft: { section: 'process', kind: 'module', label: 'New module', reuseObject: null },
  });
  expect(planPaletteDrop(sections, 'unknown', { section: 'process', group: null })).toEqual({
    kind: 'ignore',
  });
});

it(
  'closing the error bar clears the problem and the refused request, and resets the status',
  slow,
  async () => {
    await withSample(async (service) => {
      const human = await opened(serviceClient(service, [], { count: 1 }));
      await human.addObject(module);
      expect(human.getSnapshot().problem).not.toBeNull();
      expect(human.getSnapshot().pending).toMatchObject([{ state: 'rejected' }]);
      expect(human.getSnapshot().status).not.toBe('Saved');
      human.dismissProblem();
      expect(human.getSnapshot().problem).toBeNull();
      expect(human.getSnapshot().pending).toEqual([]);
      expect(human.getSnapshot().status).toBe('Saved');
      human.dispose();
    });
  },
);

it('opening another collection empties the Add forms and clears their error', slow, async () => {
  await withSample(async (service) => {
    const before = await service.read();
    assert(before.ok);
    const other = source.replace('@sample "Sample"', '@other "Other"');
    const payload = { source: other, mode: 'create' };
    const signal = new AbortController().signal;
    await service.apply(request(before.value, 'other', 'other', 'dsl', payload, true), signal);
    const human = await opened(serviceClient(service, [], { count: 1 }));
    await human.addObject(module);
    expect(human.getSnapshot().creation).toMatchObject({ problem: expect.any(String) });
    expect(human.getSnapshot().creation.object.label).toBe('Parser');
    await human.open('other');
    expect(human.getSnapshot().active?.document.collection.id).toBe('other');
    expect(human.getSnapshot().creation).toMatchObject({ problem: null, object: { label: '' } });
    human.dispose();
  });
});

it('a refused definition stays editable after reload', slow, async () => {
  await withSample(async (service) => {
    const retention = memoryRetention();
    const sent: Request[] = [];
    const human = await opened(serviceClient(service, sent, { count: 1 }), retention);
    const active = human.getSnapshot().active;
    assert(active !== null);
    const created = human.definitions.create(
      { base: active.base, generation: active.generation, collection: active.document.collection },
      {
        id: definitionDraftId('definition-actor'),
        label: 'Actor',
        expression: { kind: 'literal', value: 'Human' },
      },
    );
    assert(created.ok, JSON.stringify(created));
    const key = human.definitions.getSnapshot().drafts[0]?.key;
    assert(key !== undefined);
    await human.definitions.apply(key);
    expect(sent).toHaveLength(1);
    expect(human.getSnapshot().pending).toMatchObject([{ state: 'rejected' }]);
    human.dispose();

    const reloaded = await opened(serviceClient(service, sent, { count: 0 }), retention);
    expect(reloaded.getSnapshot().pending).toEqual([]);
    const drafts = reloaded.definitions.getSnapshot();
    expect(drafts.pending).toEqual([]);
    expect(drafts.drafts[0]).toMatchObject({ key });
    expect(drafts.drafts[0]?.request).toBeUndefined();
    expect(await reloaded.definitions.apply(key)).toMatchObject({ ok: true });
    reloaded.dispose();
  });
});

it('"Draft not applied" follows the unapplied forms of the open collection', slow, async () => {
  await withSample(async (service) => {
    await addOtherCollection(service);
    const human = await opened(serviceClient(service, [], { count: 1 }));
    const active = human.getSnapshot().active;
    assert(active !== null);
    const collection = active.document.collection;
    const object = collection.objects[0];
    assert(object !== undefined);
    const selection = { base: active.base, generation: active.generation, collection, object };
    assert(human.inspector.edit(selection, { kind: 'label', value: 'Renamed' }).ok);
    const key = human.inspector.getSnapshot().drafts[0]?.key;
    assert(key !== undefined);
    await human.inspector.apply(key);
    expect(human.getSnapshot().problem).not.toBeNull();
    human.dismissProblem();
    expect(human.getSnapshot().problem).toBeNull();
    expect(human.getSnapshot().status).toBe('Draft not applied');
    await human.open('other');
    expect(human.getSnapshot().status).toBe('Saved');
    await human.open('sample');
    expect(human.getSnapshot().status).toBe('Draft not applied');
    assert(human.inspector.discard(key).ok);
    expect(human.getSnapshot().status).toBe('Saved');
    human.dispose();
  });
});

it('a save check that settles the request clears "could not be confirmed"', slow, async () => {
  await withSample(async (service) => {
    const real = serviceClient(service, [], { count: 0 });
    const lost: ServiceClient = {
      ...real,
      post: async () =>
        failure('connection-uncertain', 'The service response could not be confirmed'),
    };
    const human = await opened(lost);
    await human.addObject(module);
    expect(human.getSnapshot().problem).toMatchObject({ code: 'connection-uncertain' });
    const id = human.getSnapshot().pending[0]?.request.request;
    assert(id !== undefined);
    await human.reconcileRequest(id);
    expect(human.getSnapshot().pending).toMatchObject([{ state: 'retryable' }]);
    expect(human.getSnapshot().problem).toBeNull();
    expect(human.getSnapshot().creation.problem).toBeNull();
    human.dispose();
  });
});

it('"could not be confirmed" stays while another request is still unconfirmed', slow, async () => {
  await withSample(async (service) => {
    await addOtherCollection(service);
    const real = serviceClient(service, [], { count: 0 });
    const human = await opened({
      ...real,
      post: async () =>
        failure('connection-uncertain', 'The service response could not be confirmed'),
    });
    await human.addObject(module);
    await human.open('other');
    await human.addGroup({ section: 'process', title: 'Stage' });
    const ids = human.getSnapshot().pending.map((item) => item.request.request);
    expect(ids).toHaveLength(2);
    await human.reconcileRequest(ids[0] ?? '');
    expect(human.getSnapshot().problem).toMatchObject({ code: 'connection-uncertain' });
    await human.reconcileRequest(ids[1] ?? '');
    expect(human.getSnapshot().problem).toBeNull();
    human.dispose();
  });
});

async function addOtherCollection(service: WorkspaceSession): Promise<void> {
  const before = await service.read();
  assert(before.ok);
  const other = source.replace('@sample "Sample"', '@other "Other"');
  const payload = { source: other, mode: 'create' };
  const signal = new AbortController().signal;
  await service.apply(request(before.value, 'other', 'other', 'dsl', payload, true), signal);
}

it('an add refused after switching collection does not follow into the new one', slow, async () => {
  await withSample(async (service) => {
    await addOtherCollection(service);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = serviceClient(service, [], { count: 1 });
    const human = await opened({
      ...real,
      post: async (path, input) => {
        await gate;
        return real.post(path, input);
      },
    });
    const adding = human.addObject(module);
    await human.open('other');
    release();
    await adding;
    const view = human.getSnapshot();
    expect(view.active?.document.collection.id).toBe('other');
    expect(view.problem).toBeNull();
    expect(view.status).toContain('"Sample" was not applied');
    expect(view.creation).toMatchObject({ busy: false, object: { label: '' } });
    expect(view.creation.problem).toContain('"Sample" was not applied');
    const section = view.active?.document.collection.sections[0]?.id ?? '';
    expect(await human.addObject({ ...module, section })).toMatchObject({ ok: true });
    human.dispose();
  });
});

it('a new revision of the same collection keeps the Add forms', slow, async () => {
  await withSample(async (service) => {
    const human = await opened(serviceClient(service, [], { count: 0 }));
    expect(await human.addObject(module)).toMatchObject({ ok: true });
    human.setObjectDraft({ ...module, label: 'Keep me' });
    const revision = () => human.getSnapshot().active?.document.collection.revision;
    await vi.waitFor(() => expect(revision()).toBe(1));
    await human.navigateHistory('undo');
    await vi.waitFor(() => expect(revision()).toBe(2));
    expect(human.getSnapshot().creation.object.label).toBe('Keep me');
    human.dispose();
  });
});
