import { inspectDerivation } from './derivation.js';
import type { Scene } from '../../contract/records/geometry.js';
import type { CheckedInspectionRequest } from './input.js';
import { inspectSections } from './sections.js';
import { same } from './facts.js';
import { warnings } from '../arrangement/notices.js';
/** Reconstruct transported geometry from checked measured content; never return unknown payloads retained by the wire schema. */
export function admitScene(
  request: CheckedInspectionRequest,
  engines: readonly string[],
): Scene {
  inspectDerivation(request, engines);
  const sections = inspectSections(request.projection, request.candidate, {
    measurements: request.measurements,
    options: request.options,
    engines,
  });
  same(
    warnings(sections, request.projection, request.options),
    request.candidate.warnings,
    'warnings',
  );
  return { ...request.candidate, sections };
}
