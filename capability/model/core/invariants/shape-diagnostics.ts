import type { Diagnostic } from '../../contract/errors.js';

/**
 * Turns schema issues into Model `shape` diagnostics, one per issue, in the same order, so the
 * schema library's error objects never leave Model.
 *
 * Each diagnostic's path is the issue's path segments joined by `.` (for example
 * `objects.0.content`; `''` for the root); its message is the issue's message. Pure: Authoring
 * owns correction, commit and crash recovery.
 *
 * @param issues - The schema issues; normally at least one.
 * @returns A new list of diagnostics.
 * @throws Never for issues from zod.
 */
export function shapeErrors(issues: readonly ShapeIssue[]): readonly Diagnostic[] {
  return issues.map(
    /** Converts one schema issue. */
    (issue): Diagnostic => ({
      code: 'shape',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }),
  );
}

/** The part of a schema issue this file reads; both the collection and change parsers give it. */
interface ShapeIssue {
  /** The path segments from the root to the failing value. */
  readonly path: readonly PropertyKey[];
  /** The schema's explanation. */
  readonly message: string;
}
