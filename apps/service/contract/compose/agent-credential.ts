/*
 * The local agent credential for CLI clients: read the protected file the server created. The
 * credential adapter loads lazily, so the package entry pulls in no Node file or crypto module.
 * Read only: a missing or invalid file never creates a new identity; the user starts the local
 * service (which creates it) and retries.
 */
import type { Result } from '../errors.js';
import type { AgentToken } from '../brands.js';

/**
 * Reads the agent token from the credential file at `path`. Browser consumers use their HttpOnly
 * session instead. Fails with `unavailable` at `credential` when the file is missing, a symlink,
 * not a regular file, readable by others, too large or malformed. A failed adapter import rejects;
 * the CLI entry (`apps/cli/cli/main.ts`) reports it and exits 1.
 */
export async function readAgentCredential(path: string): Promise<Result<AgentToken>> {
  const credentials = await import('../../adapters/credentials/local-credentials.js');
  return credentials.readAgentCredential(path);
}
