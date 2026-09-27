/*
 * Composition root: binds each command to real infrastructure (agent credential, HTTP transport,
 * Language, local files, request journal, headless render bindings). Not pure: reads files, calls
 * HTTP, mints request IDs. Failures are returned as values; `cli/canvas.ts` prints them and sets
 * the exit code. Recovery after a sent request is `receipt` then `retry`.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readAgentCredential } from '@novakai/canvas-service';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import { readArguments } from '../adapters/inputs/arguments.js';
import { createPresetInputs } from '../adapters/inputs/preset-inputs.js';
import { createResourceFiles } from '../adapters/files/resource-reader.js';
import { createLocalFiles } from '../adapters/files/local-files.js';
import { createRequestJournal } from '../adapters/files/request-journal.js';
import { createTransport } from '../adapters/service-http/transport.js';
import { createSemanticInputs } from '../adapters/inputs/semantic-inputs.js';
import { executeCommand, executeProfile, isProfileCommand, readThemeConfig, usage } from './api.js';
import type { Diagnostic, Result } from './errors.js';
import type { HeadlessFailure, HeadlessOptions, HeadlessReport } from './records/headless.js';
import { failure } from './errors.js';
/** Bind the actual CLI to protected credentials and real HTTP; failed setup cannot submit a diagram mutation. */
export async function runCli(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  try {
    const parsed = readArguments(args, defaultWorkspace);
    if (!parsed.ok) return parsed;
    return dispatch(parsed.value);
  } catch {
    return failure(
      'cli-unavailable',
      'CLI could not complete',
      'Retain the request ID and inspect its receipt before retrying.',
    );
  }
}
/** One owner-composed Language parser drives scope discovery; there is no second DSL implementation in the CLI. */
async function run(options: import('./records/command.js').CliOptions): Promise<Result<string>> {
  const credential = await readAgentCredential(
    resolve(options.workspaceDirectory, 'agent-credential.json'),
  );
  if (!credential.ok) return credential;
  const transport = createTransport(options.server, credential.value);
  if (!transport.ok) return transport;
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  return executeCommand(options.command, {
    transport: transport.value,
    resourceFiles: createResourceFiles(),
    files: {
      ...createLocalFiles(),
      ...createRequestJournal(resolve(options.workspaceDirectory, 'requests')),
    },
    semantic,
    presets: createPresetInputs(semantic, readThemeConfig),
    nextRequestId: randomUUID,
  });
}

/** Local help needs no infrastructure; authoring commands bind their real runtime before executing. */
function dispatch(options: import('./records/command.js').CliOptions): Promise<Result<string>> {
  if (options.command.name === 'help') return Promise.resolve({ ok: true, value: usage });
  if (isProfileCommand(options.command)) return runProfile(options);
  return run(options);
}

/** Profile discovery/scaffold/lint bind only the Language parser and local files. */
async function runProfile(
  options: import('./records/command.js').CliOptions,
): Promise<Result<string>> {
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  return executeProfile(options.command, { files: createLocalFiles(), semantic });
}

/** Headless export binds the same theme grammar and service owners without starting an HTTP server. */
export async function runHeadless(
  options: HeadlessOptions,
): Promise<Result<HeadlessReport, HeadlessFailure | Diagnostic>> {
  try {
    const [adapter, service] = await Promise.all([
      import('../adapters/edge/headless.js'),
      import('@novakai/canvas-service'),
    ]);
    return adapter.renderHeadless(options, {
      service: await service.createHeadlessBindings(),
      resourceFiles: createResourceFiles(),
      readTheme: readThemeConfig,
    });
  } catch {
    return failure(
      'render-unavailable',
      'Headless rendering could not initialize',
      'Restore local resources and retry.',
    );
  }
}
