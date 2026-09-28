/*
 * Why this file exists
 *
 * The CLI must prove it may use the service. It sends a secret token with every request, and it
 * finds that token in the workspace's `agent-credential.json`, which the service wrote on its first
 * start.
 *
 * This file lets the CLI read that token; adapters/credentials does the reading. It only reads: a
 * missing or bad file never makes a new token. The file-reading code loads only when called, so
 * the web app's bundle stays free of Node file and crypto code.
 */
import type { Result } from '../errors.js';
import type { AgentToken } from '../brands.js';

/**
 * Reads the CLI's secret token from the credential file at `credentialFile` (its path as text).
 * Fails with `unavailable` at `credential` when the file is missing, a link, readable by others,
 * too large or malformed. Throws only if the file-reading code can't load.
 */
export async function readAgentCredential(credentialFile: string): Promise<Result<AgentToken>> {
  const credentials = await import('../../adapters/credentials/local-credentials.js');
  return credentials.readAgentCredential(credentialFile);
}
