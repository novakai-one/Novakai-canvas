import type {
  Scene,
  PlacedSection,
  Adjustment,
  Warning,
  Box,
} from '../../contract/records/geometry.js';
import type { LinearConstraint } from '../../contract/records/problem.js';
import type { SceneCandidate } from '../../contract/records/candidate.js';
import type { Projection, VisualSection, LayoutIntent } from '../../contract/records/input.js';
import type { LayoutOptions } from '../../contract/types.js';
import { crossesSegments } from '../routing/checks.js';
import { segments } from '../routing/paths.js';
import { relative } from '../constraints/relative.js';
import { violated } from '../constraints/evaluate.js';
import { equal } from '../validation/equality.js';
/** Geometry changes are visible records rather than silently discarded soft preferences. */
function adjustment(
  target: string,
  before: Adjustment['before'],
  after: Adjustment['after'],
  reason: string,
): readonly Adjustment[] {
  if (equal(before, after)) return [];
  return [{ target, before, after, reason }];
}
/** An authored placement carries optional dimensions; compare only actual supplied preferences. */
function authoredBox(
  placement: NonNullable<VisualSection['placement']>,
  actual: Box,
): Box {
  return {
    ...actual,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? actual.width,
    height: placement.height ?? actual.height,
  };
}
/** Ordinary node adjustments compare current authored preferences first, then surviving prior geometry. */
function nodeAdjustments(
  section: PlacedSection,
  prior: SceneCandidate | null,
): readonly Adjustment[] {
  const old = prior?.sections.find((item) => item.id === section.id);
  return section.nodes.flatMap((node) => {
    const before = node.measured.placement;
    if (before !== null)
      return adjustment(
        node.id,
        authoredBox(before, node.box),
        node.box,
        'Soft placement adjusted to fit required geometry',
      );
    return previousNode(node.id, node.box, old);
  });
}
/** New nodes have no prior geometry preference to report as an adjustment. */
function previousNode(
  id: string,
  after: Box,
  prior: SceneCandidate['sections'][number] | undefined,
): readonly Adjustment[] {
  const before = prior?.nodes.find((node) => node.id === id);
  if (!before) return [];
  return adjustment(
    id,
    before.box,
    after,
    'Previous position adjusted for changed content or constraints',
  );
}
/** Rerouted soft manual vertices remain visible in the derivation receipt. */
function wireAdjustments(
  section: PlacedSection,
  source: VisualSection,
): readonly Adjustment[] {
  return source.wires.flatMap((wire) => {
    const manual = wire.route.manual;
    if (manual === undefined) return [];
    const actual = section.wires.find((item) => item.id === wire.id);
    return adjustedRoute(wire.id, manual, actual);
  });
}
/** Missing derived wires are rejected by inspection; notices never invent replacement geometry. */
function adjustedRoute(
  id: string,
  before: Adjustment['before'],
  after: PlacedSection['wires'][number] | undefined,
): readonly Adjustment[] {
  if (!after) return [];
  return adjustment(
    id,
    before,
    after.points,
    'Soft manual route adjusted for ports, obstacles or label space',
  );
}
/** Section origin adjustments use their own collection frame rather than node-local coordinates. */
function sectionAdjustment(
  section: PlacedSection,
  source: VisualSection,
): readonly Adjustment[] {
  const placement = source.placement;
  if (placement === null) return [];
  const after = { ...section.box, ...section.origin };
  return adjustment(
    section.id,
    authoredBox(placement, after),
    after,
    'Soft section placement adjusted to avoid overlap',
  );
}
/** Gather all authored/prior geometry preference changes without changing the scene. */
export function adjustments(
  sections: readonly PlacedSection[],
  projection: Projection,
  previous: SceneCandidate | null,
): Scene['adjustments'] {
  return sections.flatMap((section) => notices(section, projection, previous));
}
/** Source identity lookup is optional here because the final inspector owns exact scene cardinality. */
function notices(
  section: PlacedSection,
  projection: Projection,
  previous: SceneCandidate | null,
): readonly Adjustment[] {
  const source = projection.sections.find((item) => item.id === section.id);
  if (!source) return [];
  return [
    ...nodeAdjustments(section, previous),
    ...wireAdjustments(section, source),
    ...sectionAdjustment(section, source),
  ];
}
/** Every strict wire crossing is reported once in stable source order. */
function crossingWarnings(sections: readonly PlacedSection[]): readonly Warning[] {
  return sections.flatMap(sectionCrossings);
}
/** Prepare once per wire; pairwise warning checks reuse that local work in source order. */
function sectionCrossings(section: PlacedSection): readonly Warning[] {
  const wires = section.wires.map((wire) => ({ wire, lines: segments(wire.points) }));
  return wires.flatMap(({ wire, lines }, index) =>
    wires
      .slice(index + 1)
      .filter((other) => crossesSegments(lines, other.lines))
      .map(({ wire: other }) => ({
        code: 'wire-crossing' as const,
        targets: [wire.id, other.id],
        message:
          'Connections cross; inspect labelled routes or add route intent if separation is required.',
      })),
  );
}
type AuthoredConstraint = LayoutIntent['constraints'][number];
/** One violated compiled equation is enough to report the authored preference it came from. */
function hintWarning(
  constraint: AuthoredConstraint,
  equations: readonly LinearConstraint[],
  boxes: ReadonlyMap<string, Box>,
): readonly Warning[] {
  if (violated(equations, boxes).length === 0) return [];
  return [
    {
      code: 'constraint-relaxed',
      targets: constraint.targets.map((target) => target.id),
      message: 'Authored spatial preference could not be fully honored; required geometry won.',
    },
  ];
}
/** Re-derive each authored hint's equations exactly as placement compiled them, per owning scope. */
function scopeWarnings(
  layout: LayoutIntent,
  nodes: VisualSection['nodes'],
  gap: number,
  scope: string,
  boxes: ReadonlyMap<string, Box>,
): readonly Warning[] {
  return layout.constraints.flatMap((constraint) =>
    hintWarning(
      constraint,
      relative({ ...layout, constraints: [constraint] }, nodes, gap, scope),
      boxes,
    ),
  );
}
/** Section and group hints reuse the same gap lookups placement used; satisfied hints emit nothing. */
function relaxedWarnings(
  section: PlacedSection,
  projection: Projection,
  options: LayoutOptions,
): readonly Warning[] {
  const source = projection.sections.find((item) => item.id === section.id);
  if (source === undefined) return [];
  const boxes: ReadonlyMap<string, Box> = new Map(section.nodes.map((node) => [node.id, node.box]));
  const own = scopeWarnings(
    source.layout,
    source.nodes,
    options.gap[source.layout.gap],
    source.id,
    boxes,
  );
  const grouped = source.groups.flatMap((group) =>
    scopeWarnings(group.layout, source.nodes, options.gap[group.layout.gap], group.id, boxes),
  );
  return [...own, ...grouped];
}
/** Warnings are a pure function of projection and final geometry; the inspector re-derives them identically. */
export function warnings(
  sections: readonly PlacedSection[],
  projection: Projection,
  options: LayoutOptions,
): readonly Warning[] {
  return [
    ...crossingWarnings(sections),
    ...sections.flatMap((section) => relaxedWarnings(section, projection, options)),
  ];
}
