/**
 * Machine-readable failure categories. Consumers branch on the code and never parse message
 * text.
 *
 * - `shape`: input is not plain JSON, fails the strict schema, could not be read (a throw), or is
 *   an unsupported change operation; also a rule that rejected input without any diagnostic (at
 *   `$`).
 * - `limit`: input over 100,000 values or 64 levels deep; a definition expression too large or
 *   too deeply nested.
 * - `duplicate`: an ID or value repeated where it must be unique.
 * - `reference`: an ID that does not resolve in this collection and scope, or definitions that
 *   reference each other in a cycle.
 * - `content`: a content block is not allowed on its object or is malformed (for example a table
 *   row of the wrong width), or a composition or group-role rule is broken.
 * - `endpoint`: a relationship endpoint does not fit its relationship kind (object kind, member,
 *   call target or cardinality).
 * - `key`: an entity key rule is broken (for example a foreign key without a reference).
 * - `group`: a section container rule is broken.
 * - `layout`: a section view or layout override rule is broken.
 * - `mode`: a section's contents or layout do not fit its mode.
 * - `tree`: a tree-mode section's structure is broken.
 * - `sequence`: a sequence-mode section's steps are broken.
 * - `identity`: `replace-document` changes the collection's ID or revision.
 * - `not-found`: a change or helper names a record or view that does not exist.
 * - `already-exists`: `create` uses an ID that already exists.
 * - `delete-referenced`: `delete-object` without `cascade` on an object that is still used.
 */
export type DiagnosticCode =
  | 'shape'
  | 'limit'
  | 'duplicate'
  | 'reference'
  | 'content'
  | 'endpoint'
  | 'key'
  | 'group'
  | 'layout'
  | 'mode'
  | 'tree'
  | 'sequence'
  | 'identity'
  | 'not-found'
  | 'already-exists'
  | 'delete-referenced';

/** One failure at a collection or change path. The message is explanatory text for a reader. */
export interface Diagnostic {
  /** The failure category. */
  readonly code: DiagnosticCode;
  /**
   * Where it happened, as a dotted path:
   * - plain-data inspection paths start with `$` (for example `$.objects.0`);
   * - schema paths have no `$` and are `''` at the root (for example `objects.a.content.b`);
   * - change paths can also be `changes` or `collection`.
   */
  readonly path: string;
  /** What is wrong, in plain words. */
  readonly message: string;
}

/** A rejection with at least one diagnostic. No partial value is exposed. */
export interface ValidationError {
  /** Always `validation-failed`. */
  readonly code: 'validation-failed';
  /** Every diagnostic found, in the order the rules produced them; never empty. */
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
}

/**
 * The outcome of a Model operation: a value, or an error. Declared here because each capability
 * owns its own result type (no shared kernel).
 *
 * @typeParam T - The success value.
 * @typeParam E - The error. Defaults to {@link ValidationError}.
 */
export type Result<T, E = ValidationError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
