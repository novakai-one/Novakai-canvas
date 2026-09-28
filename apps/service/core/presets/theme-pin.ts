/*
 * Why this file exists
 *
 * A theme can be named two ways: by its ID alone, such as `ink`, meaning its latest version; or by
 * an exact pin, such as `ink@1.1.0#sha256:8c3d…`, meaning that version with exactly that content.
 *
 * This file writes an exact pin, the way Language prints it, and reads theme text back as one of
 * the two. Text that isn't an exact pin is taken as an ID. Neither function fails; Templates later
 * refuses an ID, version or digest it doesn't store.
 */
import { removeDigestPrefix, type PrefixedDigest } from '../../contract/brands.js';

/** Exact pin text: the theme ID, `@`, the version, `#`, then the digest with `sha256:`. */
export type ThemePinText = `${string}@${string}#${PrefixedDigest}`;

/** The three parts of an exact pin. The digest keeps `sha256:`, as Model writes it. */
export interface ThemePinParts {
  /** The theme ID, such as `ink`. */
  readonly id: string;
  /** The version, such as `1.1.0`. */
  readonly version: string;
  readonly digest: PrefixedDigest;
}

/**
 * What theme text asks for: one exact version, or the latest version of an ID. The parts are text
 * as read (the digest without `sha256:`); Templates checks them.
 */
export type ThemeSelection =
  | {
      readonly kind: 'exact';
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    }
  | { readonly kind: 'latest'; readonly id: string };

/** Writes the exact pin text of one theme version, such as `ink@1.1.0#sha256:8c3d…`. */
export function formatThemePin(pin: ThemePinParts): ThemePinText {
  return `${pin.id}@${pin.version}#${pin.digest}`;
}

/**
 * Reads theme text as an exact pin or an ID. `ink@1.1.0#sha256:…` selects that version, with its
 * digest's `sha256:` removed; any other text, such as `ink`, selects the latest `ink`.
 */
export function parseThemeSelection(text: string): ThemeSelection {
  if (!EXACT_PIN.test(text)) return { kind: 'latest', id: text };
  return exactSelection(text);
}

/**
 * Exact pin text: an ID with no `@`, `@`, a version with no `#`, `#sha256:`, then 64 lowercase
 * hex digits.
 */
const EXACT_PIN = /^[^@]+@[^#]+#sha256:[a-f0-9]{64}$/;

/**
 * The parts of text that matched {@link EXACT_PIN}. The ID holds no `@`, so the first `@` ends it;
 * the version holds no `#`, so the first `#` after that ends the version.
 */
function exactSelection(text: string): ThemeSelection {
  const at = text.indexOf('@');
  const hash = text.indexOf('#', at);
  return {
    kind: 'exact',
    id: text.slice(0, at),
    version: text.slice(at + 1, hash),
    digest: removeDigestPrefix(text.slice(hash + 1)),
  };
}
