/*
 * Profile-command wiring: local files and Language. Local only; profile commands need no
 * credential and never reach the service. Failures are returned as values; `cli/canvas.ts` prints
 * them.
 */
import { createLocalFiles } from '../../adapters/files/local-files.js';
import { executeProfile } from '../api.js';
import type { Result } from '../errors.js';
import type { ProfileCommand } from '../records/command.js';
import { composeLanguage } from './language.js';

/** Runs one profile command. Fails as the command does. */
export async function runProfile(command: ProfileCommand): Promise<Result<string>> {
  return executeProfile(command, { files: createLocalFiles(), language: composeLanguage() });
}
