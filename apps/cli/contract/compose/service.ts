/*
 * Why this file exists
 *
 * Core can decide what a service command does, but it can't open a file or a connection. So
 * `read my-diagram` needs real parts plugged in first: the agent's token from the workspace, an
 * HTTP connection to `--server`, and the read, change and file-store calls made over it. `create`
 * also needs files, the request journal and fresh request IDs.
 *
 * This file builds those parts for one command, then runs it. It reads the credential file and
 * makes random IDs. Mistakes come back as values, never thrown.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readAgentCredential } from '@novakai/canvas-service';
import { validate } from '@novakai/canvas-model';
import { createLocalFiles } from '../../adapters/files/local-files.js';
import { createRequestJournal } from '../../adapters/files/request-journal.js';
import { createResourceReader } from '../../adapters/files/resource-reader.js';
import { createHttpTransport } from '../../adapters/service-http/transport.js';
import { createServiceReads } from '../../adapters/service-http/reads.js';
import { createServiceAuthoring } from '../../adapters/service-http/authoring.js';
import { createServiceResources } from '../../adapters/service-http/resources.js';
import { runServiceCommand } from '../api.js';
import type { ServiceCommandDependencies } from '../api.js';
import type { LocalFailure, Result } from '../errors.js';
import { failure, foreignFailure, success } from '../errors.js';
import type { ServiceCommand, ServerAndWorkspace } from '../records/command.js';
import {
  agentToken,
  requestId,
  type AgentToken,
  type FilePath,
  type RequestId,
} from '../brands.js';
import { createLanguageWithModel } from './language.js';
import { createThemeReader } from './theme-reader.js';

/**
 * Runs one service command against `--server`, with the agent's token from the `--workspace`
 * folder, and gives back the text to print. Fails if the token can't be read, or as the command
 * does.
 */
export async function runService(
  command: ServiceCommand,
  serverAndWorkspace: ServerAndWorkspace,
): Promise<Result<string>> {
  const token = await readToken(serverAndWorkspace.workspace);
  if (!token.ok) {
    return token;
  }
  const dependencies = createServiceDependencies(serverAndWorkspace, token.value);
  return runServiceCommand(command, dependencies);
}

/**
 * Reads the agent's token from the workspace's credential file. Fails with
 * `credential-unavailable` (the service's reader failed; its record is kept whole), or
 * `invalid-response` when the file holds no token.
 */
async function readToken(workspace: FilePath): Promise<Result<AgentToken>> {
  const credentialFile = resolve(workspace, 'agent-credential.json');
  const credential = await readAgentCredential(credentialFile);
  if (!credential.ok) {
    return foreignFailure('credential-unavailable', credential.error);
  }
  return checkToken(credential.value);
}

/**
 * Checks the token text read from the credential file isn't empty. Fails with `invalid-response`
 * when it is.
 */
function checkToken(tokenText: string): Result<AgentToken> {
  const token = agentToken.safeParse(tokenText);
  if (!token.success) {
    return missingTokenFailure();
  }
  return success(token.data);
}

/** Builds every part a service command uses. The three service-call parts share one connection. */
function createServiceDependencies(
  serverAndWorkspace: ServerAndWorkspace,
  token: AgentToken,
): ServiceCommandDependencies {
  const transport = createHttpTransport(serverAndWorkspace.server, token);
  const files = createLocalFiles();
  return {
    reads: createServiceReads(transport),
    authoring: createServiceAuthoring(transport),
    resources: createServiceResources(transport),
    files,
    writer: files,
    journal: createRequestJournal(serverAndWorkspace.workspace),
    reader: createResourceReader(),
    collections: { validate },
    language: createLanguageWithModel(),
    themeReader: createThemeReader(),
    requestIds: { next: mintRequestId },
  };
}

/**
 * Makes a fresh request ID from a random UUID. A UUID always fits Authoring's request ID rules;
 * if one ever didn't, it fails with `cli-unavailable` before anything is sent.
 */
function mintRequestId(): Result<RequestId> {
  const uuid = randomUUID();
  const minted = requestId.safeParse(uuid);
  if (!minted.success) {
    return unmintedRequestIdFailure();
  }
  return success(minted.data);
}

/** Makes the failure for a credential file that holds no token (`invalid-response`). */
function missingTokenFailure(): Result<never, LocalFailure> {
  return failure({ code: 'invalid-response', message: 'Agent credential holds no token' });
}

/** Makes the failure for a fresh request ID that didn't fit Authoring's rules (`cli-unavailable`). */
function unmintedRequestIdFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'cli-unavailable',
    message: "A fresh request ID did not match Authoring's request ID grammar",
    recovery: 'Rerun the command with --request and a valid request ID.',
  });
}
