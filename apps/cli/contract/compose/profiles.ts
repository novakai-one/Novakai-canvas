/*
 * Why this file exists
 *
 * A profile is a set of rules a collection follows, such as `build-spec@1`. The `profile` commands
 * run on this machine alone: `profile lint my-spec.canvas --profile build-spec@1` reads a file,
 * parses it and checks it against the rules, with no service and no credential.
 *
 * This file plugs in what those commands use (real files, Language and its profiles), then runs
 * the command. Mistakes come back as values; `cli/canvas.ts` prints them.
 */
import { describeProfile, lintProfile, scaffoldProfile } from '@novakai/canvas-language';
import { createLocalFiles } from '../../adapters/files/local-files.js';
import { runProfileCommand } from '../api.js';
import type { Result } from '../errors.js';
import type { CollectionProfiles } from '../ports/collection-profiles.js';
import type { ProfileCommand } from '../records/command.js';
import { createLanguageWithModel } from './language.js';

/**
 * Runs one `profile` command with real files, and gives back the text to print. Fails when the lint
 * file can't be read or doesn't parse, when it breaks the profile's rules, or when the `--out` file
 * can't be written.
 */
export async function runProfile(command: ProfileCommand): Promise<Result<string>> {
  const files = createLocalFiles();
  const language = createLanguageWithModel();
  const profiles = languageProfiles();
  return runProfileCommand(command, { files, writer: files, language, profiles });
}

/** Gives Language's describe, scaffold and lint tools, in the shape core asks for. Never fails. */
function languageProfiles(): CollectionProfiles {
  return { describe: describeProfile, scaffold: scaffoldProfile, lint: lintProfile };
}
