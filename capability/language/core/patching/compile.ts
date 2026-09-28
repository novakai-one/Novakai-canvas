/*
 * Compiling a parsed patch into Model changes. Each operation is compiled against the collection
 * Model staged from the original snapshot plus every change before it, so Model's cascades and
 * forward references carry through. Model's final plan is the only proof the result is valid.
 * Pure: the host's stage and planner are called, nothing is written. Language owns correcting
 * the source; Authoring owns commit and recovery.
 */
import type { Collection, Change } from '../../contract/ports/model.js';
import type { Patch, Operation } from '../../contract/records/syntax.js';
import type { LowerRequest, LoweredIntent } from '../../contract/records/requests.js';
import type { Dependencies } from '../../contract/types.js';
import type { RawRecord } from '../lowering/fields.js';
import { ownerValue } from '../lowering/diagnostics.js';
import { patchResources } from '../lowering/resources.js';
import { accepted, reject } from '../validation/outcomes.js';
import { copySpan } from '../validation/ownership.js';
import { membershipActions } from '../vocabulary/defaults.js';
import { requireSnapshot } from './targets.js';
import { structuralChange, resetChange } from './structural.js';
import { editBlocks } from './blocks.js';
import { editMembership } from './views.js';
import { editProperties } from './properties.js';

/** The state carried from one operation to the next. */
interface Compilation {
  /** The collection Model staged from the original plus every change so far. */
  readonly candidate: Collection;
  /** The staged changes so far, as Model returned them. */
  readonly changes: readonly Change[];
  /** The IDs of sections deleted so far in this patch. */
  readonly deletedSections: readonly string[];
}

/**
 * Compiles a patch into Model changes, in operation order.
 *
 * Steps; the first failure stops the patch:
 * 1. The request must be in `patch` mode and carry the snapshot of the patched collection.
 * 2. Stage the original with no changes (Model diagnostics at the whole patch).
 * 3. For each operation: refuse re-adding a section this patch deleted; compile the operation
 *    against the staged collection; stage the original plus all changes so far (Model
 *    diagnostics at that operation).
 * 4. Plan the original plus every staged change. Each Model diagnostic is placed at the operation
 *    with the longest target ID contained in its path, else at the whole patch. A `collection`
 *    operation's target ID is empty, which every path contains, so when the patch has one it
 *    catches every diagnostic no other operation matches.
 * 5. Return the planned collection, the staged changes, the patch's resource requests and the
 *    source map (each operation's target ID and a copy of its span).
 *
 * @throws A `LanguageFault`: `invalid-input` when the request is not in `patch` mode;
 * `unknown-target` when there is no snapshot or it is another collection; `invalid-value` when
 * a section deleted earlier in the patch is added again; the faults of each operation's
 * compiler; and `domain` diagnostics from Model's stage or plan. The public `lower` runs it
 * inside `protect`.
 */
export function lowerPatch(
  patch: Patch,
  request: LowerRequest,
  deps: Pick<Dependencies, 'stage' | 'planner'>,
): LoweredIntent {
  if (request.mode !== 'patch')
    reject(
      'invalid-input',
      patch.span,
      'patch mode',
      'Patch cannot create or replace a collection',
    );
  const original = requireSnapshot(request.snapshot, patch);
  const initial = ownerValue(deps.stage.stage(original, []), [], patch.span);
  const compiled = patch.operations.reduce<Compilation>(
    (state, operation) => compileNext(state, operation, original, request, deps.stage),
    { candidate: initial.candidate, changes: initial.changes, deletedSections: [] },
  );
  const mappings = patch.operations.map((operation) => ({
    path: operation.address.id,
    span: copySpan(operation.span),
  }));
  const plan = ownerValue(deps.planner.plan(original, compiled.changes), mappings, patch.span);
  const resources = patch.operations.flatMap(patchResources);
  return {
    mode: 'patch',
    collection: plan.candidate,
    changes: compiled.changes,
    resources,
    sourceMap: mappings,
  };
}

/** Stages the original plus the whole prefix, so cascades and forward references carry through. */
function compileNext(
  state: Compilation,
  operation: Operation,
  original: Collection,
  request: LowerRequest,
  stage: Dependencies['stage'],
): Compilation {
  checkSectionIdentity(state, operation);
  const change = compileOperation(state.candidate, operation, request);
  const staged = ownerValue(stage.stage(original, [...state.changes, change]), [], operation.span);
  return {
    candidate: staged.candidate,
    changes: staged.changes,
    deletedSections: deletedSections(state, operation),
  };
}

/** A section deleted earlier in the patch cannot be added again; `replace section` is used. */
function checkSectionIdentity(
  state: Compilation,
  operation: Operation,
): void {
  if (operation.target !== 'section' || operation.action !== 'add') return;
  if (state.deletedSections.includes(operation.address.id))
    reject(
      'invalid-value',
      operation.span,
      'replace section',
      'Cannot delete and recreate a section in one patch',
    );
}

/** The deleted-section IDs after this operation; only a section `delete` adds one. */
function deletedSections(
  state: Compilation,
  operation: Operation,
): readonly string[] {
  if (operation.target !== 'section' || operation.action !== 'delete') return state.deletedSections;
  return [...state.deletedSections, operation.address.id];
}

/** `set`/`unset` edit properties; block operations edit content; the rest go on below. */
function compileOperation(
  collection: Collection,
  operation: Operation,
  request: LowerRequest,
): RawRecord {
  if (operation.action === 'set' || operation.action === 'unset')
    return accepted(editProperties(collection, operation, request.resources));
  if (operation.target === 'block') return editBlocks(collection, operation);
  return compileStructuralOrView(collection, operation, request);
}

/** Membership actions (`show`, `hide`, `connect`, `disconnect`), `reset`, else structural. */
function compileStructuralOrView(
  collection: Collection,
  operation: Operation,
  request: LowerRequest,
): RawRecord {
  const action = operation.action;
  if (membershipActions.includes(action)) return editMembership(collection, operation);
  if (action === 'reset') return resetChange(operation);
  return structuralChange(operation, request.resources);
}
