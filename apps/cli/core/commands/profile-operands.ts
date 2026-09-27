/*
 * Profile command assembly: `profile describe|scaffold|lint` with a checked profile, scaffold's
 * collection ID and title, lint's file, then --out. Pure. Fails with `unknown-profile`,
 * `invalid-arguments`, `source-unavailable` (an empty FILE) or `output-unavailable` (an empty
 * --out); nothing was read or written, so the caller corrects the named argument.
 */
import { collectionId } from '../../contract/brands.js';
import type { CollectionId, FilePath } from '../../contract/brands.js';
import type { ProfileCommand, Writes } from '../../contract/records/command.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { joined, unsupported } from '../shared/results.js';
import type { CommandFlags } from './flags.js';
import { profile, sourceFile, writes } from './values.js';

/** `profile lint` without --profile. `parse.ts` reports it with its placement rules. */
export const lintProfileRequired = 'profile lint requires --profile build-spec@1.';

/** What `profile scaffold` names the starter with, and where it writes it. */
type Scaffold = { readonly collection: CollectionId; readonly title: string } & Writes;

/**
 * One profile command. describe and scaffold take the profile as their operand, lint takes a FILE
 * and --profile; each command's --out is checked last.
 */
export function profileCommand(
  name: ProfileCommand['name'],
  operand: string,
  flags: CommandFlags,
): Result<ProfileCommand> {
  switch (name) {
    case 'profile-describe':
      return joined(profile(operand), writes(flags), (id, written) => ({
        name,
        profile: id,
        ...written,
      }));
    case 'profile-scaffold':
      return joined(profile(operand), scaffold(flags), (id, fields) => ({
        name,
        profile: id,
        ...fields,
      }));
    case 'profile-lint':
      return joined(lintFile(operand, flags.profile), writes(flags), (fields, written) => ({
        name,
        ...fields,
        ...written,
      }));
    default:
      return unsupported(name);
  }
}

/** lint's --profile, then its FILE. */
function lintFile(
  operand: string,
  text: string | undefined,
): Result<{ readonly profile: ProfileId; readonly file: FilePath }> {
  return joined(lintProfile(text), sourceFile(operand), (id, file) => ({ profile: id, file }));
}

/**
 * --id and --title (each required and not blank), then the ID's grammar, then --out. Fails with
 * `invalid-arguments` or `output-unavailable`.
 */
function scaffold(flags: CommandFlags): Result<Scaffold> {
  const text = joined(required(flags.id, 'id'), required(flags.title, 'title'), (id, title) => ({
    id,
    title,
  }));
  if (!text.ok) return text;
  const { id, title } = text.value;
  return joined(scaffoldId(id), writes(flags), (collection, written) => ({
    collection,
    title,
    ...written,
  }));
}

/**
 * --profile for lint: required, then known. Fails with `invalid-arguments` or `unknown-profile`.
 * `parse.ts` already reported a missing --profile; the check keeps this total.
 */
function lintProfile(text: string | undefined): Result<ProfileId> {
  if (text === undefined)
    return failure({ code: 'invalid-arguments', message: lintProfileRequired });
  return profile(text);
}

/** A scaffold flag that is present and not blank; the value is kept as given. */
function required(
  value: string | undefined,
  label: 'id' | 'title',
): Result<string> {
  if (value === undefined || value.trim() === '')
    return failure({ code: 'invalid-arguments', message: `Scaffold requires --${label}.` });
  return success(value);
}

/** The starter's collection ID, in Model's collection ID grammar. */
function scaffoldId(text: string): Result<CollectionId> {
  return checked(collectionId, text, {
    code: 'invalid-arguments',
    message: 'Scaffold --id must be a simple collection ID.',
  });
}
