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
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
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

/** What the token file holds. It has nothing to do with diagrams. */
const credentialFileSchema = z.strictObject({
  version: z.literal(1),
  token: agentToken,
});

/** The largest token file that is read, in bytes. */
const MAX_CREDENTIAL_BYTES = 1024;

/** How many random bytes make the CLI's token. */
const TOKEN_BYTES = 32;
/** How many random bytes make the browser's session secret. */
const SESSION_BYTES = 32;
/** How many random bytes make the start label (`Generation`). */
const GENERATION_BYTES = 16;

/** The token's folder: only its owner may open it. */
const OWNER_ONLY_FOLDER = 0o700;
/** The token file: only its owner may read and write it. */
const OWNER_ONLY_FILE = 0o600;

/** The permission bits that let the file's group or other users in. */
const GROUP_AND_OTHER_ACCESS = 0o077;

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
    await ensureCredentialFile(credentialFile);
    const token = await readCredentialFile(credentialFile);
    if (!token.ok) {
      return token;
    }
    const security = startSecurity(port, token.value);
    return success(security);
  } catch {
    return unsafeCredentialsFailure();
  }
}

/**
 * Reads the CLI's token from the credential file at `credentialFile` (its path as text). It never
 * makes a new token. Fails with `unavailable` at `credential` when the file is missing, a link,
 * readable by others, too large or malformed; the person starts the service first.
 */
export async function readAgentCredential(credentialFile: string): Promise<Result<AgentToken>> {
  try {
    return await readCredentialFile(credentialFile);
  } catch {
    return unreadableCredentialFailure();
  }
}

/**
 * Makes the token file with a new token, unless a file is already there. Two starts at once never
 * overwrite each other's file. Throws when the folder or the new file can't be written.
 */
async function ensureCredentialFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: OWNER_ONLY_FOLDER });
  const newFile = await openNewFile(path);
  if (newFile === null) {
    return;
  }
  await writeNewCredential(newFile);
}

/** Opens a new owner-only file at `path`; `null` when it can't, usually because one exists. */
async function openNewFile(path: string): Promise<FileHandle | null> {
  return open(path, 'wx', OWNER_ONLY_FILE).catch(() => null);
}

/** Writes a version 1 credential with a new random token into the new file, then closes it. */
async function writeNewCredential(file: FileHandle): Promise<void> {
  const credentialText = JSON.stringify({ version: 1, token: randomHex(TOKEN_BYTES) });
  try {
    await file.writeFile(credentialText);
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Reads the token from the file at `path`, without following a link. Throws when the file can't
 * be opened.
 */
async function readCredentialFile(path: string): Promise<Result<AgentToken>> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await readOpenCredential(file);
  } finally {
    await file.close();
  }
}

/** Checks the open file is safe to trust, then reads the token out of its text. */
async function readOpenCredential(file: FileHandle): Promise<Result<AgentToken>> {
  const metadata = await file.stat();
  const checked = checkCredentialFile(metadata);
  if (!checked.ok) {
    return checked;
  }
  const text = await file.readFile('utf8');
  return parseCredential(text);
}

/** Checks the file is a plain file of at most 1 KiB, then that only its owner may use it. */
function checkCredentialFile(metadata: Stats): Result<void> {
  if (!metadata.isFile()) {
    return notPlainFileFailure();
  }
  if (metadata.size > MAX_CREDENTIAL_BYTES) {
    return malformedCredentialFailure();
  }
  return checkOwnerOnly(metadata.mode);
}

/** Checks that neither the file's group nor other users may use it. */
function checkOwnerOnly(mode: number): Result<void> {
  if (isOpenToOthers(mode)) {
    return sharedCredentialFailure();
  }
  return success(undefined);
}

/** Whether the file's group or other users have any access to it. */
function isOpenToOthers(mode: number): boolean {
  const othersAccess = mode & GROUP_AND_OTHER_ACCESS;
  return othersAccess !== 0;
}

/** Reads the token out of the file's text, which must be a version 1 credential. */
function parseCredential(text: string): Result<AgentToken> {
  const json = readCredentialJson(text);
  if (!json.ok) {
    return json;
  }
  const credential = credentialFileSchema.safeParse(json.value);
  if (!credential.success) {
    return malformedCredentialFailure();
  }
  const token = credential.data.token;
  return success(token);
}

/** Reads the file's text as JSON. */
function readCredentialJson(text: string): Result<unknown> {
  try {
    const json: unknown = JSON.parse(text);
    return success(json);
  } catch {
    return undecodableCredentialFailure();
  }
}

/** Puts this start's security together: its address, the CLI's token and new random secrets. */
function startSecurity(
  port: LoopbackPort,
  token: AgentToken,
): HttpSecurity {
  const host = `${loopbackIp}:${port}`;
  const origin = `http://${host}`;
  const browserSession = sessionToken.parse(randomHex(SESSION_BYTES));
  const startLabel = generation.parse(randomHex(GENERATION_BYTES));
  return {
    address: { host, origin },
    agentToken: token,
    browserSession,
    generation: startLabel,
    equal: matchesSecret,
  };
}

/** Makes `size` random bytes, written as lowercase hex. */
function randomHex(size: number): string {
  return randomBytes(size).toString('hex');
}

/**
 * Whether the untrusted text equals the secret. Texts of different lengths never match; equal
 * lengths are compared in constant time, so the secret's content never steers the comparison.
 */
function matchesSecret(
  untrusted: string,
  secret: string,
): boolean {
  const untrustedBytes = Buffer.from(untrusted);
  const secretBytes = Buffer.from(secret);
  const sameLength = untrustedBytes.length === secretBytes.length;
  if (!sameLength) {
    return false;
  }
  return timingSafeEqual(untrustedBytes, secretBytes);
}

/** Makes the mistake for a token file that couldn't be made or opened safely. */
function unsafeCredentialsFailure(): Result<never> {
  return failure('unavailable', 'credential', 'Local credentials could not be opened safely');
}

/** Makes the mistake for a token file the CLI couldn't read. */
function unreadableCredentialFailure(): Result<never> {
  return failure(
    'unavailable',
    'credential',
    'Agent credential could not be read; start the local service first',
  );
}

/** Makes the mistake for a token file that is not a plain file. */
function notPlainFileFailure(): Result<never> {
  return failure('unavailable', 'credential', 'Agent credential must be a regular file');
}

/** Makes the mistake for a token file that others may use. */
function sharedCredentialFailure(): Result<never> {
  return failure('unavailable', 'credential', 'Agent credential requires owner-only permissions');
}

/** Makes the mistake for a token file that is too large or isn't a version 1 credential. */
function malformedCredentialFailure(): Result<never> {
  return failure('unavailable', 'credential', 'Agent credential is malformed');
}

/** Makes the mistake for a token file whose text isn't JSON. */
function undecodableCredentialFailure(): Result<never> {
  return failure('unavailable', 'credential', 'Agent credential could not be decoded');
}
