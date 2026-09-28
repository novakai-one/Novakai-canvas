/*
 * Profile-command wiring: local files, Language and Language's collection profiles. Local only;
 * profile commands need no credential and never reach the service. Failures are returned as
 * values; `cli/canvas.ts` prints them.
 */
import { describeProfile, lintProfile, scaffoldProfile } from '@novakai/canvas-language';
import { createLocalFiles } from '../../adapters/files/local-files.js';
import { runProfileCommand } from '../api.js';
import type { Result } from '../errors.js';
import type { CollectionProfiles } from '../ports/collection-profiles.js';
import type { ProfileCommand } from '../records/command.js';
import { composeLanguage } from './language.js';

/** Runs one profile command. Fails as the command does. */
export async function runProfile(command: ProfileCommand): Promise<Result<string>> {
  const files = createLocalFiles();
  return runProfileCommand(command, {
    files,
    writer: files,
    language: composeLanguage(),
    profiles: composeProfiles(),
  });
}

/** Language's collection profiles as the CLI's port. Never fails. */
function composeProfiles(): CollectionProfiles {
  return { describe: describeProfile, scaffold: scaffoldProfile, lint: lintProfile };
}
