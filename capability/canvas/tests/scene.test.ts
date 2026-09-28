import { describe, it, expect } from 'vitest';
import { createCanvas, createSession, gestureId } from '../contract/index.js';
import { harness, scene, admission, step, begin, alpha } from './fixtures.js';
describe('Canvas scene admission contract', () => {
  it('8 displayed A/requested C rejects B and retains a human draft on valid C arrival', () => {
    const a = scene();
    const b = scene(1);
    const c = scene(2);
    const { canvas, state } = harness([a, b, c]);
    const draft = step(canvas, begin(canvas, state), {
      kind: 'move',
      id: 'drag',
      delta: { x: 20, y: 0 },
    }).state;
    const wanted = { collectionId: 'demo', revision: 2, inputKey: 'scene-2', generation: 2 };
    const requested = step(canvas, draft, { kind: 'expect-scene', stamp: wanted }).state;
    expect(requested.stamp.revision).toBe(0);
    expect(requested.requested.revision).toBe(2);
    expect(
      canvas.transition(requested, {
        kind: 'receive-scene',
        stamp: { collectionId: 'demo', revision: 1, inputKey: 'scene-1', generation: 1 },
        scene: b,
      }).ok,
    ).toBe(false);
    expect(
      canvas.transition(requested, {
        kind: 'receive-scene',
        scene: c,
        stamp: { ...wanted, generation: 1 },
      }).ok,
    ).toBe(false);
    expect(
      canvas.transition(requested, {
        kind: 'receive-scene',
        scene: c,
        stamp: { ...wanted, inputKey: 'different-input' },
      }).ok,
    ).toBe(false);
    expect(requested.scene.revision).toBe(0);
    expect(requested.draft).not.toBeNull();
    const received = step(canvas, requested, {
      kind: 'receive-scene',
      stamp: wanted,
      scene: c,
    }).state;
    expect(received.scene.revision).toBe(2);
    expect(received.draft).toBeNull();
    expect(received.recovery[0]).toMatchObject({
      reason: 'scene-changed',
      draft: { base: { revision: 0 }, current: [{ target: alpha, box: { x: 140, y: 240 } }] },
    });
    expect(received.camera).toBe(state.camera);
    expect(
      canvas.transition(received, {
        kind: 'expect-scene',
        stamp: { collectionId: 'demo', revision: 1, inputKey: 'scene-1', generation: 3 },
      }).ok,
    ).toBe(false);
  });
  it('13 malformed admission/geometry/references/profile and foreign collection reject before partial state', () => {
    const invalid = scene();
    const first = invalid.sections[0];
    expect(first).toBeDefined();
    if (!first) return;
    const malformed = {
      ...invalid,
      sections: [{ ...first, nodes: [...first.nodes, ...first.nodes] }],
    };
    const oversized = {
      ...invalid,
      sections: Array.from({ length: 33 }, (_, index) => ({
        ...first,
        id: `section-${index}`,
        nodes: first.nodes.map((node) => ({ ...node, sectionId: `section-${index}` })),
      })),
    };
    const canvas = createCanvas({ sceneAdmission: admission([malformed, oversized]) });
    expect(
      canvas.open({
        scene: malformed,
        expected: { collectionId: 'demo', revision: 0, inputKey: 'scene-0', generation: 0 },
        viewport: { width: 800, height: 600 },
      }).ok,
    ).toBe(false);
    expect(
      canvas.open({
        scene: oversized,
        expected: { collectionId: 'demo', revision: 0, inputKey: 'scene-0', generation: 0 },
        viewport: { width: 800, height: 600 },
      }).ok,
    ).toBe(false);
    const { canvas: valid, state } = harness();
    expect(
      valid.open({ scene: {}, expected: state.stamp, viewport: { width: 800, height: 600 } }).ok,
    ).toBe(false);
    expect(
      valid.transition(state, {
        kind: 'expect-scene',
        stamp: { ...state.stamp, collectionId: 'other', generation: 1 },
      }).ok,
    ).toBe(false);
    expect(valid.transition(state, { kind: 'pan', delta: { x: Infinity, y: 0 } }).ok).toBe(false);
    expect(
      valid.open({
        scene: invalid,
        expected: state.stamp,
        viewport: { width: 800, height: 600 },
        profile: { ...state.profile, coarseThreshold: 2 },
      }).ok,
    ).toBe(false);
  });
  it('14 session snapshots, notifications and exactly-once effect drain survive subscriber failure and cleanup', () => {
    const { canvas, state } = harness();
    const store = createSession(canvas, state);
    expect(store.getSnapshot()).toBe(state);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    let calls = 0;
    const remove = store.subscribe(() => {
      calls += 1;
    });
    store.subscribe(() => {
      throw new Error('subscriber fixture');
    });
    const result = store.dispatch({ kind: 'select', targets: [alpha], mode: 'replace' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics[0]?.code).toBe('listener-failure');
    expect(calls).toBe(1);
    expect(store.getSnapshot().selection).toEqual([alpha]);
    expect(store.dispatch({ kind: 'duplicate', id: 'copy' }).ok).toBe(true);
    expect(store.drainEffects()).toMatchObject([
      { kind: 'edit-intent', intent: { kind: 'duplicate', id: 'copy' } },
    ]);
    expect(store.drainEffects()).toEqual([]);
    expect(store.dispatch({ kind: 'duplicate', id: 'copy' }).ok).toBe(true);
    expect(store.drainEffects()).toEqual([]);

    remove();
    store.dispatch({ kind: 'select', targets: [], mode: 'replace' });
    expect(calls).toBe(1);
    store.writePointer({ id: gestureId.parse('pointer'), target: alpha, start: { x: 20, y: 40 } });
    expect(store.readPointer()?.id).toBe('pointer');
    store.writePointer(null);
    expect(store.readPointer()).toBeNull();
    const diagnostic = {
      code: 'listener-failure' as const,
      path: 'fixture',
      targets: [],
      message: 'Reducer diagnostic',
      recovery: 'Host repairs reducer',
    };
    const diagnosed = createSession(
      {
        transition: () => ({
          ok: true,
          value: { state, changed: false, effects: [], diagnostics: [diagnostic] },
        }),
      },
      state,
    );
    expect(diagnosed.dispatch({})).toMatchObject({
      ok: true,
      value: { diagnostics: [diagnostic] },
    });
    diagnosed.dispose();
    store.dispose();
    expect(store.dispatch({ kind: 'duplicate', id: 'copy' }).ok).toBe(false);
  });
});
