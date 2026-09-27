/*
 * HTTP serving and headless bindings: expose one already-open workspace through authenticated
 * loopback transport; the caller closes transport before draining its workspace. Read-only
 * headless composition shares service adapters; the CLI owns retry after dependencies are
 * restored.
 */
import type { WorkspaceSession } from '../types.js';
import type { LocalServer, ServerOptions } from '../records/transport/server.js';
import type { Result } from '../errors.js';
import { failure } from '../errors.js';
import { createAdmission as createHttpAdmission } from '../../core/transport/admission.js';
import { readCommand } from '../../core/transport/command.js';
import { createServiceLanguage } from './capabilities.js';

/** Expose one already-open workspace through authenticated loopback transport. Caller closes transport before draining its workspace. */
export async function serveWorkspace(
  session: WorkspaceSession,
  options: ServerOptions,
): Promise<Result<LocalServer>> {
  try {
    const [credentials, requests, router, source, io, files, server] = await Promise.all([
      import('../../adapters/credentials/local-credentials.js'),
      import('../../adapters/http/request-reader.js'),
      import('../../adapters/http/http-router.js'),
      import('../../adapters/rendering/language-readout.js'),
      import('../../adapters/http/http-io.js'),
      import('../../adapters/http/static-files.js'),
      import('../../adapters/http/server.js'),
    ]);
    const security = await credentials.createLocalSecurity(options.port, options.credentialFile);
    if (!security.ok) return security;
    const admission = createHttpAdmission(security.value, { read: requests.readAuthoringRequest });
    return server.startHttpServer(options, {
      security: security.value,
      admission,
      changes: session,
      io: io.createHttpIo(),
      files: files.createStaticFiles(options.webRoot),
      router: router.createHttpRouter({
        session,
        generation: security.value.generation,
        admission,
        decoder: { read: readCommand },
        source: source.createSourceReadout(createServiceLanguage()),
        exporter: session.exportArtifact,
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

/** Read-only headless composition shares service adapters. CLI runHeadless catches import failures, reports render-unavailable and owns retry after dependencies are restored. */
export async function createHeadlessBindings() {
  const [codecs, themes, jobs, rendering] = await Promise.all([
    import('../../adapters/builtins/preset-codecs.js'),
    import('../../adapters/rendering/theme-preparation.js'),
    import('../../adapters/rendering/render-jobs.js'),
    import('../../adapters/render-worker/derive.js'),
  ]);
  return {
    createPresetCodecs: codecs.createPresetCodecs,
    prepareTheme: themes.prepareTheme,
    createRenderJobs: jobs.createRenderJobs,
    produceDiagram: rendering.produceDiagram,
  };
}
