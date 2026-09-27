import { assert, expect } from 'vitest';
import { validate, plan, descendantId } from '@novakai/canvas-model';
import { snapshotSchema, receiptSchema } from '@novakai/canvas-authoring';
import { createInspectorSession } from '../contract/index.js';
import { readInspectorDrafts } from '../adapters/readers/inspector-reader.js';
import { editedObject, objectDraftKey, failure } from '../contract/index.js';
import { snapshot, memoryRetention, deferred, capturedCollection } from './recovery-fixtures.js';
import type { InspectorBindings, ObjectSelection } from '../contract/index.js';
/** Retained command replay proves that unfinished labels and engineering content remain editable after reload. Extends host case7. */
export async function verifyInspectorRecovery(): Promise<void> {
  const before = snapshot(0);
  const record = before.records[0];
  assert(record);
  const checked = validate(record.value);
  assert(checked.ok);
  const collection = validate({
    ...checked.value,
    objects: [{ id: 'record', kind: 'entity', label: 'Customer', role: 'neutral' }],
  });
  assert(collection.ok);
  const object = collection.value.objects[0];
  assert(object);
  const base = snapshotSchema.parse({
    ...before,
    records: [{ ...record, value: collection.value }],
  });
  const selection: ObjectSelection = {
    base,
    collection: collection.value,
    object,
    generation: 'original-service',
  };
  const retention = memoryRetention();
  const finished = deferred<Awaited<ReturnType<InspectorBindings['apply']>>>();
  let applies = 0;
  const bindings: InspectorBindings = {
    retention,
    read: readInspectorDrafts,
    report: () => undefined,
    apply: async (draft, object) => {
      applies++;
      const checked = plan(draft.collection, [{ op: 'replace', target: 'objects', value: object }]);
      if (!checked.ok) return failure('invariant-violation', 'The label must be nonblank');
      return finished.promise;
    },
  };
  const form = createInspectorSession(bindings);
  form.restore(base.workspace);
  form.edit(selection, { kind: 'label', value: '' });
  const key = objectDraftKey(collection.value.id, object.id);
  const restarted = createInspectorSession(bindings);
  restarted.restore(base.workspace);
  const unfinished = restarted.getSnapshot().drafts[0];
  assert(unfinished);
  expect(editedObject(unfinished).label).toBe('');
  expect(unfinished.generation).toBe('original-service');
  expect(applies).toBe(0);
  await restarted.apply(key);
  expect(restarted.getSnapshot().problem?.code).toBe('invariant-violation');
  restarted.edit(selection, { kind: 'label', value: 'Account' });
  restarted.edit(selection, {
    kind: 'add-content',
    content: 'field',
    id: descendantId.parse('primary'),
  });
  restarted.edit(selection, {
    kind: 'field-key',
    id: descendantId.parse('primary'),
    value: 'primary',
  });
  const applying = restarted.apply(key);
  restarted.edit(selection, { kind: 'label', value: 'Account with newer typing' });
  finished.resolve({
    ok: true,
    value: receiptSchema.parse({
      request: 'object-change',
      fingerprint: 'a'.repeat(64),
      sequence: 2,
      versions: [{ key: { kind: 'collection', id: 'demo' }, version: 1 }],
      outcome: {
        status: 'committed',
        transaction: 'object-change',
        pins: {},
        diff: {},
        warnings: [],
      },
    }),
  });
  await applying;
  const remaining = restarted.getSnapshot().drafts[0];
  assert(remaining);
  expect(editedObject(remaining)).toMatchObject({
    label: 'Account with newer typing',
    content: [{ id: 'primary', kind: 'field', key: 'primary' }],
  });
  expect(remaining.base).toEqual(capturedCollection(base));
  expect(object.label).toBe('Customer');
  restarted.discard(key);
  expect(restarted.getSnapshot().drafts).toEqual([]);
  // A failed workspace switch must not write old drafts under the new workspace key.
  const keysWritten: string[] = [];
  const isolated = createInspectorSession({
    ...bindings,
    retention: {
      ...retention,
      read: (key) =>
        key === 'inspector.other-workspace'
          ? failure('storage-unavailable', 'Unavailable')
          : retention.read(key),
      write: (key, value) => {
        keysWritten.push(key);
        return retention.write(key, value);
      },
    },
  });
  isolated.restore(base.workspace);
  isolated.edit(selection, { kind: 'label', value: 'Retained in original workspace' });
  const writesBeforeSwitch = keysWritten.length;
  const appliesBeforeSwitch = applies;
  isolated.restore('other-workspace');
  isolated.discard(key);
  await isolated.apply(key);
  expect(keysWritten).toHaveLength(writesBeforeSwitch);
  expect(applies).toBe(appliesBeforeSwitch);
  expect(isolated.getSnapshot().problem?.code).toBe('unavailable');
  isolated.restore(base.workspace);
  const recovered = isolated.getSnapshot().drafts[0];
  assert(recovered);
  expect(editedObject(recovered).label).toBe('Retained in original workspace');
}
