/*
 * Why this file exists
 *
 * Core can decide what a service command does, but it can't open a file or a connection. So
 * `read my-diagram` needs real parts plugged in first: the agent's token from the workspace, an
 * HTTP connection to `--server`, and the calls made over it. `create` also needs files, the
 * request journal and fresh request IDs.
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
import { createTransport } from '../../adapters/service-http/transport.js';
import { createServiceReads } from '../../adapters/service-http/reads.js';
import { createServiceAuthoring } from '../../adapters/service-http/authoring.js';
import { createServiceResources } from '../../adapters/service-http/resources.js';
import { runServiceCommand } from '../api.js';
import type { ServiceCommandDependencies } from '../api.js';
import type { FailureInput, Result } from '../errors.js';
import { failure, foreignFailure, success } from '../errors.js';
import type { ServiceCommand, ServerAndWorkspace } from '../records/command.js';
import {
  agentToken,
  requestId,
  type AgentToken,
  type FilePath,
  type RequestId,
} from '../brands.js';
import { composeLanguage } from './language.js';
import { composeThemeGrammar } from './theme-grammar.js';

/**
 * Runs one service command against the service at `options.server`, and gives back the text to
 * print. Fails if the agent's token can't be read, or as the command does.
 */
export async function runService(
  command: ServiceCommand,
  options: ServerAndWorkspace,
): Promise<Result<string>> {
  const token = await readToken(options.workspace);
  if (!token.ok) return token;
  return runServiceCommand(command, servicePorts(options, token.value));
}

/**
 * The agent token from the workspace credential. Fails with `credential-unavailable` (the
 * service's reader failed; its record is kept whole) or `invalid-response` (it returned no token).
 */
async function readToken(workspace: FilePath): Promise<Result<AgentToken>> {
  const credential = await readAgentCredential(resolve(workspace, 'agent-credential.json'));
  if (!credential.ok) return foreignFailure('credential-unavailable', credential.error);
  const token = agentToken.safeParse(credential.value);
  if (!token.success)
    return failure({ code: 'invalid-response', message: 'Agent credential holds no token' });
  return success(token.data);
}

/** Every service port, each bound once: three service-call adapters share one transport. */
function servicePorts(
  options: ServerAndWorkspace,
  token: AgentToken,
): ServiceCommandDependencies {
  const transport = createTransport(options.server, token);
  const files = createLocalFiles();
  return {
    reads: createServiceReads(transport),
    authoring: createServiceAuthoring(transport),
    resources: createServiceResources(transport),
    files,
    writer: files,
    journal: createRequestJournal(options.workspace),
    reader: createResourceReader(),
    collections: { validate },
    language: composeLanguage(),
    themeGrammar: composeThemeGrammar(),
    requestIds: { next: nextRequestId },
  };
}

/** Why a fresh request ID could not be minted. Nothing was sent. */
const unmintedRequestId: FailureInput = Object.freeze({
  code: 'cli-unavailable',
  message: "A fresh request ID did not match Authoring's request ID grammar",
  recovery: 'Rerun the command with --request and a valid request ID.',
});

/**
 * A fresh request ID. A UUID always matches Authoring's request ID grammar; if one did not, fails
 * with `cli-unavailable` before any Authoring request is sent.
 */
function nextRequestId(): Result<RequestId> {
  const minted = requestId.safeParse(randomUUID());
  if (!minted.success) return failure(unmintedRequestId);
  return success(minted.data);
}
