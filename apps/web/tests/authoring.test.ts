import { verifyLibraryOrganisation } from './library-organisation.js';
import { it, expect, assert } from 'vitest';
import { requestSchema } from '@novakai/canvas-authoring';
import { validate } from '@novakai/canvas-model';
import { workspaceFixture, request, source, nested } from './host-workspace-fixture.js';
import { planCanvasEdit } from '../contract/index.js';

it('host 2 atomically registers DSL collections, rejects stale changes and returns the same receipt on retry', async () => {
  const fixture = await workspaceFixture();
  const session = fixture.session;
  const signal = new AbortController().signal;
  try {
    const initial = await session.read();
    assert(initial.ok);
    const create = request(
      initial.value,
      'create-sample',
      'sample',
      'dsl',
      { source, mode: 'create' },
      true,
    );
    const accepted = await session.apply(create, signal);
    assert(accepted.ok, JSON.stringify(accepted));
    expect(
      accepted.value.receipt.versions
        .filter((item) => item.key.kind !== 'history')
        .map((item) => item.key.kind)
        .sort(),
    ).toEqual(['catalog', 'collection']);
    const after = await session.read();
    assert(after.ok);
    const catalog = after.value.records.find((item) => item.key.kind === 'catalog');
    expect(catalog?.value).toMatchObject({
      entries: [expect.objectContaining({ collection: 'sample' })],
    });
    const original = after.value.records.find(
      (item) => item.key.kind === 'collection' && item.key.id === 'sample',
    );
    expect(original).toMatchObject({
      version: 0,
      value: { id: 'sample', revision: 0, objects: expect.any(Array) },
    });
    expect(await session.apply(create, signal)).toEqual(accepted);
    expect(await session.receipt(create.request)).toEqual({
      ok: true,
      value: accepted.value.receipt,
    });
    const replace = request(after.value, 'replace-sample', 'sample', 'dsl', {
      source: source.replace('"First"', '"Revised first"'),
      mode: 'replace',
    });
    const changed = await session.apply(replace, signal);
    assert(changed.ok, JSON.stringify(changed));
    const stale = request(after.value, 'stale-sample', 'sample', 'dsl', {
      source,
      mode: 'replace',
    });
    expect(await session.apply(stale, signal)).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    });
    const current = await session.read();
    assert(current.ok);
    const invalid = request(current.value, 'invalid-sample', 'sample', 'dsl', {
      source: source.replace('-> @two', '-> @absent'),
      mode: 'replace',
    });
    expect(await session.apply(invalid, signal)).toMatchObject({ ok: false });
    expect(await session.read()).toEqual(current);
    expect(await session.receipt(invalid.request)).toEqual({ ok: true, value: null });
    await verifyLibraryOrganisation(session, current.value);
  } finally {
    await fixture.close();
  }
}, 30000);

it('host 3 preserves immediate-parent placement through the real Model and Authoring pathway', async () => {
  const fixture = await workspaceFixture();
  const session = fixture.session;
  const signal = new AbortController().signal;
  try {
    const initial = await session.read();
    assert(initial.ok);
    const create = request(
      initial.value,
      'create-nested',
      'nested',
      'dsl',
      { source: nested, mode: 'create' },
      true,
    );
    const accepted = await session.apply(create, signal);
    assert(accepted.ok, JSON.stringify(accepted));
    const rendered = await session.render('nested', signal);
    assert(rendered.ok, JSON.stringify(rendered));
    const document = rendered.value;
    const section = document.scene.sections[0];
    const node = section?.nodes.find((item) => item.measured.objectId === 'one');
    assert(section && node);
    const stamp = {
      collectionId: 'nested',
      revision: 0,
      inputKey: document.scene.inputKey,
      generation: 1,
    };
    const intent = {
      kind: 'placement' as const,
      id: 'human-drag',
      scope: 'appearance' as const,
      base: stamp,
      entries: [
        {
          target: { kind: 'node' as const, section: section.id, id: node.id },
          placement: { x: 42, y: 190, locked: false },
        },
      ],
    };
    const planned = planCanvasEdit(intent, { document, stamp });
    assert(planned.ok, JSON.stringify(planned));
    expect(
      document.collection.sections[0]?.appearances.find((item) => item.object === 'one')?.placement,
    ).toBeUndefined();
    const snapshot = await session.read();
    assert(snapshot.ok);
    const moved = await session.apply(
      request(snapshot.value, 'human-drag', 'nested', 'model', {
        collection: 'nested',
        changes: planned.value,
      }),
      signal,
    );
    assert(moved.ok, JSON.stringify(moved));
    const stored = await session.read();
    assert(stored.ok);
    const value = stored.value.records.find(
      (item) => item.key.kind === 'collection' && item.key.id === 'nested',
    );
    const collection = validate(value?.value);
    assert(collection.ok, JSON.stringify(collection));
    const appearance = collection.value.sections[0]?.appearances.find(
      (item) => item.object === 'one',
    );
    expect(appearance).toMatchObject({
      group: 'boundary',
      placement: { x: 42, y: 190, locked: false },
    });
    expect(collection.value.objects).toEqual(document.collection.objects);
    expect(collection.value.revision).toBe(1);
    expect(
      planCanvasEdit({ ...intent, base: { ...stamp, generation: 0 } }, { document, stamp }),
    ).toMatchObject({ ok: false, error: { code: 'stale-gesture' } });
  } finally {
    await fixture.close();
  }
}, 30000);

