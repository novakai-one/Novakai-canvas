import type { Collection } from '../../contract/ports/model.js';
import type { ModelReader } from '../../contract/ports/model.js';
import type { PrintRequest, Readout, Scope } from '../../contract/records/requests.js';
import { ownerValue } from '../lowering/diagnostics.js';
import { themePin } from '../lowering/resources.js';
import { origin, reject } from '../validation/outcomes.js';
import { readSource } from '../validation/input.js';
import { body } from './strings.js';
import { header } from './properties.js';
import { layoutAttributes, printConstraints } from './layout.js';
import { printNode } from './content.js';
import { printSection } from './views.js';
import { manualSummary } from './geometry.js';
import { selectScope } from './scope.js';
/** Validate unknown persisted data before printing; unsupported fields never silently disappear. */
export function printCollection(
  request: PrintRequest,
  reader: ModelReader,
): Readout {
  const collection = ownerValue(reader.validate(request.collection), [], origin);
  const selected = selectScope(collection, request.scope);
  const source = readSource(withHeading(printEnvelope(selected, request.scope), request.heading));
  return {
    source,
    collection: collection.id,
    revision: collection.revision,
    scope: structuredClone(request.scope),
    manual: manualSummary(selected),
    pins: { theme: themePin(collection.theme), assets: selected.assets.map((item) => item.digest) },
  };
}
/** A view envelope is structurally non-authorable; revision remains outside full canvas source. */
function printEnvelope(
  collection: Collection,
  scope: Scope,
): string {
  const contents = printDeclarations(collection);
  if (scope.kind !== 'all')
    return body(
      `view 1 @${collection.id} revision=${collection.revision} scope=${scope.kind}:@${scope.id}`,
      contents,
    );
  const title = [
    header('collection', { ...collection, theme: themePin(collection.theme) }),
    ...layoutAttributes(collection.arrangement),
  ].join(' ');
  return `canvas 1\n${body(title, [...contents, ...printConstraints(collection.arrangement)])}`;
}
/** Canonical namespaces are independent, while order inside each namespace remains stable. */
function printDeclarations(collection: Collection): readonly string[] {
  return [
    ...collection.definitions.map(printDefinition),
    ...collection.assets.map(printAsset),
    ...collection.sources.map((item) => header('source', item)),
    ...collection.objects.map(printNode),
    ...collection.relationships.map((item) => header('wire', item)),
    ...collection.sections.map(printSection),
  ];
}

function printDefinition(definition: Collection['definitions'][number]): string {
  return `type @${definition.id} ${JSON.stringify(definition.label)} = ${printDefinitionExpression(definition.expression)}`;
}

function printDefinitionExpression(
  expression: Collection['definitions'][number]['expression'],
): string {
  if (expression.kind === 'union') return printDefinitionUnion(expression.items);
  return printDefinitionAtom(expression);
}

function printDefinitionUnion(
  items: readonly Collection['definitions'][number]['expression'][],
): string {
  return items
    .map((item) =>
      item.kind === 'union'
        ? `(${printDefinitionExpression(item)})`
        : printDefinitionExpression(item),
    )
    .join(' | ');
}

function printDefinitionAtom(
  expression: Exclude<Collection['definitions'][number]['expression'], { readonly kind: 'union' }>,
): string {
  return definitionAtomPrinters[expression.kind](expression as never);
}

const definitionAtomPrinters = {
  primitive: (
    expression: Extract<
      Collection['definitions'][number]['expression'],
      { readonly kind: 'primitive' }
    >,
  ): string => expression.name,
  reference: (
    expression: Extract<
      Collection['definitions'][number]['expression'],
      { readonly kind: 'reference' }
    >,
  ): string => `@${expression.id}`,
  literal: (
    expression: Extract<
      Collection['definitions'][number]['expression'],
      { readonly kind: 'literal' }
    >,
  ): string =>
    typeof expression.value === 'string'
      ? JSON.stringify(expression.value)
      : String(expression.value),
};
/** Media kind is an admission hint; exact bytes/type/metadata come from the pinned supplied record. */
function printAsset(asset: Collection['assets'][number]): string {
  const kind = assetKind(asset.mediaType);
  return header('asset', { ...asset, kind, source: asset.digest });
}
/** Model accepts general metadata, but Language only promises supported image/icon/font admissions. */
function assetKind(mediaType: string): string {
  if (mediaType.startsWith('font/')) return 'font';
  if (mediaType.startsWith('image/')) return 'image';
  reject(
    'unrepresentable',
    origin,
    'Image or font media',
    'Asset media type has no DSL admission form',
    mediaType,
  );
}

/** Optional display headings remain comments even when they contain line breaks. */
function withHeading(
  source: string,
  heading: string | undefined,
): string {
  if (heading === undefined) return source;
  return `# ${heading.replace(/\n/g, '\n# ')}\n${source}`;
}
