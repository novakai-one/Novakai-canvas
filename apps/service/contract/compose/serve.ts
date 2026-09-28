/*
 * Why this file exists
 *
 * An open workspace is no use until the browser and the CLI can reach it. That needs a web server
 * on `127.0.0.1:<port>`, fresh secrets for this run, the CLI's token file, and the rules for who
 * may call what.
 *
 * This file starts that server for one open workspace. It never opens or closes the workspace:
 * if the server fails, the caller still has it. Every answer is a `Result` (see `errors.ts`).
 */
import type { WorkspaceSession } from '../types.js';
import type { LocalServer, ServerOptions } from '../records/transport/server.js';
import type { HttpAdmission, HttpSecurity, TransportPolicy } from '../ports/transport.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { createAdmission } from '../../core/transport/admission.js';
import { readApiQuery } from '../../core/transport/api-query.js';
import { createWebAppFileCheck } from '../../core/transport/web-app-file-check.js';
import { readChangeBody } from '../../core/transport/change-body.js';
import { eventFrames } from '../../core/transport/events.js';
import { readRequestBody } from '../../core/transport/request-body.js';
import { readHttpMetadata } from '../../core/transport/http-metadata.js';
import { classifyRequest } from '../../core/transport/request-kind.js';
import { createApiRouter } from '../../core/transport/routes.js';
import { createSourcePrinter } from '../../core/transport/source-printer.js';
import { buildTransportResponse, chooseHttpStatus } from '../../core/transport/status.js';
import { createServiceLanguage } from './capabilities.js';

/**
 * Serves one open workspace at `127.0.0.1:<port>`. Fails with `unavailable` at `credential` when
 * the CLI's token file can't be made or read safely, and `unavailable` at `server` when the port
 * can't be opened or the server code can't load. The workspace stays open either way.
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
    router: createApiRouter({
      session,
      resources: session.resources,
      generation: security.value.generation,
      admission,
      bodyReader: { read: readChangeBody },
      printer: createSourcePrinter(createServiceLanguage()),
    }),
  });
}

/** The core transport policy, with browser access bound to this server's admission and secret. */
function transportPolicy(
  admission: HttpAdmission,
  security: HttpSecurity,
): TransportPolicy {
  return {
    head: readHttpMetadata,
    body: readRequestBody,
    kind: classifyRequest,
    query: readApiQuery,
    status: chooseHttpStatus,
    envelope: buildTransportResponse,
    browserAccess: createWebAppFileCheck({ admission, security }),
    frames: eventFrames,
  };
}
