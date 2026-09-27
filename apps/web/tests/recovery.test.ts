import { verifyWireRecovery } from './wire-recovery.js';
import { verifyInspectorRecovery } from './inspector-recovery.js';
import { it, expect, assert } from 'vitest';
import type { ServiceClient } from '../contract/ports/client.js';
import type { Request, TransportResponse } from '../contract/records/owners.js';
import type { Submission } from '../contract/records/submission.js';
import type { Result } from '../contract/index.js';
import { failure } from '../contract/index.js';
import { createSubmissionSession } from '../adapters/sessions/submission-session.js';
import {
  controller,
  memoryRetention,
  snapshot,
  receipt,
  response,
  deferred,
  submitted,
  submissionReaders,
} from './recovery-fixtures.js';

it('host 7 retains newer source generations, foreign-commit bases and uncertain requests across reconnect', async () => {
  await verifyInspectorRecovery();
  await verifyWireRecovery();
  // Recovery also initializes after the first workspace read fails, not only on clean startup.
  let online = false;
  let recoveredPosts = 0;
  const reconnectRetention = memoryRetention();
  reconnectRetention.write('source-draft.test-workspace', {
    source: 'Recover me after reconnect',
    snapshot: snapshot(0),
    generation: 'generation-one',
    collection: 'demo',
    edit: 1,
  });
  const initiallyOffline = controller(
    {
      get: async () => (online ? response(snapshot(0)) : failure('offline', 'Disconnected')),
      post: async () => {
        recoveredPosts++;
        return failure('connection-uncertain', 'Reply unavailable');
      },
      changes: () => () => undefined,
    },
    reconnectRetention,
  );
  await initiallyOffline.start();
  expect(initiallyOffline.getSnapshot().connected).toBe(false);
  online = true;
  await initiallyOffline.refresh();
  expect(initiallyOffline.getSnapshot()).toMatchObject({
    connected: true,
    sourceDirty: true,
    source: 'Recover me after reconnect',
  });
  await initiallyOffline.create('After reconnect');
  expect(recoveredPosts).toBe(1);
  expect(initiallyOffline.getSnapshot().pending[0]).toMatchObject({
    state: 'uncertain',
    request: { workspace: 'test-workspace' },
  });
  initiallyOffline.dispose();
  const retention = memoryRetention();
  let latest = snapshot(0);
  retention.write('source-draft.test-workspace', {
    source: 'first draft',
    snapshot: latest,
    generation: 'generation-one',
    collection: 'demo',
    edit: 1,
  });
  const first = deferred<Result<TransportResponse>>();
  const sent: Request[] = [];
  let responseNumber = 0;
  const client: ServiceClient = {
    get: async () => response(latest),
    post: async (_path, input) => {
      sent.push(submitted(input));
      if (responseNumber++ === 0) return first.promise;
      return {
        ok: true,
        value: {
          version: 1,
          generation: 'generation-one',
          outcome: {
            ok: false,
            error: {
              code: 'revision-conflict',
              path: 'demo',
              message: 'Agent committed a newer revision',
              recovery: 'Retain draft and read current revision',
            },
          },
        },
      };
    },
    changes: () => () => undefined,
  };
  const human = controller(client, retention);
  await human.start();
  const applying = human.applySource();
  const original = sent[0];
  assert(original);
  expect(original.expected).toEqual([{ key: { kind: 'collection', id: 'demo' }, version: 0 }]);
  human.editSource('newer typing while first edit saves');
  latest = snapshot(1);
  first.resolve(response({ receipt: receipt(original, 1), snapshot: snapshot(1) }));
  await applying;
  await human.refresh();
  expect(human.getSnapshot()).toMatchObject({
    source: 'newer typing while first edit saves',
    sourceDirty: true,
    sourceBase: { sequence: 2 },
    busy: false,
  });
  latest = snapshot(2); // foreign agent edit after the browser's confirmed first edit
  await human.refresh();
  expect(human.getSnapshot().sourceBase?.sequence).toBe(2);
  await human.applySource();
  expect(sent[1]?.expected).toEqual([{ key: { kind: 'collection', id: 'demo' }, version: 1 }]);
  expect(human.getSnapshot()).toMatchObject({
    sourceDirty: true,
    problem: { code: 'revision-conflict' },
  });
  await human.showSource(false);
  expect(human.getSnapshot().sourceCloseRequested).toBe(true);
  human.closeSource('keep');
  expect(human.getSnapshot()).toMatchObject({ sourceOpen: false, sourceDirty: true });
  human.dispose();
  const resumed = controller(
    { ...client, get: async () => response(latest, 'generation-two') },
    retention,
  );
  await resumed.start();
  expect(resumed.getSnapshot()).toMatchObject({
    source: 'newer typing while first edit saves',
    sourceDirty: true,
    sourceBase: { sequence: 2 },
    sourceGeneration: 'generation-one',
    generation: 'generation-two',
  });
  expect(sent).toHaveLength(2); // reconnect never replays source
  resumed.dispose();

  // A lost apply response is recovered from a checked receipt without another mutation.
  const journal = memoryRetention();
  let pending: readonly Submission[] = [];
  let confirmations = 0;
  let posts = 0;
  let knownReceipt: unknown = null;
  const recoveryClient = {
    get: async () => response(knownReceipt),
    post: async () => {
      posts++;
      return failure<TransportResponse>('connection-uncertain', 'Connection lost');
    },
  };
  const bindings = {
    client: recoveryClient,
    retention: journal,
    readers: submissionReaders(),
    changed: (items: readonly Submission[]) => {
      pending = items;
    },
    confirmed: () => {
      confirmations++;
    },
    report: () => undefined,
  };
  const recovery = createSubmissionSession(bindings);
  recovery.restore('test-workspace');
  const input = { request: original, generation: 'generation-one', sourceEdit: 1, gesture: null };
  expect(await recovery.submit(input)).toMatchObject({ ok: false });
  expect(pending[0]).toMatchObject({ state: 'uncertain', request: original });
  expect(await recovery.submit(input)).toMatchObject({
    ok: false,
    error: { code: 'pending-request' },
  });
  expect(posts).toBe(1);
  const restarted = createSubmissionSession(bindings);
  restarted.restore('test-workspace');
  expect(posts).toBe(1);
  knownReceipt = { ...receipt(original, 1), request: 'unrelated-request' };
  expect(await restarted.reconcile(original.request)).toMatchObject({
    ok: false,
    error: { code: 'invalid-receipt' },
  });
  expect(confirmations).toBe(0);
  knownReceipt = receipt(original, 1);
  expect(await restarted.retry(original.request, 'generation-two')).toEqual({
    ok: true,
    value: knownReceipt,
  });
  expect(posts).toBe(1);
  expect(pending).toEqual([]);
  expect(confirmations).toBe(1);

  // Two rapid retries cannot both pass a delayed receipt lookup and transmit.
  const checking = deferred<Result<TransportResponse>>();
  const exclusive = createSubmissionSession({
    ...bindings,
    client: { ...recoveryClient, get: () => checking.promise },
  });
  exclusive.restore('test-workspace');
  expect(await exclusive.submit(input)).toMatchObject({ ok: false });
  const postsBeforeRetry = posts;
  const firstRetry = exclusive.retry(original.request, 'generation-two');
  expect(await exclusive.retry(original.request, 'generation-two')).toMatchObject({
    ok: false,
    error: { code: 'pending-request' },
  });
  expect(exclusive.dismiss(original.request)).toMatchObject({ ok: false });
  checking.resolve(response(null));
  await firstRetry;
  expect(posts).toBe(postsBeforeRetry + 1);
  // A proven refusal stays dismissible after an absent receipt check, and never blocks a corrected edit.
  const refusal = createSubmissionSession({
    ...bindings,
    retention: memoryRetention(),
    client: {
      get: async () => response(null),
      post: async () => ({
        ok: true,
        value: {
          version: 1,
          generation: 'generation-one',
          outcome: {
            ok: false,
            error: {
              code: 'revision-conflict',
              path: 'demo',
              message: 'Changed elsewhere',
              recovery: 'Retain the draft and compare revisions',
            },
          },
        },
      }),
    },
  });
  refusal.restore('test-workspace');
  await refusal.submit(input);
  await refusal.reconcile(original.request);
  expect(pending[0]?.state).toBe('rejected');
  expect(refusal.dismiss(original.request)).toEqual({ ok: true, value: undefined });
  expect(pending).toEqual([]);
  const postsBeforeQuotaFailure = posts;
  // Failed retention must prevent transmission entirely.
  const unavailable = createSubmissionSession({
    ...bindings,
    retention: { ...memoryRetention(), write: () => failure('quota', 'Full') },
  });
  unavailable.restore('test-workspace');
  expect(await unavailable.submit(input)).toMatchObject({ ok: false, error: { code: 'quota' } });
  expect(posts).toBe(postsBeforeQuotaFailure);
});
