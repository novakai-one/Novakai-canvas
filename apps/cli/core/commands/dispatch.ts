/*
 * Running a parsed command: the one flow the command names answers it, then `delivery.ts` prints
 * the answer or writes it to the --out file. Uses injected ports only. Failures are returned as
 * values; `cli/canvas.ts` prints them and sets the exit code. After a sent request, recovery is
 * `canvas receipt ID`, then `canvas retry ID`.
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
import type { CommandAnswer, OutputPorts, PrintedText } from './delivery.js';

/** The one port `recipe instantiate` uses: it is a single service call, made here. */
interface InstantiatePorts {
  readonly resources: Pick<ServiceResources, 'instantiate'>;
}

/**
 * Every port a service command may use: each flow's own slice, joined. Compose binds each member
 * once.
 */
export type ServicePorts = ReadDependencies &
  AuthorDependencies &
  RetryDependencies &
  AdmitDependencies &
  InstantiatePorts &
  OutputPorts;

/** Every port a profile command may use: the lint file, Language and the --out write. */
export type ProfilePorts = ProfileDependencies & OutputPorts;

/**
 * Runs one service command and returns the text to print.
 *
 * Steps; a failure is returned unchanged:
 * 1. Answer the command with the one flow it names. Fails as that flow does.
 * 2. Deliver the answer: printed, or written to the --out file. Fails with `output-unavailable`
 *    when the file cannot be written; the command already ran and is not run again.
 */
export async function runServiceCommand(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<PrintedText>> {
  const answer = await answerServiceCommand(command, ports);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, ports);
}

/**
 * Runs one profile command and returns the text to print.
 *
 * Steps; a failure is returned unchanged:
 * 1. Answer the command locally (`answerProfile`). Fails as that command does.
 * 2. Deliver the answer: printed, or written to the --out file. Fails with `output-unavailable`
 *    when the file cannot be written.
 */
export async function runProfileCommand(
  command: ProfileCommand,
  ports: ProfilePorts,
): Promise<Result<PrintedText>> {
  const answer = await answerProfile(command, ports);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, ports);
}

/**
 * The answer from the one flow the command names: the service answers reads; `create`, `replace`,
 * `patch` and `preview` go to Authoring; `retry` and `apply` replay a retained request; theme and
 * recipe files are admitted as presets; a recipe is instantiated by the service. Fails as that
 * flow does.
 */
function answerServiceCommand(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<CommandAnswer>> {
  switch (command.name) {
    case 'describe':
      return describeLanguage(ports);
    case 'list':
      return listCollections(ports);
    case 'read':
      return readCollection(command.collection, command.scope, ports);
    case 'inspect':
      return inspectCollection(command.collection, ports);
    case 'receipt':
      return readReceipt(command.request, ports);
    case 'create':
    case 'replace':
    case 'patch':
    case 'preview':
      return authorSource(command, ports);
    case 'retry':
    case 'apply':
      return replayRetainedRequest(command.request, ports);
    case 'theme-admit':
    case 'recipe-admit':
      return admitPreset(command, ports);
    case 'recipe-instantiate':
      return instantiateRecipe(command.expansion, ports);
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
  ports: InstantiatePorts,
): Promise<Result<CommandAnswer>> {
  return ports.resources.instantiate(expansion);
}
