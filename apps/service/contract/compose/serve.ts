/*
 * HTTP serving and headless bindings: expose one already-open workspace through authenticated
 * loopback transport; the caller closes transport before draining its workspace. Read-only
 * headless composition shares the service's preset rules, render-job building and the
 * render-worker producer; the CLI owns retry after dependencies are restored.
 */
import type { WorkspaceSession } from '../types.js';
import type { LocalServer, ServerOptions } from '../records/transport/server.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { createAdmission as createHttpAdmission } from '../../core/transport/admission.js';
import { readCommand } from '../../core/transport/command.js';
import { readAuthoringRequest } from '../../core/transport/authoring-request.js';
import { createHttpRouter } from '../../core/transport/routes.js';
import { createPresetCodecs } from '../../core/presets/codecs.js';
import { prepareTheme } from '../../core/presets/theme-admission.js';
import { createRenderJobs } from '../../core/rendering/jobs.js';
import { createSourceReadout } from '../../core/transport/source-readout.js';
import { createServiceLanguage } from './capabilities.js';

/** Expose one already-open workspace through authenticated loopback transport. Caller closes transport before draining its workspace. */
export async function serveWorkspace(
  session: WorkspaceSession,
  options: ServerOptions,
): Promise<Result<LocalServer>> {
  try {
    const [credentials, io, files, server] = await Promise.all([
      import('../../adapters/credentials/local-credentials.js'),
      import('../../adapters/http/http-io.js'),
      import('../../adapters/http/static-files.js'),
      import('../../adapters/http/server.js'),
    ]);
    const security = await credentials.createLocalSecurity(options.port, options.credentialFile);
    if (!security.ok) return security;
    const admission = createHttpAdmission(security.value, { read: readAuthoringRequest });
    return server.startHttpServer(options, {
      security: security.value,
      admission,
      changes: session,
      io: io.createHttpIo(),
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
  } catch {
    return failure(
      'unavailable',
      'server',
      'HTTP bindings could not initialize; retain the existing workspace',
    );
  }
}

/** Local agent bootstrap reads an existing protected credential; browser consumers must use their HttpOnly session instead. */
export async function readAgentCredential(path: string): Promise<Result<string>> {
  const credentials = await import('../../adapters/credentials/local-credentials.js');
  return credentials.readAgentCredential(path);
}

/** Read-only headless composition shares the preset codecs, theme admission, render jobs and producer. CLI runHeadless catches import failures, reports render-unavailable and owns retry after dependencies are restored. */
export async function createHeadlessBindings() {
  const rendering = await import('../../adapters/render-worker/derive.js');
  return {
    createPresetCodecs,
    prepareTheme,
    createRenderJobs,
    produceDiagram: rendering.produceDiagram,
  };
}
