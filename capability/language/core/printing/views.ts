import type { Section } from '../../contract/ports/model.js';
import { header, printProperties } from './properties.js';
import { body } from './strings.js';
import { layoutAttributes, printConstraints, scopedGroups, requireDepth } from './layout.js';
import { printSequence } from './sequence.js';
import { patchProperties } from '../vocabulary/patch-properties.js';
/** A section combines scope membership, explicit connections, hard constraints and mode-specific semantics. */
export function printSection(section: Section): string {
  const title = [header('section', section), ...layoutAttributes(section.layout)].join(' ');
  return body(title, [
    ...printScope(section),
    ...section.wires.map(printWire),
    ...printConstraints(section.layout),
    ...root(section),
    ...printSequence(section),
  ]);
}
/** Appearance and group orders are preserved within their owning layout scopes. */
function printScope(
  section: Section,
  parent?: string,
  depth = 0,
): readonly string[] {
  requireDepth(depth);
  const appearances = section.appearances
    .filter((item) => item.group === parent)
    .map(printAppearance);
  const groups = scopedGroups(section, parent).map((group) =>
    printGroup(section, group, depth + 1),
  );
  return [...appearances, ...groups];
}
/** Represented groups do not emit an additional show for their represented canonical object. */
function printGroup(
  section: Section,
  group: Section['groups'][number],
  depth: number,
): string {
  const title = [header('group', group), ...layoutAttributes(group.layout)].join(' ');
  return body(title, [...printScope(section, group.id, depth), ...printConstraints(group.layout)]);
}
/** Human geometry stays out of appearance syntax; only semantic preferences are printed. */
function printAppearance(appearance: Section['appearances'][number]): string {
  return [
    `show @${appearance.object}`,
    ...printProperties(appearance, patchProperties.appearance),
  ].join(' ');
}
/** Wire labels live canonically; view syntax retains route and attachment preferences. */
function printWire(wire: Section['wires'][number]): string {
  return [`connect @${wire.relationship}`, ...printProperties(wire, patchProperties.route)].join(
    ' ',
  );
}
/** Tree root is optional in other modes, and never inferred from declaration order. */
function root(section: Section): readonly string[] {
  return section.root === undefined ? [] : [`root @${section.root}`];
}
