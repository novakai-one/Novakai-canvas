/*
 * Why this file exists
 *
 * Once a command line is parsed, something has to run it. `pnpm canvas read my-diagram` has to ask
 * the service for that collection. `pnpm canvas profile lint plan.canvas` has to check the file on
 * this machine. Each command has its own code that does the work, in `core/reads`,
 * `core/authoring`, `core/presets` and `core/profiles`. (`core/presets` saves themes and recipes;
 * a preset is either one.)
 *
 * This file sends each command to the code that answers it. Then it hands the answer to
 * `delivery.ts`, which keeps it for the screen or writes it to the `--out` file.
 *
 * It does no I/O itself. The code it calls uses only the tools it is handed (its dependencies),
 * such as the service connection or the file reader. It never prints and never sets the exit
 * code: `cli/canvas.ts` does that with what comes back. Each step answers with a `Result` (see
 * `contract/errors.ts`).
 */
import type { ProfileCommand, ServiceCommand } from '../../contract/records/command.js';
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { Result } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import type { AdmitDependencies } from '../presets/admit.js';
import { authorSource } from '../authoring/submit.js';
import type { AuthorDependencies } from '../authoring/submit.js';
import { replayRetainedRequest } from '../authoring/reconcile.js';
import type { RetryDependencies } from '../authoring/reconcile.js';
import {
  describeLanguage,
  inspectCollection,
  listCollections,
  readCollection,
  readReceipt,
} from '../reads/queries.js';
import type { ReadDependencies } from '../reads/queries.js';
import { answerProfile } from '../profiles/commands.js';
import type { ProfileDependencies } from '../profiles/commands.js';
import { unsupported } from '../shared/results.js';
import { deliverAnswer } from './delivery.js';
import type { OutFileWriter } from './delivery.js';

/** What `recipe instantiate` uses: the one service call that turns a recipe into diagram text. */
export interface RecipeInstantiateDependencies {
  readonly resources: Pick<ServiceResources, 'instantiate'>;
}

/** What every command uses to write its answer to the `--out` file. */
export interface OutFileDependencies {
  readonly writer: OutFileWriter;
}

/**
 * Every tool a service command may need, joined from each part's own list: the service
 * connection, the file reader, the `--out` writer, the request journal (a copy of each change the
 * CLI sends, kept in the workspace so `retry` can send it again), Language (which reads DSL text)
 * and more. `contract/compose/service.ts` makes each one once.
 */
export type ServiceCommandDependencies = ReadDependencies &
  AuthorDependencies &
  RetryDependencies &
  AdmitDependencies &
  RecipeInstantiateDependencies &
  OutFileDependencies;

/**
 * Every tool a profile command may need: the file reader for `lint`, Language (which reads DSL
 * text), and the `--out` writer.
 */
export type ProfileCommandDependencies = ProfileDependencies & OutFileDependencies;

/**
 * Runs a command on the local service, and returns the text to show on screen.
 *
 * It takes two steps. If a step finds a mistake, it stops there and returns that mistake.
 * 1. Send the command to the code that answers it. For example, `read` goes to the code that reads
 *    a collection.
 * 2. Keep the answer to show on screen, or write it to the `--out` file (`delivery.ts`).
 *
 * The mistakes it can find: whatever that code reports (a missing collection, a stale
 * `--revision`, no answer from the service, …), or an `--out` file that can't be written. In that
 * last case the command already ran (see `delivery.ts`).
 */
export async function runServiceCommand(
  command: ServiceCommand,
  dependencies: ServiceCommandDependencies,
): Promise<Result<string>> {
  const answer = await answerServiceCommand(command, dependencies);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, dependencies.writer);
}

/**
 * Runs a profile command on this machine, and returns the text to show on screen.
 *
 * It takes two steps. If a step finds a mistake, it stops there and returns that mistake.
 * 1. Answer the command: describe the profile, make the scaffold, or lint the file.
 * 2. Keep the answer to show on screen, or write it to the `--out` file (`delivery.ts`).
 *
 * The mistakes it can find: a lint file that can't be read or doesn't parse, a file that breaks
 * the profile's rules, or an `--out` file that can't be written.
 */
export async function runProfileCommand(
  command: ProfileCommand,
  dependencies: ProfileCommandDependencies,
): Promise<Result<string>> {
  const answer = await answerProfile(command, dependencies);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, dependencies.writer);
}

/**
 * Sends the command to the code that answers it and returns the answer. Reads → service queries;
 * `create`, `replace`, `patch`, `preview` → Authoring; `retry`, `apply` → replay the retained
 * request; `theme admit`, `recipe admit` → preset admission; `recipe instantiate` → one service
 * call. Fails as that code does.
 */
function answerServiceCommand(
  command: ServiceCommand,
  dependencies: ServiceCommandDependencies,
): Promise<Result<string>> {
  switch (command.name) {
    case 'describe':
      return describeLanguage(dependencies);
    case 'list':
      return listCollections(dependencies);
    case 'read':
      return readCollection(command.collection, command.scope, dependencies);
    case 'inspect':
      return inspectCollection(command.collection, dependencies);
    case 'receipt':
      return readReceipt(command.request, dependencies);
    case 'create':
    case 'replace':
    case 'patch':
    case 'preview':
      return authorSource(command, dependencies);
    case 'retry':
    case 'apply':
      return replayRetainedRequest(command.request, dependencies);
    case 'theme-admit':
    case 'recipe-admit':
      return admitPreset(command, dependencies);
    case 'recipe-instantiate':
      return instantiateRecipe(command.expansion, dependencies);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/**
 * `recipe instantiate`: the service expands the pinned recipe under the namespace, as editable
 * DSL. Nothing is written. Fails as the service call does.
 */
function instantiateRecipe(
  expansion: ExpansionRequest,
  dependencies: RecipeInstantiateDependencies,
): Promise<Result<string>> {
  return dependencies.resources.instantiate(expansion);
}
