/*
 * Composition root: reads the arguments, then binds the parsed command's family to real
 * infrastructure (agent credential, HTTP transport and the service calls over it, Language, Model,
 * local files, request journal, headless render bindings, render file I/O). Not pure: reads files, calls HTTP, mints request
 * IDs. Failures are returned as values; `cli/canvas.ts` and `cli/render.ts` print them and set the
 * exit code. Recovery after a sent request is `receipt` then `retry`; a render changes nothing.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readAgentCredential } from '@novakai/canvas-service';
import { createLanguage } from '@novakai/canvas-language';
import { validate, plan, stage } from '@novakai/canvas-model';
import { readArguments } from '../adapters/argv/node-args.js';
import { createPresetInputs } from '../adapters/inputs/preset-inputs.js';
import { createResourceReader } from '../adapters/files/resource-reader.js';
import { createLocalFiles } from '../adapters/files/local-files.js';
import { createRequestJournal } from '../adapters/files/request-journal.js';
import { createTransport } from '../adapters/service-http/transport.js';
import { createServiceReads } from '../adapters/service-http/reads.js';
import { createServiceAuthoring } from '../adapters/service-http/authoring.js';
import { createServiceResources } from '../adapters/service-http/resources.js';
import { createSemanticInputs } from '../adapters/inputs/semantic-inputs.js';
import {
  executeCommand,
  executeProfile,
  parseCommand,
  parseRenderChoice,
  readThemeSource,
  usage,
} from './api.js';
import type { CliFailure, LocalFailure, Result } from './errors.js';
import { canvasFlags, renderFlags } from './records/arguments.js';
import type {
  ParsedCommand,
  ProfileCommand,
  ServiceCommand,
  ServiceOptions,
} from './records/command.js';
import type { RenderChoice, RenderReport } from './records/render.js';
import type { RenderFailure } from './records/render-failure.js';
import { failure, rejected, success } from './errors.js';
import {
  agentToken,
  filePath,
  requestId,
  type AgentToken,
  type FilePath,
  type RequestId,
} from './brands.js';

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

/**
 * `pnpm render:png`: Node reads the argv with every `--` dropped (pnpm forwards it), core's render
 * grammar checks it, then one read-only render runs below the repo `root`. Fails with
 * `invalid-arguments` before anything is read or made; otherwise as {@link runHeadless}.
 */
export async function runRender(
  args: readonly string[],
  root: string,
): Promise<Result<RenderReport, RenderFailure | CliFailure>> {
  const choice = parseRenderChoice(readArguments(args.filter(isNotSeparator), renderFlags));
  if (!choice.ok) return choice;
  return runHeadless(choice.value, root);
}

/** Node reads the argv; core's grammar checks every word and value; then the command runs. */
function parsedRun(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  const parsed = parseCommand(readArguments(args, canvasFlags), { workspace: defaultWorkspace });
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
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  const transport = createTransport(options.server, token.value);
  return executeCommand(command, {
    reads: createServiceReads(transport),
    authoring: createServiceAuthoring(transport),
    resources: createServiceResources(transport),
    files: createLocalFiles(),
    journal: createRequestJournal(resolve(options.workspace, 'requests')),
    reader: createResourceReader(),
    collections: { validate },
    semantic,
    presets: createPresetInputs(semantic, readThemeSource),
    nextRequestId,
  });
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

/**
 * A fresh request ID. A UUID always matches Authoring's request ID grammar, so the parse cannot
 * fail; runCli's catch would report `cli-unavailable` before anything was sent.
 */
function nextRequestId(): RequestId {
  return requestId.parse(randomUUID());
}

/** Local help needs no infrastructure; profile commands bind local ports; service commands bind their real runtime. */
function dispatch(parsed: ParsedCommand): Promise<Result<string>> {
  switch (parsed.kind) {
    case 'help':
      return Promise.resolve(success(usage));
    case 'profile':
      return runProfile(parsed.command);
    case 'service':
      return run(parsed.command, parsed.options);
  }
}

/** Profile discovery/scaffold/lint bind only the Language parser and local files. */
async function runProfile(command: ProfileCommand): Promise<Result<string>> {
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const semantic = createSemanticInputs(language);
  return executeProfile(command, { files: createLocalFiles(), semantic });
}

/** Whether the argv word is anything but pnpm's `--` separator. */
function isNotSeparator(arg: string): boolean {
  return arg !== '--';
}

/**
 * Headless export binds the same theme grammar and service owners without starting an HTTP
 * server, plus the render's temporary asset store and file I/O. The render adapters are imported
 * lazily, like the headless adapter. Fails with `render-failed`, or `render-unavailable` when
 * set-up throws; that includes an empty `root`, which a directory URL never gives. A
 * temporary-directory failure is not caught: it rejects with the OS error, which `cli/render.ts`
 * prints.
 */
async function runHeadless(
  choice: RenderChoice,
  root: string,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  try {
    const request = { ...choice, root: filePath.parse(root) };
    const [adapter, service, temp, files, raster] = await Promise.all([
      import('../adapters/edge/headless.js'),
      import('@novakai/canvas-service'),
      import('../adapters/render/temp-assets.js'),
      import('../adapters/render/render-files.js'),
      import('../adapters/render/raster.js'),
    ]);
    return adapter.renderHeadless(request, {
      service: await service.createHeadlessBindings(),
      resources: createResourceReader(),
      readTheme: readThemeSource,
      temp: temp.createTempAssets(),
      files: { ...files.createRenderFiles(request), ...raster.createRaster(request.root) },
    });
  } catch {
    return failure({
      code: 'render-unavailable',
      message: 'Headless rendering could not initialize',
      recovery: 'Restore local resources and retry.',
    });
  }
}
