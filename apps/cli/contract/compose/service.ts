/*
 * Service-command wiring: the workspace's agent credential, one HTTP transport and the service
 * calls over it, local files, the request journal, the resource reader, Language, Model's
 * collection check and request IDs. Not pure: reads the credential file, calls HTTP and mints
 * UUIDs. Failures are returned as values; recovery after a sent request is `receipt` then `retry`.
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
import type { Result } from '../errors.js';
import { failure, rejected, success } from '../errors.js';
import type { ServiceCommand, ServiceOptions } from '../records/command.js';
import {
  agentToken,
  requestId,
  type AgentToken,
  type FilePath,
  type RequestId,
} from '../brands.js';
import { composeLanguage } from './language.js';

/**
 * Runs one service command against the service at `options.server`. Fails as {@link readToken}
 * or the command does.
 */
export async function runService(
  command: ServiceCommand,
  options: ServiceOptions,
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
  if (!credential.ok) return rejected('credential-unavailable', credential.error);
  const token = agentToken.safeParse(credential.value);
  if (!token.success)
    return failure({ code: 'invalid-response', message: 'Agent credential holds no token' });
  return success(token.data);
}

/** Every service port, each bound once: three service-call adapters share one transport. */
function servicePorts(
  options: ServiceOptions,
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
    journal: createRequestJournal(resolve(options.workspace, 'requests')),
    reader: createResourceReader(),
    collections: { validate },
    language: composeLanguage(),
    requestIds: { next: nextRequestId },
  };
}

/**
 * A fresh request ID. A UUID always matches Authoring's request ID grammar, so the parse cannot
 * fail; if it did, the throw would reach `cli/canvas.ts` before the Authoring request was sent.
 */
function nextRequestId(): RequestId {
  return requestId.parse(randomUUID());
}
