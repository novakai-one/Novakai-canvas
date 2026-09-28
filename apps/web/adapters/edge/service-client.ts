import { transportResponse } from '@novakai/canvas-service';
import type { TransportResponse } from '@novakai/canvas-service';
import { z } from 'zod';
import { receiptSchema } from '@novakai/canvas-authoring';
import type { BinaryResponse, CommitNotice, ServiceClient } from '../../contract/ports/client.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
/** Only the receipt's identity is read from a committed event; the rest stays a hint the snapshot read supersedes. */
const committedEvent = z.looseObject({
  change: z.looseObject({
    receipt: z
      .looseObject({
        request: receiptSchema.shape.request,
        sequence: receiptSchema.shape.sequence,
      })
      .transform(({ request, sequence }): CommitNotice => ({ request, sequence })),
  }),
});
/** Same-origin cookies authenticate each request. Redirects and non-versioned results are rejected, preserving uncertain drafts. */
async function request(
  path: string,
  method: string,
  body: string | null,
  signal?: AbortSignal,
): Promise<Result<TransportResponse>> {
  try {
    const response = await fetch(path, {
      method,
      body,
      signal: signal ?? null,
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
    const input: unknown = await response.json();
    const checked = transportResponse.safeParse(input);
    if (!checked.success)
      return failure('invalid-response', 'The service returned an unreadable response');
    return { ok: true, value: checked.data };
  } catch {
    return failure('connection-uncertain', 'The service response could not be confirmed');
  }
}
/** Events only prompt a fresh snapshot. A committed event names its request and sequence so the consumer
 * can skip commits it already installed; a (re)connect names none.
 */
function changes(
  changed: (commit: CommitNotice | null) => void,
  connection: (connected: boolean) => void,
): () => void {
  const stream = new EventSource('/api/v1/events', { withCredentials: true });
  stream.addEventListener('connected', () => {
    connection(true);
    changed(null);
  });
  stream.addEventListener('committed', (event) => changed(committedNotice(event.data)));
  stream.onerror = () => connection(false);
  return () => stream.close();
}
/** An unreadable committed event still prompts a reread; it just cannot be recognized as already installed. */
function committedNotice(data: unknown): CommitNotice | null {
  const checked = committedEvent.safeParse(eventJson(data));
  return checked.success ? checked.data.change.receipt : null;
}

function eventJson(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function bytes(
  path: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<Result<BinaryResponse>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: signal ?? null,
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok ? await binarySuccess(response) : await binaryFailure(response);
  } catch {
    return failure('connection-uncertain', 'The artifact response could not be confirmed');
  }
}

async function binaryFailure(response: Response): Promise<Result<BinaryResponse>> {
  const input: unknown = await response.json();
  const checked = transportResponse.safeParse(input);
  if (!checked.success)
    return failure('invalid-response', 'The service returned an unreadable response');
  return checked.data.outcome.ok
    ? failure('invalid-response', 'The service returned no artifact')
    : { ok: false, error: checked.data.outcome.error };
}

async function binarySuccess(response: Response): Promise<Result<BinaryResponse>> {
  return {
    ok: true,
    value: {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mediaType: response.headers.get('Content-Type') ?? 'application/octet-stream',
      filename: parseFilename(response.headers.get('Content-Disposition')),
      revision: parseRevision(response.headers.get('X-Novakai-Export-Revision')),
    },
  };
}

function parseFilename(value: string | null): string | null {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

function parseRevision(value: string | null): number | null {
  if (value === null) return null;
  return validRevision(Number(value));
}

function validRevision(value: number): number | null {
  return Number.isInteger(value) && value >= 0 ? value : null;
}
/** Bind browser effects once. Consumer owns cleanup and receipt reconciliation; there is no automatic mutation retry. */
export function createServiceClient(): ServiceClient {
  return {
    get: (path, signal) => request(path, 'GET', null, signal),
    post: (path, input, signal) => request(path, 'POST', JSON.stringify(input), signal),
    bytes,
    changes,
  };
}
