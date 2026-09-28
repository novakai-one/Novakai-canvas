import type { StyleDeclaration, StyleCoverage } from '../../contract/records/artifacts.js';
import type { ResolvedTokenSet } from '../../contract/records/resolved.js';
import { cssName } from '../tokens/emit.js';
import { isEligible, variables, meaningfulLiterals, policyViolations } from './policy.js';
interface Counted {
  readonly eligible: boolean;
  readonly tokenized: boolean;
  readonly primary: boolean;
  readonly reasons: readonly string[];
  readonly declaration: StyleDeclaration;
}
/** Report honest numerator/denominator and exclusions; host gates whole-app states separately in Part2. */
export function auditStyles(
  styles: readonly StyleDeclaration[],
  resolved: ResolvedTokenSet,
): StyleCoverage {
  const names = Object.fromEntries(Object.keys(resolved.values).map((id) => [cssName(id), id]));
  const counted = styles.map((declaration) => inspectDeclaration(declaration, resolved, names));
  const denominator = counted.filter((item) => item.eligible).length;
  const tokenized = counted.filter((item) => item.eligible && item.tokenized).length;
  const primary = counted.filter((item) => item.eligible && item.primary).length;
  const violations = counted.flatMap((item) =>
    item.reasons.map((reason) => ({
      file: item.declaration.file,
      selector: item.declaration.selector,
      property: item.declaration.property,
      reason,
    })),
  );
  return {
    denominator,
    primary,
    tokenized,
    excluded: styles.length - denominator,
    primaryRatio: ratio(primary, denominator),
    tokenRatio: ratio(tokenized, denominator),
    violations,
  };
}
/** No eligible styles is no evidence, never a synthetic 100% success. */
function ratio(
  numerator: number,
  denominator: number,
): number {
  if (!denominator) return 0;
  return numerator / denominator;
}
/** Each eligible value must be fully tokenized; a token next to a literal color does not count. */
function inspectDeclaration(
  declaration: StyleDeclaration,
  resolved: ResolvedTokenSet,
  names: Readonly<Record<string, string>>,
): Counted {
  const refs = variables(declaration.value);
  const unknown = refs.filter((name) => names[name] === undefined);
  const literals = meaningfulLiterals(declaration.value);
  const eligible = isEligible(declaration);
  const tokenized = unknown.length === 0 && literals.length === 0;
  const primary =
    tokenized && refs.some((name) => reachesPrimary(names[name] ?? '', resolved, new Set()));
  const reasons = [
    ...policyViolations(declaration),
    ...unknown.map((name) => 'unknown-variable:' + name),
    ...literalViolations(eligible, literals),
  ];
  return { eligible, tokenized, primary, reasons, declaration };
}
/** Literal visual decisions fail explicitly; structural keyword-only declarations are excluded. */
function literalViolations(
  eligible: boolean,
  literals: readonly string[],
): readonly string[] {
  if (!eligible) return [];
  return literals.map((value) => 'visual-literal:' + value);
}
/** Follow immutable token dependencies; repeated ancestry is ignored defensively after source cycle validation. */
function reachesPrimary(
  id: string,
  resolved: ResolvedTokenSet,
  seen: ReadonlySet<string>,
): boolean {
  if (resolved.primary.includes(id)) return true;
  if (seen.has(id)) return false;
  return dependencyReaches(id, resolved, new Set([...seen, id]));
}
/** Dependency absence is a support-only leaf, never invented primary coverage. */
function dependencyReaches(
  id: string,
  resolved: ResolvedTokenSet,
  seen: ReadonlySet<string>,
): boolean {
  const dependencies = resolved.dependencies[id] ?? [];
  return dependencies.some((parent) => reachesPrimary(parent, resolved, seen));
}
