import { nativeEngineVersions } from '../contract/records/engines.js';
import { Solver, Variable, Expression, Constraint, Operator, Strength } from '@lume/kiwi';
import type { SolverPort } from '../contract/ports/solver.js';
import type {
  SolverProblem,
  SolverValue,
  LinearConstraint,
  Term,
} from '../contract/records/problem.js';
import { failure } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
/** Native factory is replaceable in adapter contract tests; it allocates no shared solver state. */
export type SolverFactory = () => Solver;
const operators = { eq: Operator.Eq, le: Operator.Le, ge: Operator.Ge };
const strengths = { required: Strength.required, strong: Strength.strong, weak: Strength.weak };
/** Native variables are job-local handles; identity lookup never falls back to an unrelated variable. */
function variable(
  id: string,
  variables: ReadonlyMap<string, Variable>,
): Variable {
  const found = variables.get(id);
  if (!found) throw new Error('Unknown solver variable');
  return found;
}
/** A term names its coefficient and variable explicitly rather than building opaque expression tuples inline. */
function term(
  item: Term,
  variables: ReadonlyMap<string, Variable>,
): Expression {
  return new Expression([item.coefficient, variable(item.variable, variables)]);
}
/** Constraint semantics were compiled by core; this stage only maps them to the native numeric ABI. */
function constraint(
  item: LinearConstraint,
  variables: ReadonlyMap<string, Variable>,
): Constraint {
  const expression = item.terms.reduce(
    (expression, item) => expression.plus(term(item, variables)),
    new Expression(),
  );
  return new Constraint(
    expression,
    operators[item.operator],
    item.constant,
    strengths[item.strength],
  );
}
/** Native insertion failure identifies the exact required equation; core distinguishes geometric search alternatives. */
function add(
  item: LinearConstraint,
  variables: ReadonlyMap<string, Variable>,
  solver: Solver,
): Result<void> {
  try {
    solver.addConstraint(constraint(item, variables));
    return { ok: true, value: undefined };
  } catch (error) {
    return rejection(error, item);
  }
}
/** Patched native contradictions carry an explicit code; engine failures are never inferred from message text. */
function rejection(
  error: unknown,
  item: LinearConstraint,
): Result<void> {
  if (isContradiction(error))
    return failure(
      'constraint-conflict',
      item.id,
      'Required linear constraints cannot be satisfied',
      item.targets,
    );
  return failure('engine-failed', item.id, 'Native constraint insertion failed', item.targets);
}
/** The local dependency patch changes error tagging only; upstream messages remain untouched for diagnostics. */
function isContradiction(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return Reflect.get(error, 'code') === 'UNSATISFIABLE_CONSTRAINT';
}
/** Variable preferences are weak/strong suggestions and cannot override required locks or equations. */
function suggest(
  problem: SolverProblem,
  variables: ReadonlyMap<string, Variable>,
  solver: Solver,
): void {
  problem.variables.forEach((item) => {
    const native = variable(item.id, variables);
    solver.addEditVariable(native, strengths[item.strength]);
    solver.suggestValue(native, item.initial);
  });
}
/** Add in stable order; the first rejected equation is returned with its authored target IDs. */
function insert(
  problem: SolverProblem,
  variables: ReadonlyMap<string, Variable>,
  solver: Solver,
): Result<void> {
  return problem.constraints.reduce<Result<void>>(
    (state, item) => insertNext(state, item, variables, solver),
    { ok: true, value: undefined },
  );
}
/** A rejected equation stops mutation of the per-call native solver. */
function insertNext(
  state: Result<void>,
  item: LinearConstraint,
  variables: ReadonlyMap<string, Variable>,
  solver: Solver,
): Result<void> {
  if (!state.ok) return state;
  return add(item, variables, solver);
}
/** Native variables are read once after solving; only detached numeric values leave this adapter. */
function solve(
  problem: SolverProblem,
  native: SolverFactory,
): Result<readonly SolverValue[]> {
  const solver = native();
  const variables = new Map(problem.variables.map((item) => [item.id, new Variable(item.id)]));
  suggest(problem, variables, solver);
  const inserted = insert(problem, variables, solver);
  if (!inserted.ok) return inserted;
  solver.updateVariables();
  return {
    ok: true,
    value: problem.variables.map((item) => ({
      id: item.id,
      value: variable(item.id, variables).value(),
    })),
  };
}
/** Adapter exceptions remain typed; Layout retains the old scene and independently inspects successful values. */
export function createSolver(native: SolverFactory = () => new Solver()): SolverPort {
  return {
    version: nativeEngineVersions.solver,
    solve(problem: SolverProblem): Result<readonly SolverValue[]> {
      try {
        return solve(problem, native);
      } catch {
        return failure('engine-failed', 'solver', 'Native solver failed');
      }
    },
  };
}
