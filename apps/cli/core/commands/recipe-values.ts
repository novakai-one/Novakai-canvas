/*
 * Why this file exists
 *
 * Two recipe commands need several values typed right before anything is sent:
 *
 *   pnpm canvas recipe admit er.canvas --id er --version 1.0.0 --family er --title "ER diagram"
 *   pnpm canvas recipe instantiate er@1.0.0#sha256:DIGEST --namespace shop --out shop.canvas
 *
 * `recipe admit` saves a diagram file as a reusable recipe. Its four flags describe the recipe:
 * its ID, version, family and title. Together they are called the recipe's header. The family is
 * the kind of diagram the recipe makes, such as `er` (entity-relationship).
 *
 * `recipe instantiate` makes a new diagram from a saved recipe, as text the agent can edit. It
 * needs the exact recipe, written as its pin: `ID@VERSION#sha256:DIGEST`. The digest is a
 * fingerprint of the recipe's content.
 *
 * `--namespace` is the new diagram's collection ID. The flag uses Templates' word for it:
 * Templates says the recipe is expanded "into a namespace".
 *
 * This file checks those values and returns them as checked types. The rules come from the
 * Templates capability, which stores recipes, so the CLI can't disagree with it.
 *
 * It never reads the file or asks the service. Each check answers with a `Result` (see
 * `contract/errors.ts`). Every mistake here is `invalid-arguments`, written by the check that
 * finds it.
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
 * The mistakes it can find, in this order: any of the four missing or empty; an `--id` that isn't
 * a letter followed by letters, digits, `_` or `-`; a `--version` not written like `1.0.0`; a
 * `--family` that isn't a recipe family.
 */
export function checkRecipeHeader(flags: FlagTextAsTyped): Result<RecipeHeader> {
  const headerText = requireHeaderFlags(flags);
  if (!headerText.ok) {
    return headerText;
  }
  return checkHeaderValues(headerText.value);
}

/**
 * Checks what `recipe instantiate` asks for: the recipe's pin, and `--namespace`, the new
 * collection's ID.
 *
 * `typedPin` is the pin as typed after the command, such as `er@1.0.0#sha256:DIGEST`.
 * `typedNamespace` is the text after `--namespace`, or `undefined` when it wasn't typed.
 *
 * The mistakes it can find: a pin not in that shape; a pin whose ID, version or digest isn't
 * valid; `--namespace` missing or not a valid ID. Each one's message is the same usage line:
 * `Use recipe instantiate ID@VERSION#sha256:DIGEST --namespace ID --out FILE`.
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
