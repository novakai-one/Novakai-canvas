import type { Change, Section } from '../../contract/records/owners.js';
import { previewModuleCollection } from '@novakai/canvas-layout';
import { remeasureModuleEnvelopes } from '@novakai/canvas-presentation';
import type { VisualSection } from '@novakai/canvas-presentation';
import type { EditIntent, PlacementIntent, GeometryPreview } from '@novakai/canvas-canvas';
import type { RenderDocument } from '@novakai/canvas-service';
import type { Result } from '../../contract/errors.js';
import { layoutFailure } from '../../contract/foreign-failures.js';

/** Reuse the exact Authoring placement merge; moving retains prior explicit dimensions. */
function placed(
  section: VisualSection,
  source: Section,
): VisualSection {
  return {
    ...section,
    placement: source.placement ?? null,
    groups: source.groups,
    nodes: section.nodes.map((node) => {
      const owner =
        node.groupId === null
          ? source.appearances.find((item) => item.object === node.objectId)
          : source.groups.find((item) => item.id === node.groupId);
      return { ...node, placement: owner?.placement ?? null };
    }),
  };
}

/** Only changed module nodes need portable routing; companion section origins are always repacked. */
export function previewModuleRoutes(
  document: RenderDocument,
  intent: EditIntent,
  changes: readonly Change[],
): Result<GeometryPreview | null> {
  if (intent.kind !== 'placement') return { ok: true, value: null };
  if (!supportedMove(document, intent)) return { ok: true, value: null };
  return previewMove(document, changes);
}

/** Reuse the already successful Authoring plan; no second core call can throw or reinterpret dimensions. */
function plannedSections(changes: readonly Change[]): readonly Section[] {
  return changes.flatMap((change) => {
    if (change.op !== 'replace') return [];
    return change.target === 'sections' ? [change.value] : [];
  });
}
function projected(
  section: VisualSection,
  sources: readonly Section[],
): VisualSection {
  const source = sources.find((source) => source.id === section.id);
  return source === undefined ? section : placed(section, source);
}
function supportedMove(
  document: RenderDocument,
  intent: PlacementIntent,
): boolean {
  const resized = intent.entries.some(
    (entry) => entry.placement.width !== undefined || entry.placement.height !== undefined,
  );
  const modules = document.projection.sections.some((section) => section.mode === 'modules');
  const supported = intent.entries.every(
    ({ target }) =>
      target.kind === 'section' ||
      document.projection.sections.some(
        (section) => section.id === target.section && section.mode === 'modules',
      ),
  );
  return [!resized, modules, supported].every(Boolean);
}
/** Resize needs fresh text measurement; this fast seam is for position-only module moves. */
function previewMove(
  document: RenderDocument,
  changes: readonly Change[],
): Result<GeometryPreview | null> {
  const sources = plannedSections(changes);
  const projection = remeasureModuleEnvelopes(
    {
      ...document.projection,
      sections: document.projection.sections.map((section) => projected(section, sources)),
    },
    document.style,
  );
  const result = previewModuleCollection(
    projection,
    document.measurements,
    document.options,
    document.scene,
  );
  if (!result.ok) return { ok: false, error: layoutFailure(result.error) };
  return {
    ok: true,
    value: {
      bounds: result.value.bounds,
      sections: result.value.sections.map((section) => ({
        id: section.id,
        origin: section.origin,
      })),
      boxes: result.value.sections.flatMap((section) => [
        { target: { kind: 'section' as const, id: section.id }, box: section.box },
        ...section.nodes.map((node) => ({
          target: { kind: 'node' as const, section: section.id, id: node.id },
          box: { ...node.box, x: node.box.x + section.origin.x, y: node.box.y + section.origin.y },
        })),
      ]),
      wires: result.value.sections.flatMap((section) =>
        section.wires.map((wire) => ({
          section: section.id,
          id: wire.id,
          source: wire.source,
          target: wire.target,
          points: wire.points,
          labelBox: wire.labelBox,
        })),
      ),
    },
  };
}
