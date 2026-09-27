import { assert, expect } from 'vitest';
import { validate, plan } from '@novakai/canvas-model';
import { snapshotSchema, receiptSchema } from '@novakai/canvas-authoring';
import { createWireSession } from '../contract/index.js';
import { editedWire, wireDraftKey, wireChanges } from '../contract/index.js';
import { readWireDrafts } from '../adapters/readers/wire-reader.js';
import { failure } from '../contract/index.js';
import type { WireSelection, WireEditorBindings } from '../contract/records/wire-editor.js';
import { snapshot, memoryRetention, deferred, capturedCollection } from './recovery-fixtures.js';

/** Extends host case7: shared label changes, section-local resets and retained wire drafts cross the actual Model boundary. */
export async function verifyWireRecovery(): Promise<void> {
  const original = snapshot(0);
  const stored = original.records[0];
  assert(stored);
  const empty = validate(stored.value);
  assert(empty.ok);
  const checked = validate({
    ...empty.value,
    objects: [
      { id: 'customer', label: 'Customer', kind: 'entity' },
      { id: 'order', label: 'Order', kind: 'entity' },
    ],
    relationships: [
      {
        id: 'orders',
        kind: 'association',
        label: 'places',
        source: { object: 'customer' },
        target: { object: 'order' },
        from: '1',
        to: '0..many',
      },
    ],
    sections: ['detail', 'overview'].map((id) => ({
      id,
      title: id,
      mode: 'er',
      layout: { algorithm: 'layered' },
      appearances: [{ object: 'customer' }, { object: 'order' }],
      wires: [
        {
          relationship: 'orders',
          manual: [
            { x: 10, y: 20 },
            { x: 100, y: 20 },
          ],
          locked: true,
        },
      ],
    })),
  });
  assert(checked.ok, JSON.stringify(checked));
  const collection = checked.value;
  const section = collection.sections[0];
  const relationship = collection.relationships[0];
  const wire = section?.wires[0];
  assert(section && relationship && wire);
  const base = snapshotSchema.parse({ ...original, records: [{ ...stored, value: collection }] });
  const selected: WireSelection = {
    base,
    collection,
    section,
    relationship,
    wire,
    generation: 'generation-one',
  };
  const retention = memoryRetention();
  const complete = deferred<Awaited<ReturnType<WireEditorBindings['apply']>>>();
  let calls = 0;
  const bindings: WireEditorBindings = {
    retention,
    read: readWireDrafts,
    report: () => undefined,
    apply: async (draft, changes) => {
      calls++;
      const checked = plan(draft.collection, changes);
      if (!checked.ok) return failure('invalid-wire', 'Model rejected this wire');
      return complete.promise;
    },
  };
  const editor = createWireSession(bindings);
  editor.restore(base.workspace);
  editor.edit(selected, { kind: 'label', value: '' });
  const key = wireDraftKey(collection.id, section.id, relationship.id);
  const resumed = createWireSession(bindings);
  resumed.restore(base.workspace);
  const draft = resumed.getSnapshot().drafts[0];
  assert(draft);
  expect(editedWire(draft).relationship.label).toBe('');
  expect(draft.base).toEqual(capturedCollection(base));
  expect(calls).toBe(0);
  await resumed.apply(key);
  expect(resumed.getSnapshot().problem?.code).toBe('invalid-wire');
  resumed.edit(selected, { kind: 'label', value: 'submits' });
  resumed.edit(selected, { kind: 'automatic-route' });
  resumed.edit(selected, { kind: 'side', side: 'sourceSide', value: 'bottom' });
  const ready = resumed.getSnapshot().drafts[0];
  assert(ready);
  const result = plan(collection, wireChanges(ready));
  assert(result.ok, JSON.stringify(result));
  expect(result.value.candidate.relationships[0]?.label).toBe('submits');
  expect(result.value.candidate.sections[0]?.wires[0]).toEqual({
    relationship: 'orders',
    route: 'orthogonal',
    sourceSide: 'bottom',
    targetSide: 'auto',
    locked: false,
  });
  expect(result.value.candidate.sections[1]).toEqual(collection.sections[1]);
  expect(collection.sections[0]?.wires[0]?.manual).toEqual([
    { x: 10, y: 20 },
    { x: 100, y: 20 },
  ]);
  const applying = resumed.apply(key);
  resumed.edit(selected, { kind: 'label', value: 'newer unsaved label' });
  complete.resolve({
    ok: true,
    value: receiptSchema.parse({
      request: 'wire-change',
      fingerprint: 'a'.repeat(64),
      sequence: 2,
      versions: [{ key: { kind: 'collection', id: collection.id }, version: 1 }],
      outcome: {
        status: 'committed',
        transaction: 'wire-change',
        pins: {},
        diff: {},
        warnings: [],
      },
    }),
  });
  await applying;
  const remaining = resumed.getSnapshot().drafts[0];
  assert(remaining);
  expect(editedWire(remaining).relationship.label).toBe('newer unsaved label');
  expect(remaining.base).toEqual(capturedCollection(base));
  const tampered = readWireDrafts([{ ...remaining, section: { id: 'missing' } }]);
  expect(tampered.ok).toBe(false);
  resumed.discard(key);
  expect(resumed.getSnapshot().drafts).toEqual([]);
}
