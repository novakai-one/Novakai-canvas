/*
 * The failures the preference store reports. A Design System refusal becomes the web's
 * `ui-preferences` failure with the refusal kept as its cause; a browser storage failure keeps its
 * own code. Both carry the same preference recovery text. Pure; never throws. Settings shows the
 * failure and owns recovery (choose a theme or reset).
 */
import type { Diagnostic, ForeignDiagnostic } from '../../contract/errors.js';
import { diagnostic } from '../../contract/errors.js';

/**
 * A Design System refusal as the web's `ui-preferences` failure. The message is the refusal's;
 * the refusal stays whole as `cause`.
 */
export function preferenceFailure(refusal: ForeignDiagnostic): Diagnostic {
  return diagnostic('ui-preferences', refusal.message, PREFERENCE_RECOVERY, refusal);
}

/** A browser storage failure with the preference recovery text; its code and message are kept. */
export function storageFailure(error: Diagnostic): Diagnostic {
  return { ...error, recovery: PREFERENCE_RECOVERY };
}

/** Recovery stays local to preferences: changing a theme never requires resending a diagram edit. */
const PREFERENCE_RECOVERY =
  'Choose an available theme or reset interface preferences. Stored diagram content is unchanged.';
