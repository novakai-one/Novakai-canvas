/*
 * Profile command assembly: `profile describe|scaffold|lint` with a checked profile, scaffold's
 * collection ID and title, and lint's file. Pure. Fails with `unknown-profile`,
 * `invalid-arguments`, `source-unavailable` (an empty FILE) or `output-unavailable` (an empty
 * --out); nothing was read or written, so the caller corrects the named argument.
 */
import { collectionId } from '../../contract/brands.js';
import type { CollectionId } from '../../contract/brands.js';
import type { ProfileCommand, Writes } from '../../contract/records/command.js';
import type { CommandFlags } from '../../contract/records/arguments.js';
import type { ProfileId } from '../../contract/records/profiles.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import { joined, mapped, unsupported } from '../shared/results.js';
import { profile, sourceFile, writes } from './values.js';

/** What `profile scaffold` names the starter with, and where it writes it. */
type Scaffold = { readonly collection: CollectionId; readonly title: string } & Writes;

/**
 * One profile command. describe and scaffold take the profile as their operand, lint takes a FILE
 * and --profile.
 */
export function profileCommand(
  name: ProfileCommand['name'],
  operand: string,
  flags: CommandFlags,
): Result<ProfileCommand> {
  switch (name) {
    case 'profile-describe':
      return mapped(profile(operand), (id) => ({ name, profile: id }));
    case 'profile-scaffold':
      return joined(profile(operand), scaffold(flags), (id, fields) => ({
        name,
        profile: id,
        ...fields,
      }));
    case 'profile-lint':
      return joined(lintProfile(flags.profile), sourceFile(operand), (id, file) => ({
        name,
        profile: id,
        file,
      }));
    default:
      return unsupported(name);
  }
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

/** --profile for lint: required, then known. Fails with `invalid-arguments` or `unknown-profile`. */
function lintProfile(text: string | undefined): Result<ProfileId> {
  if (text === undefined)
    return failure({
      code: 'invalid-arguments',
      message: 'profile lint requires --profile build-spec@1.',
    });
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
