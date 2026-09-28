/*
 * Why this file exists
 *
 * A recipe is a saved diagram to start new ones from. Two commands need recipe values typed right,
 * such as the pin that names one exact recipe: `er@1.0.0#sha256:DIGEST` (ID, version, digest).
 *
 * This file checks those values, with the same rules as Templates, which stores recipes. It never
 * reads a file or asks the service.
 */
import {
  presetId as presetIdSchema,
  recipeFamily as recipeFamilySchema,
  version as versionSchema,
} from '../../contract/brands.js';
import type { PresetDigest, PresetId, Version } from '../../contract/brands.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../../contract/schemas.js';
import { parsePresetPin } from '../resources/digests.js';
import type { FlagTextAsTyped } from './flags.js';

/**
 * What `recipe instantiate` asks for: the recipe's `pin`, and `namespace`, the new collection's
 * ID. Templates names this type `ExpansionRequest`: it expands the recipe into diagram text.
 */
export type RecipeToInstantiate = ExpansionRequest;

/** A missing or empty header flag, or an unknown --family. */
const headerRequired = 'recipe admit requires --id --version --family --title';

/** Any missing or malformed part of `recipe instantiate`'s arguments: the usage line. */
const instantiateUsage: FailureInput = Object.freeze({
  code: 'invalid-arguments',
  message: 'Use recipe instantiate ID@VERSION#sha256:DIGEST --namespace ID --out FILE',
});

