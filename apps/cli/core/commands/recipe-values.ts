/*
 * `recipe admit` and `recipe instantiate` argument values: the recipe header from
 * --id --version --family --title, and the expansion request from `ID@VERSION#sha256:DIGEST` plus
 * --namespace. Pure; every brand comes from Templates' own schemas, and the `sha256:` pin converts
 * through core/resources/digests. Fails with `invalid-arguments`; nothing was read or sent, so the
 * caller corrects the named argument.
 */
import { presetId as presetIdSchema, version as versionSchema } from '../../contract/brands.js';
import type { PresetDigest, PresetId, Version } from '../../contract/brands.js';
import { recipeFamily as recipeFamilySchema } from '../../contract/schemas.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { FailureInput, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../shared/checks.js';
import { presetOfPin } from '../resources/digests.js';
import { invalidArgumentsFailure } from './failures.js';
import type { CommandFlags } from './flags.js';

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

/** A preset's checked ID and version. */
interface PresetIdentity {
  readonly id: PresetId;
  readonly version: Version;
}

/** An exact recipe pin: kind `recipe`, ID, version and digest. */
type RecipePin = ExpansionRequest['pin'];

/**
 * The recipe header. Fails with `invalid-arguments`: a missing or empty flag first, then an --id
 * that is not a preset ID, a --version that is not `MAJOR.MINOR.PATCH`, or an unknown --family.
 */
export function checkRecipeHeader(flags: CommandFlags): Result<RecipeHeader> {
  const headerText = requireHeaderFlags(flags);
  if (!headerText.ok) {
    return headerText;
  }
  return checkHeaderValues(headerText.value);
}

/**
 * The expansion request for `recipe instantiate PIN --namespace ID`. Fails with
 * `invalid-arguments` (the usage line) when the pin text, its ID, version or digest, or the
 * namespace is missing or malformed.
 */
export function checkPinAndNamespace(
  pinText: string,
  namespaceText: string | undefined,
): Result<ExpansionRequest> {
  const pin = checkRecipePin(pinText);
  if (!pin.ok) {
    return pin;
  }
  const namespace = checkNamespace(namespaceText);
  if (!namespace.ok) {
    return namespace;
  }
  return success({ pin: pin.value, namespace: namespace.value });
}

/** All four header flags, each given and not empty. Fails with `invalid-arguments` naming all four. */
function requireHeaderFlags(flags: CommandFlags): Result<HeaderText> {
  const { id, version, family, title } = flags;
  const allGiven = isFilled(id) && isFilled(version) && isFilled(family) && isFilled(title);
  if (!allGiven) {
    return invalidArgumentsFailure(headerRequired);
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
  const digest = presetOfPin(digestText);
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
