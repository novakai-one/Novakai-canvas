import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import type { HttpSecurity } from '../../contract/records/http.js';
/** Credentials have no diagram semantics. Their bytes never enter an API response, URL, diagnostic or log. */
const credential = z.strictObject({
  version: z.literal(1),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Refuse symlinked or broadly readable credentials; repair the local file before retrying startup. */
async function readCredential(path: string): Promise<Result<string>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile())
      return failure('unavailable', 'credential', 'Agent credential must be a regular file');
    if (metadata.size > 1024)
      return failure('unavailable', 'credential', 'Agent credential is malformed');
    return await readPrivate(file, metadata.mode);
  } finally {
    await file.close();
  }
}
/** Read-only credential access for a local CLI; a missing or invalid credential never creates a new installation identity. */
export async function readAgentCredential(path: string): Promise<Result<string>> {
  try {
    return await readCredential(path);
  } catch {
    return failure(
      'unavailable',
      'credential',
      'Agent credential could not be read; start the local service first',
    );
  }
}
/** File-size and mode bounds are checked before parsing; a malformed credential is never silently replaced. */
async function readPrivate(
  file: Awaited<ReturnType<typeof open>>,
  mode: number,
): Promise<Result<string>> {
  if ((mode & 0o077) !== 0)
    return failure('unavailable', 'credential', 'Agent credential requires owner-only permissions');
  const text = await file.readFile('utf8');
  return parseCredential(text);
}
/** JSON errors become a typed startup failure; operators retain the original credential for recovery. */
function parseCredential(text: string): Result<string> {
  try {
    const input: unknown = JSON.parse(text);
    const checked = credential.safeParse(input);
    if (!checked.success)
      return failure('unavailable', 'credential', 'Agent credential is malformed');
    return { ok: true, value: checked.data.token };
  } catch {
    return failure('unavailable', 'credential', 'Agent credential could not be decoded');
  }
}
/** Exclusive creation never overwrites an existing installation credential, including during racing starts. */
async function ensureCredential(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, 'wx', 0o600).catch(() => null);
  if (file === null) return;
  try {
    await file.writeFile(JSON.stringify({ version: 1, token: randomBytes(32).toString('hex') }));
    await file.sync();
  } finally {
    await file.close();
  }
}
/** Reject unequal sizes before the native constant-time comparison; secret content never controls a string comparison loop. */
function equal(
  left: string,
  right: string,
): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  if (first.length !== second.length) return false;
  return timingSafeEqual(first, second);
}
/** Initialize a restart-scoped browser session and persistent agent credential. Failed startup grants no authentication. */
export async function createLocalSecurity(
  port: number,
  path: string,
): Promise<Result<HttpSecurity>> {
  try {
    await ensureCredential(path);
    const agent = await readCredential(path);
    if (!agent.ok) return agent;
    const host = `127.0.0.1:${port}`;
    return {
      ok: true,
      value: {
        host,
        origin: `http://${host}`,
        agentToken: agent.value,
        browserSession: randomBytes(32).toString('hex'),
        generation: randomBytes(16).toString('hex'),
        equal,
      },
    };
  } catch {
    return failure('unavailable', 'credential', 'Local credentials could not be opened safely');
  }
}
