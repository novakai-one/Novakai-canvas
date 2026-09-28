import { collectionSchema, type Collection } from '../../contract/records/collection.js';
import type { Result, Diagnostic } from '../../contract/errors.js';
import { inspectInput } from './input.js';
import { validateIdentity } from './identity.js';
import { validateReferences } from './references.js';
import { validateContent } from '../objects/content.js';
import { validateComposition } from '../objects/composition.js';
import { validateKeys } from '../objects/keys.js';
import { validateRelationships } from '../relationships/endpoints.js';
import { validateSections } from '../sections/views.js';
import { validateLayouts } from '../sections/layout.js';
import { freeze } from './freeze.js';
import { failure, success, rejected } from './issues.js';
import { shapeErrors } from './shape-diagnostics.js';
import { validateDefinitionGraph } from '../definitions.js';

/**
 * Validates unknown collection data. Published as Model's `validate`.
 *
 * In order:
 * 1. inspects the input as plain JSON without running accessors: no getters, hidden or symbol
 *    fields, cycles, sparse arrays or arrays with extra fields, non-plain prototypes, and no
 *    `undefined`, functions, bigints, symbols or non-finite numbers (`shape`), and at most 100,000
 *    values and 64 levels (`limit`). The first problem found is returned; its path starts with `$`
 *    (for example `$.objects.0`). A throw while inspecting (for example a revoked proxy) is
 *    `shape` at `$`, "Input cannot be inspected as plain data";
 * 2. parses it with the strict collection schema, which builds a detached copy (`shape`
 *    diagnostics, one per schema issue, at the issue's path joined by `.`);
 * 3. runs every domain rule on the copy and collects all their diagnostics, in rule order:
 *    identity, content, composition, references, keys, relationships, sections, layouts,
 *    definitions.
 *
 * A throw during steps 2–3 (for example from a proxy trap) is `shape` at `$`, "Input could not
 * be read as plain data". The input is never changed or frozen. The same plain input can be
 * validated again with the same outcome. Authoring owns admission, revision increments, commit
 * and crash recovery.
 *
 * @param input - Proposed collection data.
 * @returns The detached collection, or `validation-failed` with at least one diagnostic and no
 * partial value. Either outcome is deeply frozen.
 * @throws Never.
 */
export function validateCollection(input: unknown): Result<Collection> {
  const inspected = inspectInput(input);
  if (!inspected.ok) {
    return freeze(inspected);
  }
  const validated = safelyValidateShape(input);
  return freeze(validated);
}

/** A domain rule: it reads a parsed collection and returns its diagnostics. */
type CollectionRule = (collection: Collection) => readonly Diagnostic[];

/** Every domain rule, in the order they run and report. */
const collectionRules: readonly CollectionRule[] = [
  validateIdentity,
  validateContent,
  validateComposition,
  validateReferences,
  validateKeys,
  validateRelationships,
  validateSections,
  validateLayouts,
  validateDefinitionGraph,
];

/**
 * Parses the input into a detached collection, then runs every domain rule on it. Schema failures
 * stop before any rule runs, so rules only see structurally valid data.
 */
function parseAndValidate(input: unknown): Result<Collection> {
  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success) {
    return rejected(shapeErrors(parsed.error.issues));
  }
  const diagnostics = collectionRules.flatMap(
    /** Runs one rule on the parsed collection. */
    (rule) => rule(parsed.data),
  );
  if (diagnostics.length > 0) {
    return rejected(diagnostics);
  }
  return success(parsed.data);
}

/**
 * Runs {@link parseAndValidate}, turning any throw into `shape` at `$`, "Input could not be read
 * as plain data", with no partial value and no parser error exposed.
 */
function safelyValidateShape(input: unknown): Result<Collection> {
  try {
    return parseAndValidate(input);
  } catch {
    return failure('shape', '$', 'Input could not be read as plain data');
  }
}
