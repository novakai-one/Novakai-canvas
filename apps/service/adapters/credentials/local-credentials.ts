/*
 * Why this file exists
 *
 * Only the person's own browser and CLI may use the service. For example, the CLI sends
 * `Authorization: Bearer <token>`, and the token comes from the workspace's
 * `agent-credential.json`. The browser gets a session cookie instead.
 *
 * This file makes and reads those secrets. The token file is made once, readable only by its
 * owner, and never overwritten. Each start makes a new browser secret. No secret ever goes into an
 * answer, URL, message or log. A bad token file is for the person to repair.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { HttpSecurity } from '../../contract/ports/transport.js';
import { loopbackIp } from '../../contract/records/transport/http.js';
import { failure, success, type Result } from '../../contract/errors.js';
import {
  agentToken,
  generation,
  sessionToken,
  type AgentToken,
  type HostPath,
  type LoopbackPort,
} from '../../contract/brands.js';

/** The credential file's contents. It has no diagram semantics. */
const credential = z.strictObject({
  version: z.literal(1),
  token: agentToken,
});

/** The largest credential file read, in bytes. */
const MAX_CREDENTIAL_BYTES = 1024;

/**
 * Makes this start's secrets for 127.0.0.1:`port`: the CLI's token (making its file on the first
 * start), a new browser session secret, and a new start label (`Generation`), so a change sent
 * before a restart is refused.
 * Fails with `unavailable` at `credential` when the token file can't be made, is a link or not a
 * plain file, is readable by others, or is malformed.
 */
export async function createLocalSecurity(
  port: LoopbackPort,
  credentialFile: HostPath,
): Promise<Result<HttpSecurity>> {
  try {
    await ensureCredential(credentialFile);
    const agent = await readCredential(credentialFile);
    if (!agent.ok) return agent;
    return success(security(port, agent.value));
  } catch {
    return refused('Local credentials could not be opened safely');
  }
}

/**
 * Reads the CLI's token from the credential file at `credentialFile` (its path as text). It never
 * makes a new token. Fails with `unavailable` at `credential` when the file is missing, a link,
 * readable by others, too large or malformed; the person starts the service first.
 */
export async function readAgentCredential(credentialFile: string): Promise<Result<AgentToken>> {
  try {
    return await readCredential(credentialFile);
  } catch {
    return refused('Agent credential could not be read; start the local service first');
  }
}

/**
 * Exclusive creation never overwrites an existing installation credential, including during
 * racing starts. Throws when the directory or file cannot be written.
 */
async function ensureCredential(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, 'wx', 0o600).catch(() => null);
  if (file === null) return;
  try {
    await file.writeFile(JSON.stringify({ version: 1, token: randomHex(32) }));
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * The agent token in the file at `path`; a symlink is never followed. Fails with `unavailable` at
 * `credential` when the file is not a regular file, is larger than 1 KiB, or fails `readPrivate`.
 * Throws when the file cannot be opened.
 */
async function readCredential(path: string): Promise<Result<AgentToken>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) return refused('Agent credential must be a regular file');
    if (metadata.size > MAX_CREDENTIAL_BYTES) return refused('Agent credential is malformed');
    return await readPrivate(file, metadata.mode);
  } finally {
    await file.close();
  }
}

/**
 * The mode is checked before the contents are read. Fails with `unavailable` at `credential` when
 * group or others may access the file, and otherwise as `parseCredential`.
 */
async function readPrivate(
  file: Awaited<ReturnType<typeof open>>,
  mode: number,
): Promise<Result<AgentToken>> {
  if ((mode & 0o077) !== 0) return refused('Agent credential requires owner-only permissions');
  const text = await file.readFile('utf8');
  return parseCredential(text);
}

/**
 * The token of a version 1 credential; a malformed file is never replaced. Fails with
 * `unavailable` at `credential` when the text is not JSON or not a version 1 credential.
 */
function parseCredential(text: string): Result<AgentToken> {
  try {
    const input: unknown = JSON.parse(text);
    const checked = credential.safeParse(input);
    if (!checked.success) return refused('Agent credential is malformed');
    return success(checked.data.token);
  } catch {
    return refused('Agent credential could not be decoded');
  }
}

/**
 * This start's security: the loopback address of `port`, the agent token, and a fresh browser
 * session (32 random bytes) and generation (16 random bytes), each minted with its brand. Never
 * fails.
 */
function security(
  port: LoopbackPort,
  agent: AgentToken,
): HttpSecurity {
  const host = `${loopbackIp}:${port}`;
  return {
    address: { host, origin: `http://${host}` },
    agentToken: agent,
    browserSession: sessionToken.parse(randomHex(32)),
    generation: generation.parse(randomHex(16)),
    equal,
  };
}

/** `unavailable` at `credential`: the operator repairs the credential file, then retries. */
function refused(message: string): Result<never> {
  return failure('unavailable', 'credential', message);
}

/** `size` random bytes as lowercase hex. */
function randomHex(size: number): string {
  return randomBytes(size).toString('hex');
}

/**
 * Whether untrusted text equals a secret. Unequal sizes are rejected before the native
 * constant-time comparison, so secret content never controls a comparison loop.
 */
function equal(
  untrusted: string,
  secret: string,
): boolean {
  const first = Buffer.from(untrusted);
  const second = Buffer.from(secret);
  if (first.length !== second.length) return false;
  return timingSafeEqual(first, second);
}
