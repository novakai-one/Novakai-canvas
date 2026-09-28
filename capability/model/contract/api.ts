/**
 * Model's callable boundary: validate diagram data, plan a valid immutable transition, or stage
 * one unchecked. These three return deeply frozen typed outcomes and perform no I/O. Authoring
 * owns admission, revision increments, commit and crash recovery.
 *
 * The definition and callable helpers below read an already validated collection; they do not
 * validate or freeze.
 */

/**
 * Validates unknown collection data: plain-data inspection, then the strict schema, then every
 * domain rule. The full contract is on `validateCollection` (`core/invariants/validate.ts`),
 * which editors show when hovering `validate`.
 *
 * @param input - Proposed collection data.
 * @returns The detached collection, or `validation-failed`. Either outcome is deeply frozen.
 * @throws Never.
 */
export { validateCollection as validate } from '../core/invariants/validate.js';

/**
 * Plans an ordered change batch against a snapshot: validates the snapshot, stages the changes
 * (see {@link stage}), then validates the resulting candidate as a whole collection. Changes may
 * temporarily break references as long as the final candidate is valid. The revision is never
 * incremented and nothing is written.
 *
 * The first failing step's diagnostics are returned: the snapshot's, then staging's, then the
 * candidate's. A throw that escapes those steps is `shape` at `changes`, "Input could not be
 * read as plain data".
 *
 * @param snapshot - The current collection data.
 * @param changes - The ordered changes (at most 1,000).
 * @returns The valid candidate and its net impact (records added, updated or removed), or
 * `validation-failed`. Either outcome is deeply frozen.
 * @throws Never.
 */
export { planChanges as plan } from '../core/collection/plan.js';

/**
 * Stages a change batch without the final validity check, for the language compiler. It
 * validates the snapshot, inspects the changes as plain JSON, parses them with the change
 * schema, then applies them in order and stops at the first failing change. The candidate's
 * references may be unresolved; only {@link plan} proves validity.
 *
 * A throw that escapes those steps is `shape` at `changes`, "Input could not be read as plain
 * data".
 *
 * @param snapshot - The current collection data.
 * @param changes - The ordered changes (at most 1,000).
 * @returns The unchecked candidate with the parsed changes (`validity: 'unchecked'`), or
 * `validation-failed`. Either outcome is deeply frozen.
 * @throws Never.
 */
export { stageChanges as stage } from '../core/collection/stage.js';

/**
 * Shows a shared type definition as text, expanding the definitions it references.
 *
 * A reference back to a definition already being expanded, or to a missing one, shows as `@id`.
 * At most 256 expression nodes are shown; a longer display ends with ` …`.
 *
 * @param collection - A validated collection.
 * @param id - The definition to show.
 * @returns The display text, or `validation-failed` with `not-found` at `definitions.<id>`,
 * "Definition ID must exist", when no definition has that ID. Not frozen.
 * @throws Only if given data that is not a validated collection.
 */
export { definitionDisplay } from '../core/definitions.js';

/**
 * Lists every direct use of a definition: fields, members, signature parameters and returns, and
 * other definitions' expressions, sorted by path.
 *
 * @param collection - A validated collection.
 * @param id - The definition whose uses to list.
 * @returns The uses, or `validation-failed` with `not-found` at `definitions.<id>`, "Definition
 * ID must exist", when no definition has that ID. Not frozen.
 * @throws Only if given data that is not a validated collection.
 */
export { definitionUsages } from '../core/definitions.js';

/**
 * Shows a field's type: a plain string type as written, or a definition reference displayed as
 * {@link definitionDisplay} does (a missing definition shows as `@id`).
 *
 * @param collection - A validated collection.
 * @param field - A field from that collection.
 * @returns The display text.
 * @throws Only if given data that is not a validated collection.
 */
export { fieldTypeDisplay } from '../core/definitions.js';

/**
 * Shows a type use: a plain string type as written, or a definition reference displayed as
 * {@link definitionDisplay} does (a missing definition shows as `@id`).
 *
 * @param collection - A validated collection.
 * @param type - A type use from that collection.
 * @returns The display text.
 * @throws Only if given data that is not a validated collection.
 */
export { typeUseDisplay } from '../core/definitions.js';

/**
 * Resolves a relationship endpoint to a callable target in a validated collection: a whole
 * `function` object, or a `signature` member of a `module`, `interface` or `function` object.
 * The full contract is on `resolveCallableEndpoint` (`core/relationships/callable.ts`).
 *
 * @param collection - A validated collection.
 * @param endpoint - The relationship endpoint to resolve.
 * @returns The owner (and member), or `undefined` when the endpoint is not callable. Not frozen.
 * @throws Only if given data that is not a validated collection, or an endpoint that is not plain
 * parsed data.
 */
export { resolveCallableEndpoint } from '../core/relationships/callable.js';

/** A resolved callable target: its owning object and, for a signature, the member. */
export type { CallableEndpoint } from '../core/relationships/callable.js';

/** One direct use of a definition, addressed by its collection path. */
export type { DefinitionUsage } from '../core/definitions.js';
