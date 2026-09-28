import { treeRows } from './tree.js';
import { requireValue } from '../validation/outcomes.js';
import type { VisualNode, VisualSection, LayoutIntent } from '../../contract/records/input.js';
import type {
  PlacementValue,
  PlacementProblem,
  PlacementNode,
} from '../../contract/records/problem.js';
import type { Point } from '../../contract/records/geometry.js';
import type { SupplementalMeasurements, SeedContext } from '../../contract/types.js';
import { routingGap, crossingGap, labelPadding } from './spacing.js';
import { placeScope } from './policy.js';
import { scopeEdges } from './scope-edges.js';
import { union } from '../geometry/bounds.js';
import { reject } from '../validation/outcomes.js';
interface Branch {
  readonly root: PlacementValue;
  readonly descendants: readonly PlacementValue[];
}
/** A group is measured from its own children before its parent scope is arranged. */
async function branch(
  node: VisualNode,
  section: VisualSection,
  context: SeedContext,
  measurements: SupplementalMeasurements,
): Promise<Branch> {
  const descendants = await seedScope(node.id, section, context, measurements);
  if (descendants.length === 0)
    return {
      root: { id: node.id, box: { x: 0, y: 0, width: node.width, height: node.height } },
      descendants,
    };
  return container(
    node,
    descendants,
    context.options.padding,
    labelPadding(node, section, context.options),
  );
}
/** Header and padding belong to the outer group; descendant points remain section-frame translations. */
function container(
  node: VisualNode,
  descendants: readonly PlacementValue[],
  padding: number,
  trailing: { readonly width: number; readonly height: number },
): Branch {
  const bounds = union(descendants.map((item) => item.box));
  const offset = { x: padding - bounds.x, y: node.headerHeight + padding - bounds.y };
  return {
    root: {
      id: node.id,
      box: {
        x: 0,
        y: 0,
        width: Math.max(node.width, bounds.width + padding + trailing.width),
        height: Math.max(
          node.height,
          bounds.height + node.headerHeight + padding + trailing.height,
        ),
      },
    },
    descendants: descendants.map((item) => translate(item, offset)),
  };
}
/** Translation never changes dimensions or interprets IDs as coordinate paths. */
export function translate(
  item: PlacementValue,
  offset: Point,
): PlacementValue {
  return { ...item, box: { ...item.box, x: item.box.x + offset.x, y: item.box.y + offset.y } };
}
/** Nested group layout is explicitly independent of the enclosing section's chosen algorithm. */
function intent(
  parent: string | null,
  section: VisualSection,
): LayoutIntent {
  if (parent === null) return section.layout;
  const node = section.nodes.find((item) => item.id === parent);
  const group = section.groups.find((item) => item.id === node?.groupId);
  if (!group) return reject('invalid-input', parent, 'Visible group has no layout intent');
  return group.layout;
}
/** Reattach child-local descendants after the native engine chooses the branch's outer position. */
function flatten(
  value: PlacementValue,
  branches: readonly Branch[],
): readonly PlacementValue[] {
  const found = branches.find((item) => item.root.id === value.id);
  if (!found) return reject('engine-failed', value.id, 'Placement returned an unknown branch');
  return [value, ...found.descendants.map((item) => translate(item, value.box))];
}
/** Bottom-up scoped arrangement honours each group's algorithm through injected native engines.
 * Pure retries are safe; Layout execute catches structured faults and Authoring retains the scene. */
export async function seedScope(
  parent: string | null,
  section: VisualSection,
  context: SeedContext,
  measurements: SupplementalMeasurements,
): Promise<readonly PlacementValue[]> {
  const children = section.nodes.filter((node) => node.parent === parent);
  if (children.length === 0) return [];
  const branches = await Promise.all(
    children.map((node) => branch(node, section, context, measurements)),
  );
  const roots = branches.map((item) => item.root.id);
  const layout = intent(parent, section);
  const localEdges = scopeEdges(roots, section);
  const rankedEdges = rankingEdges(localEdges, section, layout);
  const nodes = branches.map((item) => ({
    id: item.root.id,
    parent: null,
    width: item.root.box.width,
    height: item.root.box.height,
    header: 0,
    ...layer(section.nodes.find((node) => node.id === item.root.id)?.kind),
  }));
  const tree = treeRows(
    section,
    branches.map((item) => item.root),
    context.options.gap[layout.gap],
    layout.algorithm,
  );
  if (tree !== undefined) return tree.flatMap((item) => flatten(item, branches));
  const placed = requireValue(
    await placeScope(
      {
        nodes,
        edges: rankedEdges,
        layout,
        minimumCrossSpacing: crossingGap(section, localEdges, measurements, context.options),
        minimumLayerSpacing: routingGap(
          section,
          localEdges,
          layout.direction,
          measurements,
          context.options,
        ),
      },
      context,
    ),
  );
  return placed.flatMap((item) => flatten(item, branches));
}

const layers: Readonly<Record<string, 'first' | 'last'>> = { start: 'first', end: 'last' };
function layer(kind: string | undefined): Pick<PlacementNode, 'layer'> {
  const value = layers[kind ?? ''];
  return value === undefined ? {} : { layer: value };
}
/** Validated semantic parents alone determine tree ranks; references still reserve routing corridors. */
function rankingEdges(
  localEdges: PlacementProblem['edges'],
  section: VisualSection,
  layout: LayoutIntent,
): PlacementProblem['edges'] {
  if (layout.algorithm !== 'tree') return localEdges;
  const parents = new Set<string>(
    section.wires.filter((wire) => wire.kind === 'parent').map((wire) => wire.id),
  );
  return localEdges.filter((edge) => parents.has(edge.id));
}
