import { assert, expect } from 'vitest';
import { validate, plan, stage, assetId, type Collection } from '@novakai/canvas-model';
import {
  createLanguage,
  type Result,
  type ResolvedResources,
  type DiagnosticCode,
} from '../contract/index.js';
export const language = createLanguage({
  reader: { validate },
  planner: { plan },
  stage: { stage },
});
export const digest = `sha256:${'a'.repeat(64)}`;
export const theme = {
  id: 'paper',
  version: '1.0.0',
  digest,
  roles: ['neutral', 'primary', 'supporting', 'decision', 'success', 'warning'],
};
export const image = {
  id: assetId.parse('wireframe'),
  digest,
  mediaType: 'image/svg+xml',
  alt: 'A wireframe with a navigation bar, content cards and a primary action',
};
export const resources: ResolvedResources = {
  themes: { paper: theme, ink: { ...theme, id: 'ink' } },
  assets: { wireframe: image },
};
/** Assertions unwrap only public success results; unexpected diagnostics fail the current test. */
export function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
/** Domain fixtures are checked through Model's public boundary before any Language operation. */
export function checked(input: unknown): Collection {
  const result = validate(input);
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
/** Rejection assertions require absence of candidate and the intended diagnostic family. */
export function rejected(
  result: Result<unknown>,
  code: DiagnosticCode,
): void {
  assert(!result.ok, 'Expected a typed rejection');
  expect(result).not.toHaveProperty('value');
  expect(result.error.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}
/** Creation uses real owner validation and planning, without filesystem or resource providers. */
export function create(source: string): Collection {
  return value(language.lower({ source, mode: 'create', snapshot: null, resources })).collection;
}
/** Patches resolve exact resource metadata from their current immutable collection. */
export function pins(collection: Collection): ResolvedResources {
  return {
    themes: { [collection.theme.id]: collection.theme, paper: theme },
    assets: Object.fromEntries(collection.assets.map((asset) => [asset.id, asset])),
  };
}
/** Apply only pure compiled intent in this fixture; no storage commit is asserted by Language tests. */
export function edit(
  collection: Collection,
  statements: string,
): Collection {
  return value(
    language.lower({
      source: `patch 1 @${collection.id} { ${statements} }`,
      mode: 'patch',
      snapshot: collection,
      resources: pins(collection),
    }),
  ).collection;
}
/** Use a minimal independent canonical fixture for edit behavior, avoiding parser-generated expected data. */
export function graph(extra: Readonly<Record<string, unknown>> = {}): Collection {
  return checked({
    schemaVersion: 1,
    id: 'demo',
    revision: 7,
    title: 'Demo',
    theme,
    arrangement: { algorithm: 'grid' },
    objects: [
      {
        id: 'a',
        kind: 'step',
        label: 'A',
        content: [{ id: 'detail', kind: 'text', text: 'Original' }],
      },
      { id: 'b', kind: 'end', label: 'B' },
    ],
    relationships: [
      {
        id: 'ab',
        kind: 'flow',
        label: 'Continue',
        source: { object: 'a' },
        target: { object: 'b' },
      },
    ],
    sections: [
      {
        id: 'flow',
        title: 'Flow',
        mode: 'flow',
        layout: { algorithm: 'flow' },
        appearances: [{ object: 'a', placement: { x: 31, y: 42, locked: true } }, { object: 'b' }],
        wires: [
          {
            relationship: 'ab',
            manual: [
              { x: 2, y: 3 },
              { x: 4, y: 5 },
            ],
            locked: true,
          },
        ],
      },
    ],
    ...extra,
  });
}
/** Find a declared record by ID without assertions against private compiler representation. */
export function object(
  collection: Collection,
  id: string,
): Collection['objects'][number] {
  const item = collection.objects.find((node) => node.id === id);
  assert(item);
  return item;
}
/** View lookup keeps fixture failure messages local to the scenario. */
export function section(
  collection: Collection,
  id = 'flow',
): Collection['sections'][number] {
  const item = collection.sections.find((view) => view.id === id);
  assert(item);
  return item;
}
