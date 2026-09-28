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
import { filePath, type FilePath } from './brands.js';
import { failure, success, type CliFailure, type LocalFailure, type Result } from './errors.js';
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
    return await parseAndRunCommand(argv, defaultWorkspace);
  } catch {
    return cliUnavailableFailure();
  }
}

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
  const words = withoutSeparators(argv);
  const renderLine = readArguments(words, renderFlags);
  const choice = parseRenderChoice(renderLine);
  if (!choice.ok) {
    return choice;
  }
  return renderInRepo(choice.value, repoRoot);
}

/**
 * Checks the default workspace folder, then the typed words, then runs the command they name.
 * Fails with `cli-unavailable` for an empty default workspace, with the mistake `parseCommand`
 * finds, or as the command does.
 */
async function parseAndRunCommand(
  argv: readonly string[],
  defaultWorkspace: string,
): Promise<Result<string>> {
  const workspace = checkDefaultWorkspace(defaultWorkspace);
  if (!workspace.ok) {
    return workspace;
  }
  const commandLine = readArguments(argv, canvasFlags);
  const parsed = parseCommand(commandLine, workspace.value);
  if (!parsed.ok) {
    return parsed;
  }
  return runParsedCommand(parsed.value);
}

/** Checks the default workspace folder is a path. Fails with `cli-unavailable` when it is empty. */
function checkDefaultWorkspace(defaultWorkspace: string): Result<FilePath> {
  const workspace = filePath.safeParse(defaultWorkspace);
  if (!workspace.success) {
    return cliUnavailableFailure();
  }
  return success(workspace.data);
}

/**
 * Gives back the help text, or runs the profile or service command with its real parts. Fails as
 * that command does.
 */
async function runParsedCommand(parsed: ParsedCommand): Promise<Result<string>> {
  switch (parsed.kind) {
    case 'help':
      return success(helpText);
    case 'profile':
      return runProfile(parsed.command);
    case 'service':
      return runService(parsed.command, parsed.options);
  }
}

/** Draws the chosen collection, with the shipped files found below `repoRoot`. */
async function renderInRepo(
  choice: RenderChoice,
  repoRoot: string,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  const root = checkRepoRoot(repoRoot);
  if (!root.ok) {
    return root;
  }
  const request: RenderRequest = { ...choice, root: root.value };
  return renderWithRealParts(request);
}

/** Checks the repo folder is a path. Fails with `render-unavailable` when it is empty. */
function checkRepoRoot(repoRoot: string): Result<FilePath, LocalFailure> {
  const root = filePath.safeParse(repoRoot);
  if (!root.success) {
    return renderUnavailableFailure();
  }
  return success(root.data);
}

/**
 * Builds the render's real parts, then draws. Any throw on the way, such as drawing code that
 * can't be loaded, becomes `render-unavailable`.
 */
async function renderWithRealParts(
  request: RenderRequest,
): Promise<Result<RenderReport, RenderFailure | LocalFailure>> {
  try {
    const renderModule = await import('./compose/render.js');
    const ports = await renderModule.createRenderPorts(request);
    return await renderCollection(request, ports);
  } catch {
    return renderUnavailableFailure();
  }
}

/** Gives the typed words without pnpm's `--` separator. */
function withoutSeparators(argv: readonly string[]): readonly string[] {
  return argv.filter(isNotPnpmSeparator);
}

/** Whether the typed word is anything but pnpm's `--` separator. */
function isNotPnpmSeparator(word: string): boolean {
  return word !== '--';
}

/** Makes the failure for a command that couldn't finish, or had no workspace (`cli-unavailable`). */
function cliUnavailableFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'cli-unavailable',
    message: 'CLI could not complete',
    recovery: 'Retain the request ID and inspect its receipt before retrying.',
  });
}

/** Makes the failure for a render that couldn't start (`render-unavailable`). */
function renderUnavailableFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'render-unavailable',
    message: 'Headless rendering could not initialize',
    recovery: 'Restore local resources and retry.',
  });
}
