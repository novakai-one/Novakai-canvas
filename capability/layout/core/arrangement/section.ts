/** Section derivation runs under Layout execute; rejected cache hints are recomputed and callers retain the previous scene on failure. */
import type { VisualSection } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { PlacedSection, PlacedNode } from '../../contract/records/geometry.js';
import type { SupplementalMeasurements } from '../../contract/types.js';
import type { DerivationContext } from '../../contract/types.js';
import { hasColumns } from '../placement/seeds.js';
import { placeSection } from '../placement/section.js';
import { routeWires } from '../routing/wires.js';
import { sequenceGeometry } from '../sequence/sequence.js';
import { contentBounds, titleBox, sectionBounds } from './bounds.js';
import { sectionKey, versions } from './keys.js';
import { inspectSection } from '../validation/sections.js';
import { execute, requireValue, protect } from '../validation/outcomes.js';
import { LayoutFault } from '../../contract/errors.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { LayoutInputKey } from '../../contract/brands.js';
import { treeGeometry } from '../tree.js';
/** Cache geometry is accepted only after full current-source inspection; a bad hint falls back to derivation. */
function cached(
  source: VisualSection,
  previous: SectionCandidate | null,
  metrics: SupplementalMeasurements,
  context: DerivationContext,
): PlacedSection | null {
  if (previous === null || hasColumns(source)) return null;
  const result = protect(() =>
    inspectSection(source, previous, {
      options: context.options,
      measurements: metrics,
      engines: versions(context.dependencies),
    }),
  );
  if (!result.ok) return null;
  const section = result.value;
  return {
    ...section,
    origin: { x: 0, y: 0 },
    box: {
      ...section.box,
      x: section.box.x - section.origin.x,
      y: section.box.y - section.origin.y,
    },
  };
}
/** Local reuse is exact; collection arrangement may move the independent section origin afterward. */
export async function arrangeSection(
  source: VisualSection,
  previous: SectionCandidate | null,
  metrics: SupplementalMeasurements,
  context: DerivationContext,
): Promise<PlacedSection> {
  const reuse = cached(source, previous, metrics, context);
  if (reuse !== null) return reuse;
  if (previous !== null) return derived(source, previous, metrics, context);
  // Without a prior scene the result depends only on the section key: reuse recent ones.
  const key = sectionKey(source, metrics, context.options, versions(context.dependencies));
  const recent = recentFor(context.dependencies);
  const hit = recent.get(key);
  if (hit !== undefined) return hit;
  const section = await derived(source, null, metrics, context);
  recent.set(key, section);
  if (recent.size > RECENT) recent.delete(recent.keys().next().value as LayoutInputKey);
  return section;
}
/** Enough for every section of a few open collections. */
const RECENT = 64;
/** Per layout instance: another instance may route differently under the same version. */
const recentByDependencies = new WeakMap<object, Map<LayoutInputKey, PlacedSection>>();
function recentFor(dependencies: object): Map<LayoutInputKey, PlacedSection> {
  const found = recentByDependencies.get(dependencies);
  if (found !== undefined) return found;
  const created = new Map<LayoutInputKey, PlacedSection>();
  recentByDependencies.set(dependencies, created);
  return created;
}
async function derived(
  source: VisualSection,
  previous: SectionCandidate | null,
  metrics: SupplementalMeasurements,
  context: DerivationContext,
): Promise<PlacedSection> {
  const nodes = requireValue(await placeSection(source, previous, context, metrics));
  return completeWithRetry(source, nodes, previous, metrics, context);
}
/** Routing conflict retries once with authored hints dropped; hint-free sections fail identically, so they never retry. */
async function completeWithRetry(
  source: VisualSection,
  nodes: readonly PlacedNode[],
  previous: SectionCandidate | null,
  metrics: SupplementalMeasurements,
  context: DerivationContext,
): Promise<PlacedSection> {
  const completed = await execute(() => completeSection(source, nodes, metrics, context));
  if (completed.ok) return completed.value;
  if (!retryable(completed.error, source)) throw new LayoutFault(completed.error);
  const relaxed = requireValue(
    await placeSection(hintsDropped(source), previous, context, metrics),
  );
  return completeSection(source, relaxed, metrics, context);
}
/** Only a routing conflict with relaxable authored hints justifies a second derivation. */
function retryable(
  error: Diagnostic,
  source: VisualSection,
): boolean {
  return error.code === 'constraint-conflict' && hasHints(source);
}
/** Section or group scopes carry the relaxable hints; participant/geometry constraints are never dropped. */
function hasHints(source: VisualSection): boolean {
  return (
    source.layout.constraints.length > 0 ||
    source.groups.some((group) => group.layout.constraints.length > 0)
  );
}
/** A routed-conflict retry drops authored spatial hints once; satisfied geometry then reports them relaxed. */
function hintsDropped(source: VisualSection): VisualSection {
  return {
    ...source,
    layout: { ...source.layout, constraints: [] },
    groups: source.groups.map((group) => ({
      ...group,
      layout: { ...group.layout, constraints: [] },
    })),
  };
}
/** Build wires, sequence and heading around fixed nodes without assigning collection-space positions. */
export async function completeSection(
  source: VisualSection,
  nodes: readonly PlacedNode[],
  metrics: SupplementalMeasurements,
  context: DerivationContext,
): Promise<PlacedSection> {
  const wires = await routeWires(source, nodes, metrics, context);
  const sequence = sequenceGeometry(source, nodes, metrics, context.options);
  const content = contentBounds(nodes, wires, sequence);
  const title = {
    content: source.title,
    box: titleBox(content, source.title, context.options.padding),
  };
  return {
    id: source.id,
    origin: { x: 0, y: 0 },
    box: sectionBounds(content, title.box, context.options.padding),
    title,
    inputKey: sectionKey(source, metrics, context.options, versions(context.dependencies)),
    nodes,
    wires,
    sequence,
    ...(treeGeometry(source) === undefined ? {} : { tree: treeGeometry(source) }),
  };
}
