/*
 * Why this file exists
 *
 * A parsed command still has to be run. `pnpm canvas read my-diagram` asks the service for that
 * collection. `pnpm canvas profile lint plan.canvas` checks the file on this machine.
 *
 * This file passes each command to the code that does its work, and returns the answer. It never
 * prints, and never touches the disk or the network itself: it only uses the tools it is handed.
 */
import type { ProfileCommand, ServiceCommand } from '../../contract/records/command.js';
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { Result } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import type { AdmitDependencies } from '../presets/admit.js';
import { sendSourceChange } from '../authoring/submit.js';
import type { SourceChangeDependencies } from '../authoring/submit.js';
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
import { answerProfileCommand } from '../profiles/commands.js';
import type { ProfileDependencies } from '../profiles/commands.js';
import { unsupported } from '../shared/results.js';
import { printOrWriteAnswer } from './delivery.js';
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
 * Every tool a service command may need, such as the service's calls, the file reader and the
 * `--out` writer. `contract/compose/service.ts` makes each one once.
 */
export type ServiceCommandDependencies = ReadDependencies &
  SourceChangeDependencies &
  RetryDependencies &
  AdmitDependencies &
  RecipeInstantiateDependencies &
  OutFileDependencies;

/**
 * Every tool a profile command may need: `files` (reads the file `lint` checks), `language`
 * (Language, which reads DSL text), `profiles` (Language's profiles and their rules), and `writer`
 * (writes the `--out` file).
 */
export type ProfileCommandDependencies = ProfileDependencies & OutFileDependencies;

/**
 * Runs a command on the local service, and returns the text to show on screen.
 *
 * `read my-diagram` asks the service for that collection. With `--out`, the answer goes to a file.
 * The mistakes it can find: whatever the service reports, such as a missing collection or a stale
 * `--revision`, or an `--out` file that can't be written.
 */
export async function runServiceCommand(
  command: ServiceCommand,
  dependencies: ServiceCommandDependencies,
): Promise<Result<string>> {
  const answer = await answerServiceCommand(command, dependencies);
  if (!answer.ok) {
    return answer;
  }
  return printOrWriteAnswer(answer.value, command, dependencies.writer);
}

/**
 * Runs a profile command on this machine, and returns the text to show on screen.
 *
 * The mistakes it can find: a lint file that can't be read or doesn't parse, a file that breaks
 * the profile's rules, or an `--out` file that can't be written.
 */
export async function runProfileCommand(
  command: ProfileCommand,
  dependencies: ProfileCommandDependencies,
): Promise<Result<string>> {
  const answer = await answerProfileCommand(command, dependencies);
  if (!answer.ok) {
    return answer;
  }
  return printOrWriteAnswer(answer.value, command, dependencies.writer);
}

/**
 * Passes the command to the code that does its work, and returns the answer. Reads → service
 * queries; `create`, `replace`, `patch`, `preview` → Authoring; `retry`, `apply` → replay the
 * retained request; `theme admit`, `recipe admit` → preset admission; `recipe instantiate` → one
 * service call. Fails as that code does.
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
      return sendSourceChange(command, dependencies);
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
