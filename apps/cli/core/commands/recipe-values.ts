/*
 * `recipe admit` and `recipe instantiate` argument values: the recipe header from
 * --id --version --family --title, and the expansion request from `ID@VERSION#sha256:DIGEST` plus
 * --namespace. Pure; every brand comes from Templates' own schemas. Fails with
 * `invalid-arguments`; nothing was read or sent, so the caller corrects the named argument.
 */
import { presetDigest, presetId, version } from '../../contract/brands.js';
import { recipeFamily } from '../../contract/schemas.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { checked } from '../shared/checks.js';
import type { Parser } from '../shared/checks.js';
import { joined } from '../shared/results.js';
import type { CommandFlags } from './flags.js';

/** Missing, empty or unknown-family recipe flags. */
const headerRequired = 'recipe admit requires --id --version --family --title';

/** Any malformed pin or namespace. */
const instantiateUsage =
  'Use recipe instantiate ID@VERSION#sha256:DIGEST --namespace ID --out FILE';

/** `ID@VERSION#sha256:DIGEST`: the text form of a recipe pin. */
const pinText = /^([^@]+)@([^#]+)#sha256:([a-f0-9]{64})$/;

/** The four header flags as given, each non-empty. */
interface HeaderText {
  readonly id: string;
  readonly version: string;
  readonly family: string;
  readonly title: string;
}

/**
 * The recipe header. Fails with `invalid-arguments`: a missing or empty flag or an unknown family
 * (as before), then an --id that is not a preset ID or a --version that is not
 * `MAJOR.MINOR.PATCH`.
 */
export function recipeHeader(flags: CommandFlags): Result<RecipeHeader> {
  const text = headerText(flags);
  if (!text.ok) return text;
  return header(text.value);
}

/**
 * The expansion request for `recipe instantiate PIN --namespace ID`. Fails with
 * `invalid-arguments` when the pin text, its ID, version or digest, or the namespace is malformed.
 */
export function expansion(
  pin: string,
  namespace: string | undefined,
): Result<ExpansionRequest> {
  const parts = pinText.exec(pin);
  if (parts === null || namespace === undefined) return invalidArguments(instantiateUsage);
  const [, id, release, digest] = parts;
  return joined(
    recipePin(id, release, digest),
    usage(presetId, namespace),
    (checkedPin, space) => ({
      pin: checkedPin,
      namespace: space,
    }),
  );
}

/** All four header flags, or `invalid-arguments` naming them. */
function headerText(flags: CommandFlags): Result<HeaderText> {
  const { id = '', version: release = '', family = '', title = '' } = flags;
  if ([id, release, family, title].includes('')) return invalidArguments(headerRequired);
  return success({ id, version: release, family, title });
}

/** Header text checked in flag order: --id, --version, --family. */
function header(text: HeaderText): Result<RecipeHeader> {
  const named = joined(
    headerValue(
      presetId,
      text.id,
      'recipe admit --id must be a letter, then letters, digits, _ or -',
    ),
    headerValue(version, text.version, 'recipe admit --version must be MAJOR.MINOR.PATCH'),
    (id, release) => ({ id, version: release }),
  );
  return joined(
    named,
    headerValue(recipeFamily, text.family, headerRequired),
    (fields, family) => ({
      ...fields,
      family,
      title: text.title,
    }),
  );
}

/** An exact recipe pin from the pin text's three parts. */
function recipePin(
  id: string | undefined,
  release: string | undefined,
  digest: string | undefined,
): Result<ExpansionRequest['pin']> {
  const named = joined(
    usage(presetId, id),
    usage(version, release),
    (checkedId, checkedVersion) => ({
      id: checkedId,
      version: checkedVersion,
    }),
  );
  return joined(named, usage(presetDigest, digest), (fields, checkedDigest) => ({
    kind: 'recipe',
    ...fields,
    digest: checkedDigest,
  }));
}

/** One header value; `malformed` names the flag. */
function headerValue<T>(
  parser: Parser<T>,
  text: string,
  malformed: string,
): Result<T> {
  return checked(parser, text, { code: 'invalid-arguments', message: malformed });
}

/** One part of `recipe instantiate`'s arguments; any rejection prints the usage line. */
function usage<T>(
  parser: Parser<T>,
  text: string | undefined,
): Result<T> {
  return checked(parser, text, { code: 'invalid-arguments', message: instantiateUsage });
}

/** A malformed recipe argument; nothing was read or sent. */
function invalidArguments(message: string): Result<never> {
  return failure({ code: 'invalid-arguments', message });
}