/** `ID@VERSION#PIN`: the text form of a recipe pin; PIN is Model's `sha256:DIGEST` pin. */
const pinShape = /^([^@]+)@([^#]+)#(.+)$/;

/** The four header flags as given, each non-empty. */
interface HeaderText {
  readonly id: string;
  readonly version: string;
  readonly family: string;
  readonly title: string;
}

/** The three texts of a pin `ID@VERSION#PIN`. */
interface PinParts {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/**
 * A recipe's checked ID and version. Templates calls a recipe or a theme a "preset", hence the
 * `Preset…` types.
 */
interface PresetIdentity {
  readonly id: PresetId;
  readonly version: Version;
}

/** An exact recipe pin: kind `recipe`, ID, version and digest. */
type RecipePin = ExpansionRequest['pin'];

/**
 * Checks the four flags `recipe admit` needs: `--id`, `--version`, `--family` and `--title`.
 *
 * `--id er --version 1.0.0 --family er --title "ER diagram"`.
 * The mistakes it can find: a flag missing or empty, or an `--id`, `--version` or `--family` that
 * isn't valid.
 */
export function checkRecipeHeader(flags: FlagTextAsTyped): Result<RecipeHeader> {
  const headerText = requireHeaderFlags(flags);
  if (!headerText.ok) {
    return headerText;
  }
  return checkHeaderValues(headerText.value);
}

/**
 * Checks what `recipe instantiate` asks for: the recipe's pin, and `--namespace`, the new ID.
 *
 * `typedPin` is the pin as typed, such as `er@1.0.0#sha256:DIGEST`.
 * The mistakes it can find: a bad pin, or `--namespace` missing or not a valid ID. Each one's
 * message is the usage line.
 */
export function checkRecipeToInstantiate(
  typedPin: string,
  typedNamespace: string | undefined,
): Result<RecipeToInstantiate> {
  const pin = checkRecipePin(typedPin);
  if (!pin.ok) {
    return pin;
  }
  const namespace = checkNamespace(typedNamespace);
  if (!namespace.ok) {
    return namespace;
  }
  return success({ pin: pin.value, namespace: namespace.value });
}

/** All four header flags, each given and not empty. Fails with `invalid-arguments` naming all four. */
function requireHeaderFlags(flags: FlagTextAsTyped): Result<HeaderText> {
  const { id, version, family, title } = flags;
  const allGiven = isFilled(id) && isFilled(version) && isFilled(family) && isFilled(title);
  if (!allGiven) {
    return failure({ code: 'invalid-arguments', message: headerRequired });
  }
  return success({ id, version, family, title });
}

/** The header values in flag order: --id and --version, then --family. */
function checkHeaderValues(headerText: HeaderText): Result<RecipeHeader> {
  const identity = checkHeaderIdentity(headerText);
  if (!identity.ok) {
    return identity;
  }
  const family = checkHeaderValue(recipeFamilySchema, headerText.family, headerRequired);
  if (!family.ok) {
    return family;
  }
  return success({ ...identity.value, family: family.value, title: headerText.title });
}

/** --id, then --version. Fails with `invalid-arguments` naming the flag. */
function checkHeaderIdentity(headerText: HeaderText): Result<PresetIdentity> {
  const id = checkHeaderValue(
    presetIdSchema,
    headerText.id,
    'recipe admit --id must be a letter, then letters, digits, _ or -',
  );
  if (!id.ok) {
    return id;
  }
  const version = checkHeaderValue(
    versionSchema,
    headerText.version,
    'recipe admit --version must be MAJOR.MINOR.PATCH',
  );
  if (!version.ok) {
    return version;
  }
  return success({ id: id.value, version: version.value });
}

/** One header value; `message` names the flag. Fails with `invalid-arguments`. */
function checkHeaderValue<T>(
  parser: Parser<T>,
  text: string,
  message: string,
): Result<T> {
  return checked(parser, text, { code: 'invalid-arguments', message });
}

/** An exact recipe pin from `ID@VERSION#PIN`. Fails with `invalid-arguments` (the usage line). */
function checkRecipePin(pinText: string): Result<RecipePin> {
  const pinParts = splitPinText(pinText);
  if (!pinParts.ok) {
    return pinParts;
  }
  return checkPinParts(pinParts.value);
}

/** `ID@VERSION#PIN` split at its `@` and `#`. Fails with `invalid-arguments` for any other shape. */
function splitPinText(pinText: string): Result<PinParts> {
  // `exec` gives null for any other shape; `?? []` makes all three parts missing, so one check
  // covers both.
  const [, id, version, digest] = pinShape.exec(pinText) ?? [];
  const hasEveryPart = id !== undefined && version !== undefined && digest !== undefined;
  if (!hasEveryPart) {
    return failure(instantiateUsage);
  }
  return success({ id, version, digest });
}

/** The pin's ID and version, then its digest. Fails with `invalid-arguments` (the usage line). */
function checkPinParts(pinParts: PinParts): Result<RecipePin> {
  const identity = checkPinIdentity(pinParts);
  if (!identity.ok) {
    return identity;
  }
  const digest = checkPinDigest(pinParts.digest);
  if (!digest.ok) {
    return digest;
  }
  return success({ kind: 'recipe', ...identity.value, digest: digest.value });
}

/** The pin's ID, then its version. Fails with `invalid-arguments` (the usage line). */
function checkPinIdentity(pinParts: PinParts): Result<PresetIdentity> {
  const id = checked(presetIdSchema, pinParts.id, instantiateUsage);
  if (!id.ok) {
    return id;
  }
  const version = checked(versionSchema, pinParts.version, instantiateUsage);
  if (!version.ok) {
    return version;
  }
  return success({ id: id.value, version: version.value });
}

/** The Templates digest a `sha256:` pin names. Fails with `invalid-arguments` (the usage line). */
function checkPinDigest(digestText: string): Result<PresetDigest> {
  const digest = parsePresetPin(digestText);
  if (digest === undefined) {
    return failure(instantiateUsage);
  }
  return success(digest);
}

/** --namespace, as a preset ID. Missing or malformed fails with `invalid-arguments` (the usage line). */
function checkNamespace(namespaceText: string | undefined): Result<PresetId> {
  if (namespaceText === undefined) {
    return failure(instantiateUsage);
  }
  return checked(presetIdSchema, namespaceText, instantiateUsage);
}

/** Whether a header flag was given and is not empty. */
function isFilled(text: string | undefined): text is string {
  return text !== undefined && text !== '';
}
