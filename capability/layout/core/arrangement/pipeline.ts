import { placeAppSections } from '../scene-out.js';
import type { VisualSection } from '../../contract/records/input.js';
import type { SectionCandidate } from '../../contract/records/candidate.js';
import type { GeometryDependencies, Inspection } from '../../contract/types.js';
import type { Scene, PlacedSection } from '../../contract/records/geometry.js';
import type { SceneCandidate } from '../../contract/records/candidate.js';
import { candidate } from '../../contract/records/candidate.js';
import type {
  CheckedLayoutRequest,
  CheckedInspectionRequest,
  CheckedRouteRequest,
} from '../validation/input.js';
import { arrangeSection, completeSection } from './section.js';
import { accumulate } from './sequential.js';
import { arrangeSections } from './collection.js';
import { requestKey, versions } from './keys.js';
import { adjustments, warnings } from './notices.js';
import { union } from '../geometry/bounds.js';
import { inspectSections } from '../validation/sections.js';
import { inspectNodes } from '../validation/nodes.js';
import { same, sameIds } from '../validation/facts.js';
import { parse, protect, reject, requireValue } from '../validation/outcomes.js';
/** A different collection or future revision is not an admissible geometry preference. */
function previous(request: CheckedLayoutRequest): SceneCandidate | null {
  if (request.previous?.collectionId !== request.projection.collectionId) return null;
  if (request.previous.revision > request.projection.revision) return null;
  return request.previous;
}
/** All final success paths pass through the same independent inspector, including cache and route-only operations. */
function inspected(
  scene: Scene,
  request: Pick<CheckedLayoutRequest, 'projection' | 'measurements' | 'options'>,
  dependencies: GeometryDependencies,
): Scene {
  const checked = parse(candidate, scene);
  const sections = inspectSections(request.projection, checked, {
    measurements: request.measurements,
    options: request.options,
    engines: versions(dependencies),
  });
  same(warnings(sections, request.projection, request.options), scene.warnings, 'warnings');
  return { ...scene, sections };
}
/** Derive one complete scene and reject stale work before it can be returned to Authoring. */
export async function arrange(
  request: CheckedLayoutRequest,
  dependencies: GeometryDependencies,
): Promise<Scene> {
  same(requestKey(request, dependencies), request.job.inputKey, 'job.inputKey');
  const prior = previous(request);
  const context = { dependencies, options: request.options, job: request.job };
  const local = await accumulate<VisualSection, readonly PlacedSection[]>(
    request.projection.sections.toSorted((a, b) => a.order - b.order),
    [],
    async (result, source) => {
      requireValue(await dependencies.jobs.checkpoint(request.job));
      const custom = moduleEngine(source, dependencies);
      if (custom !== undefined)
        return [
          ...result,
          custom.section(source, request.measurements, request.options, versions(dependencies)),
        ];
      const section = await arrangeSection(
        source,
        prior?.sections.find((section) => section.id === source.id) ?? null,
        request.measurements,
        context,
      );
      return [...result, section];
    },
  );
  const sections = request.projection.sections.some((s) => s.mode === 'modules')
    ? placeAppSections(local, request.projection, request.options)
    : requireValue(await arrangeSections(local, request.projection, prior, context));
  const scene: Scene = {
    collectionId: request.projection.collectionId,
    revision: request.projection.revision,
    inputKey: request.job.inputKey,
    engineVersions: versions(dependencies),
    sections,
    bounds: union(sections.map((section) => section.box)),
    warnings: warnings(sections, request.projection, request.options),
    adjustments: adjustments(sections, request.projection, prior),
  };
  const result = inspected(scene, request, dependencies);
  requireValue(await dependencies.jobs.checkpoint(request.job));
  return result;
}
/** Public inspection returns a typed invalid verdict while malformed envelopes remain boundary failures. */
export function inspect(
  request: CheckedInspectionRequest,
  dependencies: GeometryDependencies,
): Inspection {
  const result = protect(() =>
    inspectSections(request.projection, request.candidate, {
      measurements: request.measurements,
      options: request.options,
      engines: versions(dependencies),
    }),
  );
  if (!result.ok) return { valid: false, diagnostics: [result.error] };
  const crossingCheck = protect(() =>
    same(
      warnings(result.value, request.projection, request.options),
      request.candidate.warnings,
      'warnings',
    ),
  );
  if (!crossingCheck.ok) return { valid: false, diagnostics: [crossingCheck.error] };
  return { valid: true, diagnostics: [] };
}
/** Route-only uses fixed node boxes and section origins; expanded route bounds may fail existing inter-section clearance. */
export async function reroute(
  request: CheckedRouteRequest,
  dependencies: GeometryDependencies,
): Promise<Scene> {
  same(
    requestKey({ ...request, previous: request.fixed }, dependencies),
    request.job.inputKey,
    'job.inputKey',
  );
  same(request.projection.collectionId, request.fixed.collectionId, 'collection');
  sameIds(
    request.projection.sections.map((item) => item.id),
    request.fixed.sections.map((item) => item.id),
    'sections',
  );
  const sections = await accumulate<VisualSection, readonly PlacedSection[]>(
    request.projection.sections.toSorted((a, b) => a.order - b.order),
    [],
    async (result, source) => {
      const fixed = fixedSection(source, request);
      const nodes = inspectNodes(source, fixed.nodes, request.options);
      const custom = moduleEngine(source, dependencies);
      const local =
        custom === undefined
          ? await completeSection(source, nodes, request.measurements, {
              dependencies,
              options: request.options,
              job: request.job,
            })
          : custom.section(
              source,
              request.measurements,
              request.options,
              versions(dependencies),
              nodes,
            );
      const section = {
        ...local,
        origin: fixed.origin,
        box: { ...local.box, x: local.box.x + fixed.origin.x, y: local.box.y + fixed.origin.y },
      };
      return [...result, section];
    },
  );
  const scene: Scene = {
    collectionId: request.projection.collectionId,
    revision: request.projection.revision,
    inputKey: request.job.inputKey,
    engineVersions: versions(dependencies),
    sections,
    bounds: union(sections.map((item) => item.box)),
    warnings: warnings(sections, request.projection, request.options),
    adjustments: adjustments(sections, request.projection, request.fixed),
  };
  const result = inspected(scene, request, dependencies);
  requireValue(await dependencies.jobs.checkpoint(request.job));
  return result;
}

/** Route-only requires an existing section before any native work is requested. */
function fixedSection(
  source: VisualSection,
  request: CheckedRouteRequest,
): SectionCandidate {
  const fixed = request.fixed.sections.find((item) => item.id === source.id);
  if (!fixed) return reject('invalid-input', source.id, 'Fixed section is missing');
  return fixed;
}

/** Module routing has one implementation; missing composition is an error, never native fallback. */
function moduleEngine(
  source: VisualSection,
  dependencies: GeometryDependencies,
) {
  if (source.mode !== 'modules') return undefined;
  if (dependencies.nested === undefined)
    return reject('invalid-input', source.id, 'Module sections require the custom roads engine');
  return dependencies.nested;
}
