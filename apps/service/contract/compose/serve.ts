/*
 * HTTP serving: expose one already-open workspace through authenticated loopback transport. The
 * socket, static-file and credential adapters load lazily; admission, the router and the transport
 * policy bind to the server's security. Every failure is a value; the caller keeps the workspace,
 * closes transport before draining it, and retries startup.
 */
import type { WorkspaceSession } from '../types.js';
import type { LocalServer, ServerOptions } from '../records/transport/server.js';
import type { HttpAdmission, HttpSecurity, TransportPolicy } from '../ports/transport.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { createAdmission } from '../../core/transport/admission.js';
import { apiQuery } from '../../core/transport/api-query.js';
import { createBrowserAccess } from '../../core/transport/browser-access.js';
import { readCommand } from '../../core/transport/command.js';
import { eventFrames } from '../../core/transport/events.js';
import { requestBody } from '../../core/transport/request-body.js';
import { requestHead } from '../../core/transport/request-head.js';
import { requestKind } from '../../core/transport/request-kind.js';
import { createHttpRouter } from '../../core/transport/routes.js';
import { createSourceReadout } from '../../core/transport/source-readout.js';
import { httpStatus, transportResponse } from '../../core/transport/status.js';
import { createServiceLanguage } from './capabilities.js';

/**
 * Serves one already-open workspace on the configured loopback port. Fails with `unavailable` at
 * `credential` when the credential file cannot be created, is unsafe or is malformed,
 * `unavailable` at `server` when the port cannot be opened, and `unavailable` at `server` ("HTTP
 * bindings could not initialize") when an adapter cannot load or anything else throws. The
 * workspace stays open for the caller.
 */
export async function serveWorkspace(
  session: WorkspaceSession,
  options: ServerOptions,
): Promise<Result<LocalServer>> {
  try {
    return await startServer(session, options);
  } catch {
    return failure(
      'unavailable',
      'server',
      'HTTP bindings could not initialize; retain the existing workspace',
    );
  }
}

/**
 * Loads the adapters, creates this server's security and starts the socket. Fails as
 * `serveWorkspace` names; throws when an adapter cannot load.
 */
async function startServer(
  session: WorkspaceSession,
  options: ServerOptions,
): Promise<Result<LocalServer>> {
  const [credentials, files, server] = await Promise.all([
    import('../../adapters/credentials/local-credentials.js'),
    import('../../adapters/http/static-files.js'),
    import('../../adapters/http/server.js'),
  ]);
  const security = await credentials.createLocalSecurity(options.port, options.credentialFile);
  if (!security.ok) return security;
  const admission = createAdmission(security.value);
  return server.startHttpServer(options, {
    security: security.value,
    admission,
    changes: session,
    policy: transportPolicy(admission, security.value),
    files: files.createStaticFiles(options.webRoot),
    router: createHttpRouter({
      session,
      resources: session.resources,
      generation: security.value.generation,
      admission,
      decoder: { read: readCommand },
      source: createSourceReadout(createServiceLanguage()),
    }),
  });
}

/** The core transport policy, with browser access bound to this server's admission and secret. */
function transportPolicy(
  admission: HttpAdmission,
  security: HttpSecurity,
): TransportPolicy {
  return {
    head: requestHead,
    body: requestBody,
    kind: requestKind,
    query: apiQuery,
    status: httpStatus,
    envelope: transportResponse,
    browserAccess: createBrowserAccess({ admission, security }),
    frames: eventFrames,
  };
}
