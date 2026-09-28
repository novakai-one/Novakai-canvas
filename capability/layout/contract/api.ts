import { nestedEngineVersions } from './records/engines.js';
import type { LayoutInputKey } from './brands.js';
import type { SceneReaderOwners } from './types.js';
import { admitScene } from '../core/validation/admission.js';
import type { Dependencies, Layout, Inspection } from './types.js';
import type { Result } from './errors.js';
import type { Scene } from './records/geometry.js';
import { readArrangement, readInspection, readRoute, readKey } from '../core/validation/input.js';
import { execute, protect, reject } from '../core/validation/outcomes.js';
import { requestKey, forProjection, versions } from '../core/arrangement/keys.js';
import { arrange, inspect, reroute } from '../core/arrangement/pipeline.js';
/** Bind required owner/native roles once; every public operation snapshots inputs and returns a typed outcome. */
export function createLayout(dependencies: Dependencies): Layout {
  /** Compute the full key before the host registers its current job; route-only uses fixed as previous here. */
  function key(input: unknown): Result<LayoutInputKey> {
    return protect(() => {
      const request = readKey(input, dependencies.projection);
      return requestKey(request, forProjection(dependencies, request.projection));
    });
  }
  /** Derive all geometry atomically; Authoring retains the prior committed scene on rejection. */
  function arrangeScene(input: unknown): Promise<Result<Scene>> {
    return execute(() => {
      const request = readArrangement(input, dependencies.projection);
      return arrange(request, forProjection(dependencies, request.projection));
    });
  }
  /** Recompute wires around fixed boxes without granting permission to reposition nodes or section origins. */
  function route(input: unknown): Promise<Result<Scene>> {
    return execute(() => {
      const request = readRoute(input, dependencies.projection);
      return reroute(request, forProjection(dependencies, request.projection));
    });
  }
  /** Recheck authoritative content and required geometry without invoking any native placement/router. */
  function inspectScene(input: unknown): Result<Inspection> {
    return protect(() => {
      const request = readInspection(input, dependencies.projection);
      return inspect(request, {
        ...dependencies,
        engineVersions: admittedVersions(request.candidate.engineVersions, versions(dependencies)),
      });
    });
  }
  return Object.freeze({ key, arrange: arrangeScene, route, inspect: inspectScene });
}

export { toCollection, toSection, toParent } from '../core/geometry/coordinates.js';
/** Where each hidden wire label would sit if shown. Shared by the canvas labels toggle and exports. */
export { hiddenLabelBoxes } from '../core/routing/hidden-labels.js';

/** Independently validate and reconstruct a worker/HTTP scene; Canvas retains its accepted scene when rejected. */
export function readScene(
  input: unknown,
  owners: SceneReaderOwners,
): Result<Scene> {
  return protect(() => {
    const request = readInspection(input, owners.projection);
    return admitScene(
      request,
      admittedVersions(request.candidate.engineVersions, owners.engineVersions),
    );
  });
}

/** Admit only registered producer identities, including mixed-mode collections. */
function admittedVersions(
  actual: readonly string[],
  expected: readonly string[],
): readonly string[] {
  const accepted = [expected, nestedEngineVersions, [...nestedEngineVersions, ...expected]];
  if (!accepted.some((value) => JSON.stringify(value) === JSON.stringify(actual)))
    return reject('invalid-input', 'engines', 'Unknown layout engine versions');
  return actual;
}
