/*
 * Why this file exists
 *
 * Both programs start with nothing but the typed words. `pnpm canvas list` has to be read,
 * checked, and then run with real parts: files on disk and a connection to the service.
 * `pnpm render:png` is read and checked the same way, then run with files and the PNG engine.
 *
 * This file does that for both: it reads the words, lets core check them, and runs the command
 * with the real parts that `compose/` builds. Every mistake comes back as a value, never thrown;
 * `cli/canvas.ts` and `cli/render.ts` print it.
 */
import { readArguments } from '../adapters/argv/node-args.js';
import { helpText, parseCommand, parseRenderChoice, renderCollection } from './api.js';
import { canvasFlags, renderFlags } from './records/arguments.js';
import type { ParsedCommand } from './records/command.js';
import type { RenderChoice, RenderReport, RenderRequest } from './records/render.js';
import type { RenderFailure } from './records/render-failure.js';
import { filePath } from './brands.js';
import {
  failure,
  success,
  type CliFailure,
  type FailureInput,
  type LocalFailure,
  type Result,
} from './errors.js';
import { runProfile } from './compose/profiles.js';
import { runService } from './compose/service.js';

/**
 * Runs one `pnpm canvas` command, from the typed words to the text to print.
 *
 * `defaultWorkspace` is the folder used when `--workspace` isn't typed, as plain text. Fails as
 * the command does, or with `cli-unavailable` if `defaultWorkspace` is empty text or a step
 * throws. The throw is caught here and never passed on.
 */
export async function runCanvas(
  argv: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  try {
    return await parsedRun(argv, defaultWorkspace);
  } catch {
    return failure(cliUnavailable);
  }
}

/** The CLI could not complete: reading or running the command threw, or it had no workspace. */
const cliUnavailable: FailureInput = {
  code: 'cli-unavailable',
  message: 'CLI could not complete',
  recovery: 'Retain the request ID and inspect its receipt before retrying.',
};

/**
 * Runs one `pnpm render:png` render, from the typed words to the report to print.
 *
 * `repoRoot` is the repo folder the shipped files are in, as plain text. Fails with
 * `invalid-arguments` before anything is read, `render-unavailable` if the render can't start (or
 * `repoRoot` is empty text), or `render-failed`. Never throws or changes a saved collection.
 */
export async function runRender(
  argv: readonly string[],
  repoRoot: string,
): Promise<Result<RenderReport, RenderFailure | CliFailure>> {
  const choice = parseRenderChoice(readArguments(argv.filter(isNotSeparator), renderFlags));
  if (!choice.ok) return choice;
  return renderBelow(choice.value, repoRoot);
}

/** Node reads the argv; core's grammar checks every word and value; then the command runs. */
function parsedRun(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  const workspace = filePath.safeParse(defaultWorkspace);
  if (!workspace.success) return Promise.resolve(failure(cliUnavailable));
  const parsed = parseCommand(readArguments(args, canvasFlags), workspace.data);
  if (!parsed.ok) return Promise.resolve(parsed);
  return dispatch(parsed.value);
}

/**
 * Help needs no infrastructure; profile commands bind local ports; service commands bind their
 * real runtime. Fails as the family's run does.
 */
function dispatch(parsed: ParsedCommand): Promise<Result<string>> {
  switch (parsed.kind) {
    case 'help':
      return Promise.resolve(success(helpText));
    case 'profile':
      return runProfile(parsed.command);
    case 'service':
      return runService(parsed.command, parsed.options);
  }
}

/** Why a render could not start. */
const renderUnavailable: FailureInput = Object.freeze({
  code: 'render-unavailable',
  message: 'Headless rendering could not initialize',
  recovery: 'Restore local resources and retry.',
});

/** The render below the repo `root`. Fails with `render-unavailable` when `root` is empty. */
function renderBelow(
  choice: RenderChoice,
  root: string,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  const repo = filePath.safeParse(root);
  if (!repo.success) return Promise.resolve(failure(renderUnavailable));
  return boundRender({ ...choice, root: repo.data });
}

/**
 * Binds the render's ports, then runs core's render. The one boundary catch: a render module or
 * the service's render adapters that cannot be imported → `render-unavailable`.
 */
async function boundRender(
  request: RenderRequest,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  try {
    const wiring = await import('./compose/render.js');
    return await renderCollection(request, await wiring.createRenderPorts(request));
  } catch {
    return failure(renderUnavailable);
  }
}

/** Whether the argv word is anything but pnpm's `--` separator. */
function isNotSeparator(arg: string): boolean {
  return arg !== '--';
}
