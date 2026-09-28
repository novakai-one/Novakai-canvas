/*
 * Why this file exists
 *
 * A render job needs a theme, fonts and images, which Templates, Assets and Design System look up.
 * Any of them can refuse. For example, if a font file that `my-diagram`'s theme uses is gone, the
 * job can't be built, and the last drawing stays on screen.
 *
 * This file makes the two mistakes building a job can end in, both at `render-resources`:
 * `missing-asset` when Templates, Assets or Design System refuse, and `invalid-input` when what
 * they gave back isn't in the form Presentation or Layout expects. They are Authoring's `Result`,
 * because Authoring's layout check builds jobs too. It never throws.
 */
import type { FailureSource } from '../../contract/records/transport/failure-source.js';
import type { AuthoringResult } from '../../contract/records/capability-types.js';
import type { Result } from '../../contract/errors.js';
import { authoringFailure } from '../../contract/errors.js';

/**
 * Passes on what Templates, Assets or Design System answered, or turns their refusal into
 * `missing-asset` at `render-resources`, keeping their own failure as the source.
 * There is no stand-in: a job never gets a fallback font or a blank image.
 */
export function requireResource<T>(answer: Result<T, FailureSource>): AuthoringResult<T> {
  if (!answer.ok) {
    return refusedResourceFailure(answer.error);
  }
  return answer;
}

/**
 * The `missing-asset` mistake at `render-resources`, with this message.
 * `source` is the refusal of Templates, Assets or Design System, when one of them refused.
 */
export function missingResourceFailure(
  message: string,
  source?: FailureSource,
): AuthoringResult<never> {
  return authoringFailure('missing-asset', 'render-resources', message, [], source);
}

/**
 * The `invalid-input` mistake at `render-resources`: a resource isn't in the form Presentation or
 * Layout expects.
 */
export function malformedResourceFailure(): AuthoringResult<never> {
  return authoringFailure(
    'invalid-input',
    'render-resources',
    'Render resources could not be decoded',
  );
}

/**
 * Makes the `missing-asset` mistake for a refusal from Templates, Assets or Design System, keeping
 * the refusal as its source.
 */
function refusedResourceFailure(refusal: FailureSource): AuthoringResult<never> {
  return missingResourceFailure('A render resource owner rejected input', refusal);
}
