import { protect, reject } from '../core/validation/outcomes.js';
import { toEngineScene, fixedSource } from '../core/scene-in.js';
import { inspectSections, inspectSection } from '../core/validation/sections.js';
import { same } from '../core/validation/facts.js';
import { toAppSection, placeAppSections } from '../core/scene-out.js';
import { sectionKey } from '../core/arrangement/keys.js';
import { union } from '../core/geometry/bounds.js';
import { nativeEngineVersions, nestedEngineVersions } from './records/engines.js';
import type { PrototypeLayoutMeasure } from './records/road-prototype.js';
import type { ProjectionReader } from './ports/projection.js';
import type { Result } from './errors.js';
import type { RoutingProblem } from './records/problem.js';
import type { Layout } from './types.js';
import type { JobHost } from '../adapters/scheduling.js';
import { createLayout } from './api.js';
import { failure } from './errors.js';
export interface LayoutOwners {
  readonly measure?: PrototypeLayoutMeasure;
  readonly projection: ProjectionReader;
  readonly jobs: JobHost;
  readonly wasmResource: string;
}
/** Compose pinned open-source adapters; the host owns worker cancellation and the replaceable Wasm resource. */
export async function composeLayout(owners: LayoutOwners): Promise<Result<Layout>> {
  try {
    const [elk, kiwi, avoid, wasm, scheduling] = await providerModules();
    const measure = owners.measure ?? ((_stage, run) => run());
    const placement = elk.createPlacement(),
      solver = kiwi.createSolver();
    let routing: ReturnType<typeof avoid.createRouting> | undefined;
    const nativeRouting = {
      version: nativeEngineVersions.routing,
      route: async (problem: RoutingProblem) => {
        const loaded = await (routing ??= avoid.createRouting(
          wasm.wasmLoader(owners.wasmResource),
        ));
        if (!loaded.ok) return loaded;
        return measure('native-routing', () => loaded.value.route(problem));
      },
    };
    return {
      ok: true,
      value: createLayout({
        projection: owners.projection,
        jobs: scheduling.createJobControl(owners.jobs),
        placement: {
          version: placement.version,
          place: (problem) => measure('native-placement', () => placement.place(problem)),
        },
        solver: {
          version: solver.version,
          solve: (problem) => measure('native-solver', () => solver.solve(problem)),
        },
        routing: nativeRouting,
        nested: {
          version: nestedEngineVersions[0]!,
          section: (source, metrics, options, versions, fixedNodes) =>
            toAppSection(
              toEngineScene(source, metrics, owners.measure, fixedNodes),
              source,
              metrics,
              options,
              versions,
            ),
        },
      }),
    };
  } catch {
    return failure('engine-failed', 'composition', 'Layout dependencies could not be composed');
  }
}

/** Portable custom routing for a pending human move; measured sizes and fixed boxes remain caller-owned. */
export function routeModuleSection(
  source: import('./records/input.js').VisualSection,
  metrics: import('./types.js').SupplementalMeasurements,
  options: import('./types.js').LayoutOptions,
  fixedNodes: readonly import('./records/geometry.js').PlacedNode[],
  frame: Pick<import('./records/geometry.js').PlacedSection, 'origin' | 'box'>,
): Result<import('./records/geometry.js').PlacedSection> {
  return protect(() => {
    if (source.mode !== 'modules')
      return reject('invalid-input', source.id, 'Custom preview requires a module section');
    const draft = fixedSource(source, fixedNodes);
    const candidate = toAppSection(
      toEngineScene(draft, metrics),
      draft,
      metrics,
      options,
      nestedEngineVersions,
    );
    same(
      candidate.nodes.map((node) => node.box),
      fixedNodes.map((node) => node.box),
      source.id,
    );
    return inspectSection(
      draft,
      { ...candidate, origin: frame.origin, box: frame.box },
      {
        options,
        measurements: metrics,
        engines: nestedEngineVersions,
      },
    );
  });
}

/** Provider code is shared by startup preparation and real composition; no engine runs during import. */
function providerModules() {
  return Promise.all([
    import('../adapters/elk.js'),
    import('../adapters/kiwi.js'),
    import('../adapters/libavoid.js'),
    import('../adapters/wasm-loader.js'),
    import('../adapters/scheduling.js'),
  ]);
}
/** Prepare the worker's code before it advertises readiness, without inputs, fonts or derived geometry. */
export async function prepareLayoutRuntime(): Promise<Result<void>> {
  try {
    await providerModules();
    return { ok: true, value: undefined };
  } catch {
    return failure('engine-failed', 'composition', 'Layout dependencies could not be loaded');
  }
}

/** Owner-remeasured module previews repack the whole collection and pass the save-path inspector. */
export function previewModuleCollection(
  projection: import('./records/input.js').Projection,
  metrics: import('./types.js').SupplementalMeasurements,
  options: import('./types.js').LayoutOptions,
  previous: import('./records/geometry.js').Scene,
): Result<Pick<import('./records/geometry.js').Scene, 'sections' | 'bounds'>> {
  return protect(() => {
    const local = projection.sections
      .toSorted((a, b) => a.order - b.order)
      .map((source) => {
        const prior = previewSection(previous, source.id);
        const inputKey = sectionKey(source, metrics, options, previous.engineVersions);
        if (source.mode === 'modules' && inputKey !== prior.inputKey)
          return toAppSection(
            toEngineScene(source, metrics),
            source,
            metrics,
            options,
            previous.engineVersions,
          );
        return {
          ...prior,
          inputKey,
          origin: { x: 0, y: 0 },
          box: { ...prior.box, x: prior.box.x - prior.origin.x, y: prior.box.y - prior.origin.y },
        };
      });
    const sections = placeAppSections(local, projection, options);
    const bounds = union(sections.map((section) => section.box));
    return {
      bounds,
      sections: inspectSections(
        projection,
        { ...previous, sections, bounds },
        { options, measurements: metrics, engines: previous.engineVersions },
      ),
    };
  });
}

/** Required section identity is checked before retaining any unchanged local geometry. */
function previewSection(
  scene: import('./records/geometry.js').Scene,
  id: string,
) {
  const section = scene.sections.find((section) => section.id === id);
  if (section === undefined) return reject('invalid-input', id, 'Preview section is missing');
  return section;
}
