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
import type { ExpansionRequest, RecipeFamily } from '../../contract/records/foreign.js';
import type { LocalFailure, Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { presetOfPin } from '../resources/digests.js';
import type { FlagTextAsTyped } from './flags.js';

/**
 * What `recipe instantiate` asks for: the recipe's `pin`, and `namespace`, the new collection's
 * ID. Templates names this type `ExpansionRequest`: it expands the recipe into diagram text.
 */
export type RecipeToInstantiate = ExpansionRequest;

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

/** Checks all four recipe flags were typed, and none was left empty. */
function requireHeaderFlags(flags: FlagTextAsTyped): Result<HeaderText> {
  const { id, version, family, title } = flags;
  const hasEveryFlag = isFilled(id) && isFilled(version) && isFilled(family) && isFilled(title);
  if (!hasEveryFlag) {
    return recipeAdmitUsageFailure();
  }
  return success({ id, version, family, title });
}

/** Checks `--id` and `--version`, then `--family`, and keeps `--title` as typed. */
function checkHeaderValues(headerText: HeaderText): Result<RecipeHeader> {
  const identity = checkHeaderIdentity(headerText);
  if (!identity.ok) {
    return identity;
  }
  const family = checkHeaderFamily(headerText.family);
  if (!family.ok) {
    return family;
  }
  return success({ ...identity.value, family: family.value, title: headerText.title });
}

/** Checks `--id`, then `--version`. */
function checkHeaderIdentity(headerText: HeaderText): Result<PresetIdentity> {
  const id = checkHeaderId(headerText.id);
  if (!id.ok) {
    return id;
  }
  const version = checkHeaderVersion(headerText.version);
  if (!version.ok) {
    return version;
  }
  return success({ id: id.value, version: version.value });
}

/** Checks `--id` is a valid recipe ID, such as `er`. */
function checkHeaderId(idText: string): Result<PresetId> {
  const id = presetIdSchema.safeParse(idText);
  if (!id.success) {
    return headerIdFailure();
  }
  return success(id.data);
}

/** Checks `--version` is a version such as `1.0.0`. */
function checkHeaderVersion(versionText: string): Result<Version> {
  const version = versionSchema.safeParse(versionText);
  if (!version.success) {
    return headerVersionFailure();
  }
  return success(version.data);
}

/** Checks `--family` is a diagram family Templates knows, such as `er`. */
function checkHeaderFamily(familyText: string): Result<RecipeFamily> {
  const family = recipeFamilySchema.safeParse(familyText);
  if (!family.success) {
    return recipeAdmitUsageFailure();
  }
  return success(family.data);
}

/** Checks a pin such as `er@1.0.0#sha256:DIGEST`: its shape, then each of its parts. */
function checkRecipePin(pinText: string): Result<RecipePin> {
  const pinParts = splitPin(pinText);
  if (!pinParts.ok) {
    return pinParts;
  }
  return checkPinParts(pinParts.value);
}

/** Splits a pin at its `@` and `#` into its ID, version and digest. */
function splitPin(pinText: string): Result<PinParts> {
  const pinMatch = pinShape.exec(pinText);
  if (pinMatch === null) {
    return instantiateUsageFailure();
  }
  const pinParts = pinPartsOf(pinMatch);
  return success(pinParts);
}

/** Reads the ID, version and digest that a matching pin captured. */
function pinPartsOf(pinMatch: RegExpExecArray): PinParts {
  // A match always captures all three. The `''` defaults only satisfy the type checker.
  const [, id = '', version = '', digest = ''] = pinMatch;
  return { id, version, digest };
}

/** Checks the pin's ID and version, then its digest, and names the recipe kind. */
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

/** Checks the pin's ID, then its version. */
function checkPinIdentity(pinParts: PinParts): Result<PresetIdentity> {
  const id = checkInstantiateId(pinParts.id);
  if (!id.ok) {
    return id;
  }
  const version = checkPinVersion(pinParts.version);
  if (!version.ok) {
    return version;
  }
  return success({ id: id.value, version: version.value });
}

/** Checks the pin's version is a version such as `1.0.0`. */
function checkPinVersion(versionText: string): Result<Version> {
  const version = versionSchema.safeParse(versionText);
  if (!version.success) {
    return instantiateUsageFailure();
  }
  return success(version.data);
}

/** Checks the pin's digest is `sha256:` then 64 hex digits, and keeps the digits. */
function checkPinDigest(digestText: string): Result<PresetDigest> {
  const digest = presetOfPin(digestText);
  if (digest === undefined) {
    return instantiateUsageFailure();
  }
  return success(digest);
}

/** Checks `--namespace` was typed, and is a valid ID. */
function checkNamespace(namespaceText: string | undefined): Result<PresetId> {
  if (namespaceText === undefined) {
    return instantiateUsageFailure();
  }
  return checkInstantiateId(namespaceText);
}

/** Checks an ID typed for `recipe instantiate`, the pin's ID or `--namespace`. */
function checkInstantiateId(idText: string): Result<PresetId> {
  const id = presetIdSchema.safeParse(idText);
  if (!id.success) {
    return instantiateUsageFailure();
  }
  return success(id.data);
}

/** Whether a recipe flag was typed with some text after it. */
function isFilled(flagText: string | undefined): flagText is string {
  return flagText !== undefined && flagText !== '';
}

/**
 * Makes the mistake that repeats what `recipe admit` needs: for a missing or empty flag, or an
 * unknown `--family`.
 */
function recipeAdmitUsageFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'recipe admit requires --id --version --family --title',
  });
}

/** Makes the mistake for an `--id` that isn't a valid recipe ID (`invalid-arguments`). */
function headerIdFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'recipe admit --id must be a letter, then letters, digits, _ or -',
  });
}

/** Makes the mistake for a `--version` that isn't `MAJOR.MINOR.PATCH` (`invalid-arguments`). */
function headerVersionFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'recipe admit --version must be MAJOR.MINOR.PATCH',
  });
}

/** Makes the mistake for a bad pin or `--namespace`: it repeats the usage line. */
function instantiateUsageFailure(): Result<never, LocalFailure> {
  return failure({
    code: 'invalid-arguments',
    message: 'Use recipe instantiate ID@VERSION#sha256:DIGEST --namespace ID --out FILE',
  });
}
