import type { Result } from '../errors.js';
import type { Collection } from '../records/artifact.js';
import type { Resource } from '../records/resource.js';

/**
 * Collection records and their DSL text, supplied by the host: Model validates records and
 * Language prints and parses the complete readable DSL. The host adapts their failures into
 * Export's diagnostic vocabulary. Export calls these synchronously, when building a bundle and
 * when preparing an import; an exception thrown by one becomes that operation's failure. Export
 * treats them as side-effect free and may call them more than once (preparing an import calls
 * `read` twice); there is nothing to recover.
 */
export interface Documents {
  /**
   * Validates collection data.
   *
   * @param input - Candidate collection data.
   * @returns The validated collection, or a failure.
   */
  read(input: unknown): Result<Collection>;

  /**
   * Prints a collection as complete DSL (`canvas 1` source). When building a bundle, Export
   * requires the text to start with `canvas 1` (after leading whitespace), and parsing it,
   * applying the manual snapshot and reading it again must give back the same collection apart
   * from its revision. Otherwise the bundle fails with `invalid-bundle`.
   *
   * @param collection - A validated collection.
   * @returns The DSL text, or a failure.
   */
  print(collection: Collection): Result<string>;

  /**
   * Parses complete DSL back into a collection.
   *
   * @param source - DSL text.
   * @param resources - The resources the source may reference.
   * @returns The collection, or a failure.
   */
  parse(
    source: string,
    resources: readonly Resource[],
  ): Result<Collection>;
}
