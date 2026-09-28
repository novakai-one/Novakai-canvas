/** Native collection round trips expose numeric drift; Vitest reports assertions and the builder owns correction. */
import { assert, expect, it } from 'vitest';
import type { Scene } from '../contract/index.js';
import { flow, harness, request, value } from './fixtures.js';

/** Change only the collection-space origin, preserving all authoritative local content and bounds. */
function shiftedOrigin(
  scene: Scene,
  offset: number,
): Scene {
  const first = scene.sections[0];
  assert(first);
  return {
    ...scene,
    sections: [
      { ...first, origin: { ...first.origin, y: first.origin.y + offset } },
      ...scene.sections.slice(1),
    ],
  };
}

it('accepts section-origin roundoff while rejecting material drift and changed identity', async (): Promise<void> => {
  const source = flow();
  const layout = await harness([source]);
  const input = request(layout, source);
  const scene = value(await layout.arrange(input));
  const inspection = {
    projection: source,
    measurements: input.measurements,
    options: input.options,
  };
  expect(value(layout.inspect({ ...inspection, candidate: scene })).valid).toBe(true);
  expect(value(layout.inspect({ ...inspection, candidate: shiftedOrigin(scene, 1e-10) }))).toEqual({
    valid: true,
    diagnostics: [],
  });
  const displaced = value(layout.inspect({ ...inspection, candidate: shiftedOrigin(scene, 0.01) }));
  expect(displaced.valid).toBe(false);
  expect(displaced.diagnostics[0]?.path).toBe(scene.sections[0]?.id);
  const first = scene.sections[0];
  assert(first);
  const renamed = {
    ...scene,
    sections: [{ ...first, id: 'different-section' }, ...scene.sections.slice(1)],
  };
  const semanticChange = value(layout.inspect({ ...inspection, candidate: renamed }));
  expect(semanticChange.valid).toBe(false);
  expect(semanticChange.diagnostics[0]?.code).toBe('invalid-input');
});
