import type { Result } from '../../contract/errors.js';
/** Collection arrangement runs under Layout execute; callers retain the previous scene on failure and Authoring owns commit recovery. */
import type { Placement } from '../../contract/records/input.js';
import type { Box } from '../../contract/records/geometry.js';
import type { Projection } from '../../contract/records/input.js';
import type { PlacedSection } from '../../contract/records/geometry.js';
import type { SceneCandidate } from '../../contract/records/candidate.js';
import type { PositionedInput } from '../constraints/compile.js';
import type { PlacementContext } from '../../contract/types.js';
import type { PlacementValue } from '../../contract/records/problem.js';
import { placeScope } from '../placement/policy.js';
import { compile } from '../constraints/compile.js';
import { relativeSections } from '../constraints/relative.js';
import { separateBoxes } from '../constraints/separation.js';
import { execute, requireValue, reject } from '../validation/outcomes.js';
/** Section locks address origins; translate them to visible-box positions for the shared solver. */
function item(
  section: PlacedSection,
  seeds: readonly PlacementValue[],
  projection: Projection,
  previous: SceneCandidate | null,
): PositionedInput {
  const source = projection.sections.find((item) => item.id === section.id);
  const seed = seeds.find((item) => item.id === section.id);
  if (!source || !seed)
    return reject('engine-failed', section.id, 'Missing section placement source');
  const placement = source.placement;
  const prior = previous?.sections.find((item) => item.id === section.id);
  const initial = previousBox(section, prior, seed);
  return {
    node: {
      id: section.id,
      parent: null,
      minimum: { width: section.box.width, height: section.box.height },
      headerHeight: 0,
      container: false,
      placement: translatedPlacement(placement, section.box),
    },
    seed: initial.box,
    strength: prior === undefined ? 'weak' : 'strong',
  };
}
/** Authored section placement addresses the stable origin, not its potentially negative visible bounds. */
function translatedPlacement(
  placement: Placement | null,
  box: Box,
): Placement | null {
  if (placement === null) return null;
  return { ...placement, x: placement.x + box.x, y: placement.y + box.y };
}
/** A changed local bounding box keeps the previous section origin as the soft reference. */
function previousBox(
  section: PlacedSection,
  prior: SceneCandidate['sections'][number] | undefined,
  seed: PlacementValue,
): PlacementValue {
  if (!prior) return seed;
  return {
    id: section.id,
    box: { ...section.box, x: prior.origin.x + section.box.x, y: prior.origin.y + section.box.y },
  };
}
/** Convert solved collection-space bounds back to a section origin without rewriting any local geometry. */
function placed(
  section: PlacedSection,
  values: readonly PlacementValue[],
): PlacedSection {
  const value = values.find((item) => item.id === section.id);
  if (!value) return reject('engine-failed', section.id, 'Solver omitted section bounds');
  return {
    ...section,
    origin: { x: value.box.x - section.box.x, y: value.box.y - section.box.y },
    box: value.box,
  };
}
/** Collection arrangement uses the same hard constraints and bounded nonoverlap policy as node scopes. Callers retain scene/draft and retry safely; Authoring owns commit recovery. */
export async function arrangeSections(
  sections: readonly PlacedSection[],
  projection: Projection,
  previous: SceneCandidate | null,
  context: PlacementContext,
): Promise<Result<readonly PlacedSection[]>> {
  return execute(async () => {
    const nodes = sections.map((section) => ({
      id: section.id,
      parent: null,
      width: section.box.width,
      height: section.box.height,
      header: 0,
    }));
    const seeds = requireValue(
      await placeScope(
        {
          nodes,
          edges: [],
          layout: projection.arrangement,
          minimumCrossSpacing: 0,
          minimumLayerSpacing: 0,
        },
        context,
      ),
    );
    const history = projection.arrangement.columns === undefined ? previous : null;
    const items = sections.map((section) => item(section, seeds, projection, history));
    const problem = compile(items, context.options);
    const gap = context.options.gap[projection.arrangement.gap];
    const values = await separateBoxes(
      {
        ...problem,
        constraints: [
          ...problem.constraints,
          ...relativeSections(
            projection.arrangement,
            sections.map((item) => item.id),
            gap,
          ),
        ],
      },
      items,
      { ...context.dependencies, job: context.job, gap },
      context.options.maxBranches,
    );
    return sections.map((section) => placed(section, values));
  });
}