it('PR3 admits immutable themes and editable recipes through shared metadata CAS', async () => {
  const fixture = await workspaceFixture();
  const session = fixture.session;
  const signal = new AbortController().signal;
  try {
    const initial = await session.read();
    assert(initial.ok);
    const admission = {
      schemaVersion: 1,
      kind: 'theme',
      id: 'harbor',
      version: '1.0.0',
      title: 'Harbor',
      description: '',
      raw: { base: 'paper', overrides: {} },
    };
    const aliases = ['body', 'mono', 'strong'] as const;
    const assets = session.installation.fonts.map((font, index) => ({
      alias: aliases[index] ?? 'strong',
      digest: font.digest,
    }));
    const left = session.resources.preparePreset({ admission, assets }, initial.value);
    assert(left.ok, JSON.stringify(left));
    const right = session.resources.preparePreset(
      { admission: { ...admission, title: 'Conflicting harbor' }, assets },
      initial.value,
    );
    assert(right.ok, JSON.stringify(right));
    const make = (prepared: typeof left.value, snapshot: typeof initial.value, id: string) => {
      const metadata = snapshot.records.find((item) => item.key.kind === 'workspace');
      assert(metadata);
      const previous = snapshot.records.find(
        (item) => item.key.kind === 'preset' && item.key.id === prepared.key.id,
      );
      const expected = [
        { key: metadata.key, version: metadata.version },
        { key: prepared.key, version: previous?.version ?? 'absent' },
      ];
      return requestSchema.parse({
        workspace: snapshot.workspace,
        request: id,
        version: 1,
        actor: { id: 'agent:cli', kind: 'agent' },
        assets,
        scope: expected.map((item) => item.key),
        expected,
        intent: { kind: 'change', planner: 'preset', payload: prepared },
      });
    };
    const first = make(left.value, initial.value, 'harbor-left');
    const second = make(right.value, initial.value, 'harbor-right');
    // Both preparations observe the same catalog/metadata version; concurrent apply must commit only one.
    const outcomes = await Promise.all([
      session.apply(first, signal),
      session.apply(second, signal),
    ]);
    expect(outcomes.filter((item) => item.ok)).toHaveLength(1);
    expect(outcomes.filter((item) => !item.ok)).toHaveLength(1);
    expect(outcomes.find((item) => !item.ok)).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict' },
    });
    const current = await session.read();
    assert(current.ok);
    expect(
      current.value.records.find((item) => item.key.kind === 'workspace')?.value,
    ).toMatchObject({ presetRevision: 1 });
    const winner = outcomes[0]?.ok ? left.value : right.value;
    const noop = await session.apply(make(winner, current.value, 'harbor-identical'), signal);
    assert(noop.ok, JSON.stringify(noop));
    expect(noop.value.receipt.outcome.status).toBe('no-op');
    const unchanged = await session.read();
    assert(unchanged.ok);
    expect(
      unchanged.value.records.find((item) => item.key.kind === 'workspace')?.value,
    ).toMatchObject({ presetRevision: 1 });
    expect(
      session.resources.preparePreset(
        { admission: { ...admission, title: 'Third incompatible harbor identity' }, assets },
        unchanged.value,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'version-exists',
        path: expect.any(String),
        recovery: expect.stringContaining('prepare again'),
      },
    });
    const recipe = session.resources.preparePreset(
      {
        admission: {
          schemaVersion: 1,
          kind: 'recipe',
          id: 'field-guide',
          version: '1.0.0',
          title: 'Field guide',
          description: '',
          family: 'infographic',
          source: source.replace('theme=paper', 'theme=harbor'),
        },
      },
      unchanged.value,
    );
    assert(recipe.ok, JSON.stringify(recipe));
    const recipeRequest = requestSchema.parse({
      ...make(recipe.value, unchanged.value, 'recipe-field-guide'),
      assets: [],
    });
    const committed = await session.apply(recipeRequest, signal);
    assert(committed.ok, JSON.stringify(committed));
    const after = await session.read();
    assert(after.ok);
    const expanded = session.resources.instantiate(
      { pin: recipe.value.pin, namespace: 'fresh-guide' },
      after.value,
    );
    assert(expanded.ok, JSON.stringify(expanded));
    expect(expanded.value).toContain('fresh-guide');
    expect(expanded.value).toContain(`harbor@1.0.0#sha256:${winner.pin.digest}`);
    expect(expanded.value).not.toContain('collection @sample ');
    expect(await session.apply(recipeRequest, signal)).toEqual(committed);
    const reopened = await fixture.reopen();
    expect(await reopened.receipt(recipeRequest.request)).toEqual({
      ok: true,
      value: committed.value.receipt,
    });
    expect(await reopened.apply(recipeRequest, signal)).toEqual(committed);
    expect(await reopened.read()).toEqual(after);
    const drift = requestSchema.parse({
      ...make(recipe.value, after.value, 'recipe-drift'),
      assets: [],
      intent: {
        kind: 'change',
        planner: 'preset',
        payload: { ...recipe.value, pin: { ...recipe.value.pin, digest: 'f'.repeat(64) } },
      },
    });
    expect(await reopened.apply(drift, signal)).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict', path: 'preset' },
    });
  } finally {
    await fixture.close();
  }
}, 30000);
