/*
 * The one theme-pin grammar: `id@version#sha256:hex`, the exact pin Language prints and a retained
 * DSL request carries. Resource selection and freezing format it; theme admission parses a base
 * with it. Pure; neither function fails. Text that is not an exact pin is a theme ID, and
 * Templates refuses an ID, version or digest it does not store.
 */
import { bareDigest, type PinnedDigest } from '../../contract/brands.js';

/** Exact pin text: theme ID, `@`, version, `#`, then Model's pinned digest. */
export type ThemePinText = `${string}@${string}#${PinnedDigest}`;

/** The parts of one exact pin. The digest is Model's pinned form (`sha256:` then hex). */
export interface ThemePinParts {
  readonly id: string;
  readonly version: string;
  readonly digest: PinnedDigest;
}

/**
 * What theme text selects: one exact version (its digest bare, as Templates checks it), or the
 * latest version of a theme ID.
 */
export type ThemeSelection =
  | {
      readonly kind: 'exact';
      readonly id: string;
      readonly version: string;
      readonly digest: string;
    }
  | { readonly kind: 'latest'; readonly id: string };

/** The exact pin text of one theme version. Never fails. */
export function formatThemePin(pin: ThemePinParts): ThemePinText {
  return `${pin.id}@${pin.version}#${pin.digest}`;
}

/**
 * What theme text selects. Exact pin text selects that version and bare digest; any other text is
 * a theme ID whose latest version is selected. Never fails.
 */
export function parseThemePin(text: string): ThemeSelection {
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
    digest: bareDigest(text.slice(hash + 1)),
  };
}
