/*
 * Executing a parsed command: the one flow the command names answers it, then the answer is
 * printed or written to the --out file. The one --out writer. Uses injected ports only. Failures
 * are returned as values; `cli/canvas.ts` prints them and sets the exit code. After a sent
 * request, recovery is `canvas receipt ID`, then `canvas retry ID`.
 */
import type { ProfileCommand, ServiceCommand } from '../../contract/records/command.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import type { AdmitDependencies } from '../presets/admit.js';
import { author } from '../authoring/submit.js';
import type { AuthorDependencies } from '../authoring/submit.js';
import { retry } from '../authoring/reconcile.js';
import type { RetryDependencies } from '../authoring/reconcile.js';
import { describe, inspect, list, read, receipt } from '../reads/queries.js';
import type { ReadDependencies } from '../reads/queries.js';
import { answerProfile } from '../profiles/commands.js';
import type { ProfileDependencies } from '../profiles/commands.js';
import { unsupported } from '../shared/results.js';

/** A command's answer: the text its flow returns. */
type CommandAnswer = string;

/** What the terminal prints: the answer itself, or `Written: FILE` once the --out file holds it. */
export type PrintedText = string;

/** The one port the --out write uses. */
interface OutputPorts {
  readonly files: Pick<LocalFiles, 'writeOutput'>;
}

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
export async function executeService(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<PrintedText>> {
  const answer = await answerService(command, ports);
  if (!answer.ok) return answer;
  return deliverAnswer(answer.value, command.out, ports);
}

/**
 * Runs one profile command and returns the text to print.
 *
 * Steps; a failure is returned unchanged:
 * 1. Answer the command locally (`answerProfile`). Fails as that command does.
 * 2. Deliver the answer: printed, or written to the --out file. Fails with `output-unavailable`
 *    when the file cannot be written.
 */
export async function executeProfile(
  command: ProfileCommand,
  ports: ProfilePorts,
): Promise<Result<PrintedText>> {
  const answer = await answerProfile(command, ports);
  if (!answer.ok) return answer;
  return deliverAnswer(answer.value, command.out, ports);
}

/**
 * The answer from the one flow the command names: the service answers reads; `create`, `replace`,
 * `patch` and `preview` go to Authoring; `apply` and `retry` look up the receipt, then replay the
 * retained request; theme and recipe files are admitted as presets. Fails as that flow does.
 */
function answerService(
  command: ServiceCommand,
  ports: ServicePorts,
): Promise<Result<CommandAnswer>> {
  switch (command.name) {
    case 'describe':
      return describe(ports);
    case 'list':
      return list(ports);
    case 'read':
      return read(command.collection, command.scope, ports);
    case 'inspect':
      return inspect(command.collection, ports);
    case 'receipt':
      return receipt(command.request, ports);
    case 'create':
    case 'replace':
    case 'patch':
    case 'preview':
      return author(command, ports);
    case 'retry':
    case 'apply':
      return retry(command.request, ports);
    case 'theme-admit':
    case 'recipe-admit':
      return admitPreset(command, ports);
    case 'recipe-instantiate':
      return ports.resources.instantiate(command.expansion);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/**
 * The answer as the terminal prints it: the answer itself when no --out file is given; otherwise
 * `Written: FILE` once the file holds the answer. Fails with `output-unavailable`.
 */
async function deliverAnswer(
  answer: CommandAnswer,
  outFile: FilePath | undefined,
  ports: OutputPorts,
): Promise<Result<PrintedText>> {
  if (outFile === undefined) return success(answer);
  const written = await ports.files.writeOutput(outFile, answer);
  if (!written.ok) return written;
  const notice = `Written: ${outFile}`;
  return success(notice);
}
