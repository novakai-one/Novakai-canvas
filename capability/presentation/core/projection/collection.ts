import type { Dependencies } from '../../contract/types.js';
import type { Projection, VisualSection } from '../../contract/records/visual.js';
import type { ContentContext } from '../../contract/records/content-context.js';
import type { InputCollection } from '../../contract/records/input.js';
import { resolvedStyle } from '../../contract/records/style.js';
import { clone, parse, requireValue, reject } from '../validation/outcomes.js';
import { projectSection } from './section.js';
import { measureBlock } from '../content/blocks.js';
import { requireProjectionCapacity } from '../validation/capacity.js';
/** Projection consumes renderer identity only; rendering operations remain at their own public boundary. */
interface ProjectionDependencies extends Pick<
  Dependencies,
  'domain' | 'themes' | 'assets' | 'measurement' | 'chromePolicies'
> {
  readonly rendererVersion: string;
}
/** Stable key canonicalizes object property order while retaining significant array order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  return canonicalRecord(value);
}
/** Only plain detached domain/style records reach identity serialization. */
function canonicalRecord(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]): number => a.localeCompare(b))
      .map(([key, item]): readonly [string, unknown] => [key, canonical(item)]),
  );
}
/** Build a deterministic immutable proposal; createPresentation.project protects structured/provider failures.
 * Callers correct input/resources and retry; Authoring retains the prior committed state. */
export function projectCollection(
  input: unknown,
  deps: ProjectionDependencies,
): Projection {
  const collection = requireValue(deps.domain.read(clone(input)));
  const style = parse(resolvedStyle, requireValue(deps.themes.resolve(collection.theme)));
  if (`sha256:${style.digest}` !== collection.theme.digest)
    return reject(
      'missing-resource',
      'theme',
      'Resolved theme digest does not match the pinned theme',
    );
  const context: ContentContext = {
    collection,
    chromePolicies: deps.chromePolicies,
    style,
    width: style.contentSizing.widths.medium.preferred,
    metrics: deps.measurement,
    assets: deps.assets,
    ...projectionResolvers(collection, deps.domain),
  };
  const sections = collection.sections.map((section): VisualSection =>
    projectSection(section, context),
  );
  requireValue(requireProjectionCapacity(sections));
  checkScene(sections);
  const outline = collection.objects.flatMap((object): readonly string[] => [
    object.label,
    ...object.content.flatMap(
      (block): readonly string[] => measureBlock(block, { ...context, owner: object }).outline,
    ),
  ]);
  return {
    collectionId: collection.id,
    revision: collection.revision,
    title: collection.title,
    styleDigest: style.digest,
    inputKey: JSON.stringify(
      canonical({
        collection,
        style,
        // Derived geometry changes invalidate retained scenes even when domain and fonts do not.
        notation: 'presentation-notation-10',
        measurement: deps.measurement.version,
        renderer: deps.rendererVersion,
      }),
    ),
    arrangement: collection.arrangement,
    sections,
    outline,
    assetDigests: collection.assets.map((asset): string => asset.digest.slice(7)),
    fontDigests: [
      ...new Set([style.bodyFont.digest, style.monoFont.digest, style.strongFont.digest]),
    ],
  };
}

function projectionResolvers(
  collection: InputCollection,
  domain: ProjectionDependencies['domain'],
): Pick<ContentContext, 'resolveFieldType' | 'resolveTypeUse'> {
  return {
    ...fieldResolver(collection, domain.resolveFieldType),
    ...typeResolver(collection, domain.resolveTypeUse),
  };
}

function fieldResolver(
  collection: InputCollection,
  resolver: ProjectionDependencies['domain']['resolveFieldType'],
): Pick<ContentContext, 'resolveFieldType'> {
  return resolver === undefined ? {} : { resolveFieldType: (field) => resolver(collection, field) };
}

function typeResolver(
  collection: InputCollection,
  resolver: ProjectionDependencies['domain']['resolveTypeUse'],
): Pick<ContentContext, 'resolveTypeUse'> {
  return resolver === undefined ? {} : { resolveTypeUse: (type) => resolver(collection, type) };
}

/** Total scene budget includes wire/sequence labels and headings, not only each node's private limit. */
function checkScene(sections: readonly VisualSection[]): void {
  const total = sections.reduce(
    (sum, section): number =>
      sum +
      section.title.primitives.length +
      section.nodes.reduce((count, node): number => count + node.content.primitives.length, 0) +
      section.wires.reduce((count, wire): number => count + wire.label.primitives.length, 0) +
      section.sequence.reduce((count, item): number => count + item.label.primitives.length, 0),
    0,
  );
  if (total > 100000) reject('limit', 'scene', 'Scene exceeds 100000 primitives');
}
