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
import type {
  ApiRouter,
  HttpAdmission,
  HttpSecurity,
  ServerBindings,
  StaticFiles,
  TransportPolicy,
} from '../ports/transport.js';
import type { Generation } from '../brands.js';
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
    return serverUnavailableFailure();
  }
}

/** Loads the server code, makes this run's secrets and the CLI's token file, then listens. */
async function startServer(
  session: WorkspaceSession,
  options: ServerOptions,
): Promise<Result<LocalServer>> {
  const [localCredentials, staticFiles, httpServer] = await Promise.all([
    import('../../adapters/credentials/local-credentials.js'),
    import('../../adapters/http/static-files.js'),
    import('../../adapters/http/server.js'),
  ]);
  const security = await localCredentials.createLocalSecurity(options.port, options.credentialFile);
  if (!security.ok) {
    return security;
  }
  const webAppFiles = staticFiles.createStaticFiles(options.webRoot);
  const bindings = serverBindings(session, security.value, webAppFiles);
  return httpServer.startHttpServer(options, bindings);
}

/** Builds everything the server answers with: who may come in, the routes and the web app files. */
function serverBindings(
  session: WorkspaceSession,
  security: HttpSecurity,
  files: StaticFiles,
): ServerBindings {
  const admission = createAdmission(security);
  const policy = transportPolicy(admission, security);
  const router = apiRouter(session, security.generation, admission);
  return { security, admission, changes: session, policy, files, router };
}

/** Builds the router that answers every API call on the open workspace. */
function apiRouter(
  session: WorkspaceSession,
  generation: Generation,
  admission: HttpAdmission,
): ApiRouter {
  const printer = createSourcePrinter(createServiceLanguage());
  return createApiRouter({
    session,
    resources: session.resources,
    generation,
    admission,
    bodyReader: { read: readChangeBody },
    printer,
  });
}

/** Builds the core transport policy, with browser access bound to this server's secrets. */
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

/** The `unavailable` failure at `server` for server code that threw while loading or starting. */
function serverUnavailableFailure(): Result<never> {
  return failure(
    'unavailable',
    'server',
    'HTTP bindings could not initialize; retain the existing workspace',
  );
}
