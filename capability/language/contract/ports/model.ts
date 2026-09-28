/*
 * The Model roles Language depends on, one role each. Parsing needs no role; printing receives
 * only the reader and never the planner or stage. Also re-exports the Model record types
 * Language code reads. Language turns a role's rejection into diagnostics for the author to
 * correct; Authoring owns committing the result and recovering from failure.
 */
import type { Collection, ChangePlan, ChangeStage, Result } from '@novakai/canvas-model';

/** Model's validation of a raw collection record. */
export interface ModelReader {
  /**
   * Validates a raw collection record.
   *
   * @throws Whatever the implementation throws; Language reports it as `provider-failure`.
   */
  validate(input: unknown): Result<Collection>;
}

/** Model's final check of a complete change list. */
export interface ModelPlanner {
  /**
   * Checks a complete change list against a snapshot (for a new collection, an empty shell).
   *
   * @throws Whatever the implementation throws; Language reports it as `provider-failure`.
   */
  plan(
    snapshot: unknown,
    changes: unknown,
  ): Result<ChangePlan>;
}

/** Model's step-by-step application of changes, including unchecked intermediate states. */
export interface ModelStage {
  /**
   * Applies changes to a snapshot one after another, without the final validity check. For a
   * new collection, the snapshot is an empty shell of it.
   *
   * @throws Whatever the implementation throws; Language reports it as `provider-failure`.
   */
  stage(
    snapshot: unknown,
    changes: unknown,
  ): Result<ChangeStage>;
}

export type {
  Collection,
  DiagramObject,
  Section,
  ContentBlock,
  Change,
  TypeExpression,
  DefinitionId,
  Mode,
} from '@novakai/canvas-model';
