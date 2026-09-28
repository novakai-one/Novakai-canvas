import { LayoutFault } from '../../contract/errors.js';
import type {
  SolverProblem,
  PlacementValue,
  LinearConstraint,
  SolverValue,
} from '../../contract/records/problem.js';
import type { SolverPort } from '../../contract/ports/solver.js';
import type { JobControl, Job } from '../../contract/ports/scheduling.js';
import type { Diagnostic, Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { box } from '../../contract/records/geometry.js';
import type { PositionedInput } from './compile.js';
import { variableId } from './compile.js';
import { before } from './relative.js';
import { overlaps } from '../geometry/intersections.js';
import { expand, center } from '../geometry/bounds.js';
import { reject, requireValue } from '../validation/outcomes.js';
interface Control {
  readonly solver: SolverPort;
  readonly jobs: JobControl;
  readonly job: Job;
  readonly gap: number;
}
interface Collision {
  readonly a: PlacementValue;
  readonly b: PlacementValue;
}
type Search =
  | {
      readonly kind: 'found';
      readonly values: readonly PlacementValue[];
      readonly remaining: number;
    }
  | { readonly kind: 'dead-end'; readonly remaining: number }
  | { readonly kind: 'failed'; readonly error: Diagnostic; readonly remaining: number };
/** Native variable identity/count must exactly match the owned problem before values become boxes. */
function values(
  input: readonly SolverValue[],
  problem: SolverProblem,
  items: readonly PositionedInput[],
): readonly PlacementValue[] {
  const expected = problem.variables.map((item) => item.id).toSorted();
  const actual = input.map((item) => item.id).toSorted();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    return reject('engine-failed', 'solver', 'Native variable set does not match the problem');
  const lookup = new Map(input.map((item) => [item.id, item.value]));
  return items.map((item) => readBox(item.node.id, lookup));
}
/** Four checked fields construct each box; absent/nonfinite native values are never defaults. */
function readBox(
  id: string,
  values: ReadonlyMap<string, number>,
): PlacementValue {
  const parsed = box.safeParse({
    x: values.get(variableId(id, 'x')),
    y: values.get(variableId(id, 'y')),
    width: values.get(variableId(id, 'width')),
    height: values.get(variableId(id, 'height')),
  });
  if (!parsed.success) return reject('engine-failed', id, 'Native solver returned invalid bounds');
  return { id, box: parsed.data };
}
/** Native solving is bracketed by host checkpoints; cancelled completion never becomes current geometry. */
async function solve(
  problem: SolverProblem,
  items: readonly PositionedInput[],
  control: Control,
): Promise<Result<readonly PlacementValue[]>> {
  requireValue(await control.jobs.checkpoint(control.job));
  const result = control.solver.solve(problem);
  requireValue(await control.jobs.checkpoint(control.job));
  if (!result.ok) return result;
  return { ok: true, value: values(result.value, problem, items) };
}
/** Only ancestor containment is exempt from nonoverlap; separate branches remain obstacles to one another. */
function ancestor(
  parent: string,
  child: string,
  items: readonly PositionedInput[],
): boolean {
  const node = items.find((item) => item.node.id === child)?.node;
  if (node?.parent === parent) return true;
  return nextAncestor(parent, node?.parent ?? null, items);
}
/** Validated acyclic parents bound recursive ancestry lookup by the number of nodes. */
function nextAncestor(
  parent: string,
  next: string | null,
  items: readonly PositionedInput[],
): boolean {
  if (next === null) return false;
  return ancestor(parent, next, items);
}
/** Parent/descendant boxes are intentionally nested and are inspected by containment equations instead. */
function separate(
  a: PlacementValue,
  b: PlacementValue,
  items: readonly PositionedInput[],
): boolean {
  return !ancestor(a.id, b.id, items) && !ancestor(b.id, a.id, items);
}
/** Stable first collision keeps search deterministic for identical source ordering and native output. */
function collision(
  values: readonly PlacementValue[],
  items: readonly PositionedInput[],
  gap: number,
): Collision | null {
  const pairs = values.flatMap((a, index) => values.slice(index + 1).map((b) => ({ a, b })));
  return (
    pairs.find(
      (pair) =>
        separate(pair.a, pair.b, items) &&
        overlaps(expand(pair.a.box, gap / 2), expand(pair.b.box, gap / 2)),
    ) ?? null
  );
}
/** Each disjunct is a real nonoverlap inequality; preferences select order, not required truth. */
function choices(
  pair: Collision,
  gap: number,
): readonly LinearConstraint[] {
  const a = pair.a.id;
  const b = pair.b.id;
  const horizontal = [
    before(`${a}:${b}:left`, a, b, 'x', gap, 'required'),
    before(`${a}:${b}:right`, b, a, 'x', gap, 'required'),
  ];
  const vertical = [
    before(`${a}:${b}:up`, a, b, 'y', gap, 'required'),
    before(`${a}:${b}:down`, b, a, 'y', gap, 'required'),
  ];
  return preferred(pair, horizontal, vertical);
}
/** Prefer the axis with greater seed separation; alternatives remain available after a contradiction. */
function preferred(
  pair: Collision,
  horizontal: readonly LinearConstraint[],
  vertical: readonly LinearConstraint[],
): readonly LinearConstraint[] {
  const a = center(pair.a.box);
  const b = center(pair.b.box);
  const x = ordered(horizontal, a.x <= b.x);
  const y = ordered(vertical, a.y <= b.y);
  if (Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)) return [...x, ...y];
  return [...y, ...x];
}
/** Reverse a two-way orientation preference without mutating the shared candidates. */
function ordered(
  values: readonly LinearConstraint[],
  forward: boolean,
): readonly LinearConstraint[] {
  if (forward) return values;
  return values.toReversed();
}
/** Bounded search failure is distinct from a proof that authored constraints contradict one another. */
function exhausted(remaining: number): Search {
  const result = failure<never>('limit', 'nonoverlap', 'Nonoverlap search budget exhausted');
  if (result.ok) return { kind: 'dead-end', remaining };
  return { kind: 'failed', error: result.error, remaining };
}
/** Search branches only when actual geometry overlaps; normal ELK seeds need no combinatorial expansion. */
async function search(
  problem: SolverProblem,
  items: readonly PositionedInput[],
  placed: readonly PlacementValue[],
  remaining: number,
  control: Control,
): Promise<Search> {
  const pair = collision(placed, items, control.gap);
  if (pair === null) return { kind: 'found', values: placed, remaining };
  return alternatives(choices(pair, control.gap), problem, items, remaining, control);
}
/** Try one orientation at a time and carry the remaining global budget through backtracking. */
async function alternatives(
  choices: readonly LinearConstraint[],
  problem: SolverProblem,
  items: readonly PositionedInput[],
  remaining: number,
  control: Control,
): Promise<Search> {
  if (remaining === 0) return exhausted(remaining);
  const choice = choices[0];
  if (choice === undefined) return { kind: 'dead-end', remaining };
  const expanded = { ...problem, constraints: [...problem.constraints, choice] };
  const result = await solve(expanded, items, control);
  const attempt = await continueSearch(result, expanded, items, remaining - 1, control);
  return nextAlternative(attempt, choices.slice(1), problem, items, control);
}
/** A native contradiction rejects this orientation only; infrastructure errors stop the search. */
async function continueSearch(
  result: Result<readonly PlacementValue[]>,
  problem: SolverProblem,
  items: readonly PositionedInput[],
  remaining: number,
  control: Control,
): Promise<Search> {
  if (result.ok) return search(problem, items, result.value, remaining, control);
  return rejectedBranch(result.error, remaining);
}
/** The same required-equation failure means an alternative branch, not an authored semantic contradiction. */
function rejectedBranch(
  error: Diagnostic,
  remaining: number,
): Search {
  if (error.code === 'constraint-conflict') return { kind: 'dead-end', remaining };
  return { kind: 'failed', error, remaining };
}
/** Exhausted orientations backtrack; success and real native failure propagate unchanged. */
async function nextAlternative(
  attempt: Search,
  choices: readonly LinearConstraint[],
  problem: SolverProblem,
  items: readonly PositionedInput[],
  control: Control,
): Promise<Search> {
  if (attempt.kind !== 'dead-end') return attempt;
  return alternatives(choices, problem, items, attempt.remaining, control);
}
/** Base required contradictions are authoritative; geometric-search exhaustion is explicitly weaker evidence. */
export async function separateBoxes(
  problem: SolverProblem,
  items: readonly PositionedInput[],
  control: Control,
  maxBranches: number,
): Promise<readonly PlacementValue[]> {
  const initial = requireValue(await solve(problem, items, control));
  const result = await search(problem, items, initial, maxBranches, control);
  return complete(result);
}
/** Successful boxes are the only output; Authoring retains the prior scene on either failure category. */
function complete(result: Search): readonly PlacementValue[] {
  if (result.kind === 'found') return result.values;
  return failedSearch(result);
}
/** Distinguish an exhausted geometric strategy from a typed infrastructure/cancellation failure. */
function failedSearch(result: Exclude<Search, { kind: 'found' }>): never {
  if (result.kind === 'failed') throw new LayoutFault(result.error);
  return reject(
    'engine-failed',
    'nonoverlap',
    'No nonoverlapping arrangement found by the bounded strategy',
  );
}
