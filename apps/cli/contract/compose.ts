/*
 * Composition root: reads the arguments, then runs the parsed command's family on real
 * infrastructure wired in `compose/`: service commands in `service.ts`, profile commands in
 * `profiles.ts`, the headless render in `render.ts` (imported only when a render runs). Not pure:
 * reads the argv. Failures are returned as values; `cli/canvas.ts` and `cli/render.ts` print them
 * and set the exit code. Recovery after a sent request is `receipt` then `retry`; a render changes
 * nothing.
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
 * `pnpm canvas`: reads and parses the argv, then runs the command on real infrastructure. Fails as
 * the command does, or with `cli-unavailable` when reading, parsing or running the command throws
 * (the one boundary catch). Never rejects.
 */
export async function runCli(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  try {
    return await parsedRun(args, defaultWorkspace);
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
 * `invalid-arguments` before anything is read or made, `render-unavailable` when the render cannot
 * start, or `render-failed` as core's render reports it. Never rejects.
 */
export async function runRender(
  args: readonly string[],
  root: string,
): Promise<Result<RenderReport, RenderFailure | CliFailure>> {
  const choice = parseRenderChoice(readArguments(args.filter(isNotSeparator), renderFlags));
  if (!choice.ok) return choice;
  return renderBelow(choice.value, root);
}

/** Node reads the argv; core's grammar checks every word and value; then the command runs. */
function parsedRun(
  args: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  const parsed = parseCommand(readArguments(args, canvasFlags), defaultWorkspace);
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
    return await renderCollection(request, await wiring.renderPorts(request));
  } catch {
    return failure(renderUnavailable);
  }
}

/** Whether the argv word is anything but pnpm's `--` separator. */
function isNotSeparator(arg: string): boolean {
  return arg !== '--';
}
