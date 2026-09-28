/*
 * Why this file exists
 *
 * Once a command line is parsed, something has to run it. `pnpm canvas read my-diagram` has to ask
 * the service for that collection. `pnpm canvas profile lint plan.canvas` has to check the file on
 * this machine. Each command has its own flow that does the work.
 *
 * This file sends each command to the flow that answers it. Then it hands the answer to
 * `delivery.ts`, which prints it or writes it to the `--out` file.
 *
 * It does no I/O itself. Every flow uses the tools it is handed (its ports), such as the service
 * connection or the file reader. It never prints and never sets the exit code: `cli/canvas.ts`
 * does that with what comes back. Each step answers with a `Result` (see `contract/errors.ts`).
 * If the answer to a sent change is lost, the agent checks it with `canvas receipt ID`, then
 * `canvas retry ID`.
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
import type { OutputPorts } from './delivery.js';

/** The one port `recipe instantiate` uses: it is a single service call, made here. */
interface InstantiatePorts {
  readonly resources: Pick<ServiceResources, 'instantiate'>;
}

/**
 * Every tool a service command may need, joined from each flow's own list: the service
 * connections, the file reader and writer, the request journal, the Language checker and more.
 * `contract/compose/service.ts` makes each one once.
 */
export type ServicePorts = ReadDependencies &
  AuthorDependencies &
  RetryDependencies &
  AdmitDependencies &
  InstantiatePorts &
  OutputPorts;

/**
 * Every tool a profile command may need: the file reader for `lint`, the Language checker, and the
 * `--out` writer.
 */
export type ProfilePorts = ProfileDependencies & OutputPorts;

/**
 * Runs a command on the local service, and returns the text to show on screen.
 *
 * It takes two steps. If a step finds a mistake, it stops there and returns that mistake.
 * 1. Send the command to the flow that answers it, such as `read` to the service reads.
 * 2. Keep the answer to show on screen, or write it to the `--out` file (`delivery.ts`).
 *
 * The mistakes it can find: whatever the flow reports (a missing collection, a stale `--revision`,
 * no answer from the service, …), or an `--out` file that can't be written. In that last case the
 * command already ran, so it must not be run again.
 */
export async function runServiceCommand(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<string>> {
  const answer = await answerServiceCommand(command, ports);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, ports);
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
  ports: ProfilePorts,
): Promise<Result<string>> {
  const answer = await answerProfile(command, ports);
  if (!answer.ok) {
    return answer;
  }
  return deliverAnswer(answer.value, command, ports);
}

/**
 * Sends the command to the flow that answers it and returns the answer. Reads → service queries;
 * `create`, `replace`, `patch`, `preview` → Authoring; `retry`, `apply` → replay the retained
 * request; `theme admit`, `recipe admit` → preset admission; `recipe instantiate` → one service
 * call. Fails as that flow does.
 */
function answerServiceCommand(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<string>> {
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
): Promise<Result<string>> {
  return ports.resources.instantiate(expansion);
}
