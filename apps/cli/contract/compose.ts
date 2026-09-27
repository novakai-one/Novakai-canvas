/*
 * Composition root: reads the arguments, then binds the parsed command's family to real
 * infrastructure (agent credential, HTTP transport, Language, local files, request journal,
 * headless render bindings, render file I/O). Not pure: reads files, calls HTTP, mints request
 * IDs. Failures are returned as values; `cli/canvas.ts` prints them and sets the exit code.
 * Recovery after a sent request is `receipt` then `retry`.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readAgentCredential } from '@novakai/canvas-service';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import { readArguments } from '../adapters/inputs/arguments.js';
import { createPresetInputs } from '../adapters/inputs/preset-inputs.js';
import { createResourceReader } from '../adapters/files/resource-reader.js';
import { createLocalFiles } from '../adapters/files/local-files.js';
import { createRequestJournal } from '../adapters/files/request-journal.js';
import { createTransport } from '../adapters/service-http/transport.js';
import { createSemanticInputs } from '../adapters/inputs/semantic-inputs.js';
import { executeCommand, executeProfile, parseCommand, readThemeConfig, usage } from './api.js';
import type { LocalFailure, Result } from './errors.js';
import type {
  ParsedCommand,
  ProfileCommand,
  ServiceCommand,
  ServiceOptions,
} from './records/command.js';
import type { HeadlessFailure, HeadlessOptions, HeadlessReport } from './records/headless.js';
import { failure, rejected, success } from './errors.js';
import { agentToken, requestId, type AgentToken, type RequestId } from './brands.js';
/** Bind the actual CLI to protected credentials and real HTTP; failed setup cannot submit a diagram mutation. */
export async function runCli(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  try {
    return parsedRun(args, defaultWorkspace);
  } catch {
    return failure({
      code: 'cli-unavailable',
      message: 'CLI could not complete',
      recovery: 'Retain the request ID and inspect its receipt before retrying.',
    });
  }
}
/** The adapter reads the words and flags; core checks every value; then the command runs. */
function parsedRun(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  const words = readArguments(args, defaultWorkspace);
  if (!words.ok) return Promise.resolve(words);
  const parsed = parseCommand(words.value);
  if (!parsed.ok) return Promise.resolve(parsed);
  return dispatch(parsed.value);
}

/** One owner-composed Language parser drives scope discovery; there is no second DSL implementation in the CLI. */
async function run(
  command: ServiceCommand,
  options: ServiceOptions,
): Promise<Result<string>> {
  const token = await readToken(options.workspace);
  if (!token.ok) return token;
  const transport = createTransport(options.server, token.value);
  if (!transport.ok) return transport;
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  return executeCommand(command, {
    transport: transport.value,
    files: createLocalFiles(),
    journal: createRequestJournal(resolve(options.workspace, 'requests')),
    resources: createResourceReader(),
    semantic,
    presets: createPresetInputs(semantic, readThemeConfig),
    nextRequestId,
  });
}

/**
 * The agent token from the workspace credential. Fails with `credential-unavailable` (the
 * service's reader failed; its record is kept whole) or `invalid-response` (it returned no token).
 */
async function readToken(workspace: string): Promise<Result<AgentToken>> {
  const credential = await readAgentCredential(resolve(workspace, 'agent-credential.json'));
  if (!credential.ok) return rejected('credential-unavailable', credential.error);
  const token = agentToken.safeParse(credential.value);
  if (!token.success)
    return failure({ code: 'invalid-response', message: 'Agent credential holds no token' });
  return success(token.data);
}

/**
 * A fresh request ID. A UUID always matches Authoring's request ID grammar, so the parse cannot
 * fail; runCli's catch would report `cli-unavailable` before anything was sent.
 */
function nextRequestId(): RequestId {
  return requestId.parse(randomUUID());
}

/** Local help needs no infrastructure; profile commands bind local ports; service commands bind their real runtime. */
function dispatch(parsed: ParsedCommand): Promise<Result<string>> {
  if (parsed.kind === 'help') return Promise.resolve(success(usage));
  if (parsed.kind === 'profile') return runProfile(parsed.command);
  return run(parsed.command, parsed.options);
}

/** Profile discovery/scaffold/lint bind only the Language parser and local files. */
async function runProfile(command: ProfileCommand): Promise<Result<string>> {
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  return executeProfile(command, { files: createLocalFiles(), semantic });
}

/**
 * Headless export binds the same theme grammar and service owners without starting an HTTP
 * server, plus the render's temporary asset store and file I/O. The render adapters are imported
 * lazily, like the headless adapter.
 */
export async function runHeadless(
  options: HeadlessOptions,
): Promise<Result<HeadlessReport, HeadlessFailure | LocalFailure>> {
  try {
    const [adapter, service, temp, files, raster] = await Promise.all([
      import('../adapters/edge/headless.js'),
      import('@novakai/canvas-service'),
      import('../adapters/render/temp-assets.js'),
      import('../adapters/render/render-files.js'),
      import('../adapters/render/raster.js'),
    ]);
    return adapter.renderHeadless(options, {
      service: await service.createHeadlessBindings(),
      resources: createResourceReader(),
      readTheme: readThemeConfig,
      temp: temp.createTempAssets(),
      files: { ...files.createRenderFiles(options), ...raster.createRaster(options.root) },
    });
  } catch {
    return failure({
      code: 'render-unavailable',
      message: 'Headless rendering could not initialize',
      recovery: 'Restore local resources and retry.',
    });
  }
}
