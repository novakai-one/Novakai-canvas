import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  Result,
  Digest,
  BackupResources,
  RestoreResources,
  ResourceLease,
  RestoreLease,
} from '../contract/index.js';

/**
 * Verifies fixture bytes with an independent SHA-256, standing in for the Assets verifier.
 *
 * @param identity - The expected digest.
 * @param base64 - The bytes as base64.
 * @returns Success when the bytes hash to `identity`; otherwise a `corrupt-record` failure.
 */
export async function verifyBytes(
  identity: Digest,
  base64: string,
): Promise<Result<void>> {
  const actual = createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
  if (actual !== identity) {
    return failure('corrupt-record');
  }
  return { ok: true, value: undefined };
}

/**
 * A provider failure with `code`. Tests assert the code only, never this fixed message.
 *
 * @param code - The failure code.
 * @returns `{ ok: false }` with path `fixture` and a fixed message and recovery.
 */
export function failure<T>(
  code: 'corrupt-record' | 'missing-resource' | 'storage-unavailable',
): Result<T> {
  return {
    ok: false,
    error: { code, path: 'fixture', message: 'Injected failure', recovery: 'Retry fixture' },
  };
}

/**
 * Assets providers for backup and restore. The five mocks record their calls, so tests can check
 * lease lifetimes and the exact bytes passed. `verify` is the real {@link verifyBytes}, not a mock.
 * Mock signatures come from the Persistence provider ports.
 */
export interface ResourceFixture {
  readonly read: Mock<ResourceLease['read']>;
  readonly release: Mock<ResourceLease['release']>;
  readonly stage: Mock<RestoreLease['stage']>;
  readonly acquire: Mock<BackupResources['acquire']>;
  readonly reserve: Mock<RestoreResources['reserve']>;
  readonly verify: typeof verifyBytes;
}

/**
 * Creates the providers. By default every mock succeeds: `read` returns the bytes `abc` (base64
 * `YWJj`), and `acquire`/`reserve` hand out leases built from the same `read`, `stage` and
 * `release` mocks, so one `release` mock counts releases of both kinds of lease. `verify` checks
 * the real digest and can return `corrupt-record`.
 *
 * @returns Fresh providers; no state is shared between calls.
 */
export function resources(): ResourceFixture {
  const read = vi.fn<ResourceLease['read']>(async (): Promise<Result<string>> => ({
    ok: true,
    value: 'YWJj',
  }));
  const release = vi.fn<ResourceLease['release']>(async (): Promise<Result<void>> => ({
    ok: true,
    value: undefined,
  }));
  const stage = vi.fn<RestoreLease['stage']>(async (): Promise<Result<void>> => ({
    ok: true,
    value: undefined,
  }));
  const acquire = vi.fn<BackupResources['acquire']>(async (): Promise<Result<ResourceLease>> => ({
    ok: true,
    value: { read, release },
  }));
  const reserve = vi.fn<RestoreResources['reserve']>(async (): Promise<Result<RestoreLease>> => ({
    ok: true,
    value: { stage, release },
  }));
  return { read, release, stage, acquire, reserve, verify: verifyBytes };
}
