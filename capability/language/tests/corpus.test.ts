import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assert, expect, it } from 'vitest';
import { assetId, type Collection } from '@novakai/canvas-model';
import index from '../../../resources/examples/showcase/manifest.json' with { type: 'json' };
import type { ResolvedResources, ResourceRequest } from '../contract/index.js';
import { language, value, theme, pins, edit } from './fixtures.js';

const root = new URL('../../../resources/examples/showcase/', import.meta.url);
/** This case proves source semantics only. Browser/native export evidence owns visual quality and durability. */
it('roundtrips all original corpus sources and retains only the requested semantic edit', async () => {
  expect(index.examples).toHaveLength(24);
  expect(new Set(index.examples.map((item) => item.collectionId)).size).toBe(24);
  const families = [
    'ER',
    'Modules',
    'Flow/SOP',
    'Sequence',
    'State',
    'Tree/mindmap',
    'Story/infographic',
    'Grid/comparison',
  ];
  expect([...new Set(index.examples.map((item) => item.family))].toSorted()).toEqual(
    families.toSorted(),
  );
  families.forEach((family) =>
    expect(
      index.examples.filter((item) => item.family === family).map((item) => item.batch),
    ).toEqual([1, 2, 3]),
  );
  for (const entry of index.examples) {
    expect(entry.source).toMatch(/^[a-z-]+\.canvas$/u);
    const source = await readFile(new URL(entry.source, root), 'utf8');
    expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(300);
    const parsed = value(language.parse(source));
    const resources = await resolved(parsed.resources);
    const original = value(
      language.lower({ source, mode: 'create', snapshot: null, resources }),
    ).collection;
    expect(original.id).toBe(entry.collectionId);
    const readout = value(language.print({ collection: original, scope: { kind: 'all' } }));
    expect(readout.source).not.toMatch(/\b(?:x|y|width|height)=/u);
    const copy = value(
      language.lower({
        source: readout.source,
        mode: 'replace',
        snapshot: original,
        resources: pins(original),
      }),
    ).collection;
    expect(scopeOrdered(copy)).toEqual(scopeOrdered(original));
    const first = original.objects[0];
    assert(first);
    const label = `${first.label} / revised explanation`;
    const edited = edit(original, `set node @${first.id} label=${JSON.stringify(label)}`);
    expect(edited).toEqual({
      ...original,
      objects: original.objects.map((item) => (item.id === first.id ? { ...item, label } : item)),
    });
    const revised = value(language.print({ collection: edited, scope: { kind: 'all' } }));
    const reread = value(
      language.lower({
        source: revised.source,
        mode: 'replace',
        snapshot: edited,
        resources: pins(edited),
      }),
    ).collection;
    expect(scopeOrdered(reread)).toEqual(scopeOrdered(edited));
  }
});

async function resolved(requests: readonly ResourceRequest[]): Promise<ResolvedResources> {
  const themes = requests
    .filter((item) => item.kind === 'theme')
    .map((item) => [item.alias, { ...theme, id: item.alias }] as const);
  const assets = await Promise.all(requests.filter((item) => item.kind !== 'theme').map(asset));
  return { themes: Object.fromEntries(themes), assets: Object.fromEntries(assets) };
}

async function asset(
  request: ResourceRequest,
): Promise<readonly [string, ResolvedResources['assets'][string]]> {
  assert(request.kind === 'image' || request.kind === 'icon');
  assert(request.alt);
  const bytes = await readFile(new URL(request.source, root));
  return [
    request.alias,
    {
      id: assetId.parse(request.alias),
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      mediaType: 'image/svg+xml',
      alt: request.alt,
    },
  ];
}

/** Interleaving separate scopes is not semantic. Stable sorting retains every appearance/group order within its owner. */
function scopeOrdered(collection: Collection): Collection {
  return {
    ...collection,
    sections: collection.sections.map((section) => ({
      ...section,
      appearances: section.appearances.toSorted((left, right) =>
        (left.group ?? '').localeCompare(right.group ?? ''),
      ),
      groups: section.groups.toSorted((left, right) =>
        (left.parent ?? '').localeCompare(right.parent ?? ''),
      ),
    })),
  };
}
