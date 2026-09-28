import type { Result } from '../../contract/errors.js';
/** Section placement runs under Layout execute; Authoring retains committed state and the caller keeps its previous scene on failure. */
import { participantConstraints } from '../sequence/participants.js';
import type { VisualSection, VisualNode } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { PlacedNode } from '../../contract/records/geometry.js';
import type { PlacementValue, LinearConstraint } from '../../contract/records/problem.js';
import type { SupplementalMeasurements, PlacementContext } from '../../contract/types.js';
import type { PositionedInput } from '../constraints/compile.js';
import { compile } from '../constraints/compile.js';
import { relative } from '../constraints/relative.js';
import { separateBoxes } from '../constraints/separation.js';
import { previousNode } from './seeds.js';
import { routingPreferences } from './spacing.js';
import { seedScope } from './groups.js';
import { execute, protect, requireValue, reject } from '../validation/outcomes.js';
/** Prior geometry is a soft seed only; changed measured content and current locks always win. */
function input(
  node: VisualNode,
  seeds: readonly PlacementValue[],
  previous: SectionCandidate | null,
  section: VisualSection,
): PositionedInput {
  const seed = seeds.find((item) => item.id === node.id);
  if (!seed) return reject('engine-failed', node.id, 'Missing placement seed');
  const prior = previousNode(node, section, previous);
  return {
    node: {
      id: node.id,
      parent: node.parent,
      minimum: { width: node.width, height: node.height },
      headerHeight: node.headerHeight,
      placement: node.placement,
      container: node.groupId !== null,
    },
    seed: prior?.box ?? seed.box,
    strength: prior === undefined ? 'weak' : 'strong',
  };
}
/** Scope constraints resolve canonical identities through visible measured nodes. Callers retain scene/draft and retry safely; Authoring owns commit recovery. */
export function sectionConstraints(
  section: VisualSection,
  context: PlacementContext,
): Result<readonly LinearConstraint[]> {
  return protect(() => {
    return [
      ...participantConstraints(section, context.options.gap[section.layout.gap]),
      ...relative(
        section.layout,
        section.nodes,
        context.options.gap[section.layout.gap],
        section.id,
      ),
      ...section.groups.flatMap((group) =>
        relative(group.layout, section.nodes, context.options.gap[group.layout.gap], group.id),
      ),
    ];
  });
}
/** Reconstruct placed data exclusively from the authoritative projection, never previous measured payloads. */
function placed(
  node: VisualNode,
  values: readonly PlacementValue[],
): PlacedNode {
  const value = values.find((item) => item.id === node.id);
  if (!value) return reject('engine-failed', node.id, 'Solver omitted a visible node');
  return {
    id: node.id,
    parent: node.parent,
    sectionId: node.sectionId,
    box: value.box,
    measured: node,
  };
}
/** Derive one section's boxes through seeds, hard constraints and bounded nonoverlap search. Callers retain scene/draft and retry safely; Authoring owns commit recovery. */
export async function placeSection(
  section: VisualSection,
  previous: SectionCandidate | null,
  context: PlacementContext,
  measurements: SupplementalMeasurements,
): Promise<Result<readonly PlacedNode[]>> {
  return execute(async () => {
    const seeds = await seedScope(null, section, context, measurements);
    const items = section.nodes.map((node) => input(node, seeds, previous, section));
    const problem = compile(items, context.options);
    const values = await separateBoxes(
      {
        ...problem,
        constraints: [
          ...problem.constraints,
          ...requireValue(sectionConstraints(section, context)),
          ...routingPreferences(section, measurements, context.options),
        ],
      },
      items,
      { ...context.dependencies, job: context.job, gap: context.options.gap[section.layout.gap] },
      context.options.maxBranches,
    );
    return section.nodes.map((node) => placed(node, values));
  });
}
