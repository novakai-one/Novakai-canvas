import type { Collection, Section } from '../../contract/ports/model.js';
import { layoutProperties } from '../vocabulary/properties.js';
import { printProperties } from './properties.js';
import { reject, origin } from '../validation/outcomes.js';
type Layout = Collection['arrangement'];
type Target = Layout['constraints'][number]['targets'][number];
/** Relative constraints are emitted as authored targets, never computed coordinates. */
export function printConstraints(layout: Layout): readonly string[] {
  return layout.constraints.map(
    (constraint) => `${constraint.kind} ${constraint.targets.map(printTarget).join(' ')}`,
  );
}
/** Group/section namespaces are explicit; ordinary object targets retain compact @id syntax. */
function printTarget(target: Target): string {
  return target.kind === 'object' ? `@${target.id}` : `${target.kind}:@${target.id}`;
}
/** Layout header values use the shared property vocabulary. */
export function layoutAttributes(layout: Layout): readonly string[] {
  return printProperties(layout, layoutProperties);
}
/** Nested containment is bounded before rendering recursive group/sequence syntax. */
export function requireDepth(depth: number): void {
  if (depth > 60)
    reject(
      'unrepresentable',
      origin,
      'At most 60 nested view scopes',
      'Nested source would exceed the parser limit',
    );
}
/** Match layout scope by explicit parent identity rather than raw array adjacency. */
export function scopedGroups(
  section: Section,
  parent: string | undefined,
): Section['groups'] {
  return section.groups.filter((group) => group.parent === parent);
}
