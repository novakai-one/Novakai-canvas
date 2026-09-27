/*
 * Composition root: reads the arguments, then runs the parsed command's family on real
 * infrastructure wired in `compose/`: service commands in `service.ts`, profile commands in
 * `profiles.ts`, the headless render in `render.ts`. Not pure: reads the argv. Failures are
 * returned as values; `cli/canvas.ts` and `cli/render.ts` print them and set the exit code.
 * Recovery after a sent request is `receipt` then `retry`; a render changes nothing.
 */
import { readArguments } from '../adapters/argv/node-args.js';
import { parseCommand, parseRenderChoice, usage } from './api.js';
import type { CliFailure, Result } from './errors.js';
import { canvasFlags, renderFlags } from './records/arguments.js';
import type { ParsedCommand } from './records/command.js';
import type { RenderReport } from './records/render.js';
import type { RenderFailure } from './records/render-failure.js';
import { failure, success } from './errors.js';
import { runProfile } from './compose/profiles.js';
import { runHeadless } from './compose/render.js';
import { runService } from './compose/service.js';

/**
 * `pnpm canvas`: reads and parses the argv, then runs the command on real infrastructure. Fails as
 * the command does, or with `cli-unavailable` when reading or parsing the argv throws. A throw
 * while the command runs rejects; `cli/canvas.ts` catches it and prints its own notice.
 */
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

/**
 * Help needs no infrastructure; profile commands bind local ports; service commands bind their
 * real runtime. Fails as the family's run does.
 */
function dispatch(parsed: ParsedCommand): Promise<Result<string>> {
  switch (parsed.kind) {
    case 'help':
      return Promise.resolve(success(usage));
    case 'profile':
      return runProfile(parsed.command);
    case 'service':
      return runService(parsed.command, parsed.options);
  }
}

/** Whether the argv word is anything but pnpm's `--` separator. */
function isNotSeparator(arg: string): boolean {
  return arg !== '--';
}
