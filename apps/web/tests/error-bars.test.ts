import { it, expect } from 'vitest';
import { requestSchema } from '@novakai/canvas-authoring';
import { failure, plainMessage } from '../contract/index.js';
import { createSubmissionSession } from '../adapters/sessions/submission-session.js';
import type { Submission } from '../contract/records/submission.js';
import type { TransportResponse } from '../contract/records/owners.js';
import { memoryRetention, submissionReaders } from './recovery-fixtures.js';

it('maps serialized owner codes to plain English and keeps readable text', () => {
  expect(plainMessage('{"code":"unroutable-leg","leg":3}')).toBe(
    "Couldn't route a wire for that position. Nothing was changed.",
  );
  expect(plainMessage('Layout failed: {"code":"infeasible-embedding"}')).toBe(
    "Couldn't fit the wires around that position. Nothing was changed.",
  );
  expect(plainMessage('{"code":"something-new"}')).toBe(
    "That change couldn't be applied. Nothing was changed.",
  );
  expect(plainMessage('{"detail":1}')).toBe(
    "That change couldn't be applied. Nothing was changed.",
  );
  expect(plainMessage('Title is required')).toBe('Title is required');
});

it('never persists or restores a proven refusal', async () => {
  const retention = memoryRetention();
  let pending: readonly Submission[] = [];
  const bindings = {
    client: {
      get: async () => failure<TransportResponse>('unused', 'No lookup'),
      post: async () => ({
        ok: true as const,
        value: {
          version: 1 as const,
          generation: 'generation-one',
          outcome: {
            ok: false as const,
            error: {
              code: 'invalid-input',
              path: '',
              message: 'Modules cannot be dropped here',
              recovery: 'Nothing was changed.',
            },
          },
        },
      }),
    },
    retention,
    readers: submissionReaders(),
    changed: (items: readonly Submission[]) => {
      pending = items;
    },
    confirmed: () => undefined,
    report: () => undefined,
  };
  const request = requestSchema.parse({
    version: 1,
    workspace: 'test-workspace',
    request: 'refused-drop',
    actor: { id: 'human:browser', kind: 'human' },
    assets: [],
    expected: [{ key: { kind: 'collection', id: 'demo' }, version: 0 }],
    scope: [{ kind: 'collection', id: 'demo' }],
    intent: { kind: 'change', planner: 'model', payload: { changes: [] } },
  });
  const session = createSubmissionSession(bindings);
  session.restore('test-workspace');
  const sent = await session.submit({
    request,
    generation: 'generation-one',
    sourceEdit: 0,
    gesture: null,
  });
  expect(sent).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(pending).toMatchObject([{ state: 'rejected' }]);
  expect(retention.read('pending.test-workspace')).toEqual({ ok: true, value: [] });

  // A journal written by an older build that still holds a refusal is not shown after reload.
  retention.write('pending.test-workspace', [{ ...pending[0], state: 'rejected' }]);
  pending = [{ ...pending[0], state: 'rejected' } as Submission];
  const reloaded = createSubmissionSession(bindings);
  reloaded.restore('test-workspace');
  expect(pending).toEqual([]);
});
