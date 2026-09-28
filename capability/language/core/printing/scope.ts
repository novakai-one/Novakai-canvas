import type { Collection } from '../../contract/ports/model.js';
import type { DefinitionId, TypeExpression } from '../../contract/ports/model.js';
import type { Scope } from '../../contract/records/requests.js';
import { reject, origin } from '../validation/outcomes.js';
/** Scoped data is a display projection and never asserted to be a valid standalone collection. */
export function selectScope(
  collection: Collection,
  scope: Scope,
): Collection {
  if (scope.kind === 'all') return collection;
  if (scope.kind === 'section') return sectionScope(collection, scope.id);
  return objectScope(collection, scope.id);
}
/** A section read includes visible canonical nodes, its wires and directly referenced resources. */
function sectionScope(
  collection: Collection,
  id: string,
): Collection {
  const section = collection.sections.find((item) => item.id === id);
  if (section === undefined)
    reject('unknown-target', origin, 'Existing section', 'Cannot read missing section', id);
  const ids = [
    ...section.appearances.map((item) => item.object),
    ...section.groups.map((item) => item.represents),
  ];
  const objects = collection.objects.filter((item) => ids.some((visible) => visible === item.id));
  const relationships = collection.relationships.filter((item) =>
    section.wires.some((wire) => wire.relationship === item.id),
  );
  return resourceScope({ ...collection, sections: [section], objects, relationships });
}
/** Object scope includes incident relationships and neighboring endpoint declarations as read context. */
function objectScope(
  collection: Collection,
  id: string,
): Collection {
  if (!collection.objects.some((item) => item.id === id))
    reject('unknown-target', origin, 'Existing object', 'Cannot read missing object', id);
  const relationships = collection.relationships.filter(
    (item) => item.source.object === id || item.target.object === id,
  );
  const neighbors = [
    id,
    ...relationships.flatMap((item) => [item.source.object, item.target.object]),
  ];
  return resourceScope({
    ...collection,
    sections: [],
    relationships,
    objects: collection.objects.filter((item) => neighbors.includes(item.id)),
  });
}
/** Pinned metadata accompanies included content; unrelated source/media declarations are omitted. */
function resourceScope(collection: Collection): Collection {
  const assets = collection.objects.flatMap((item) =>
    item.content.flatMap((block) => ('asset' in block ? [block.asset] : [])),
  );
  const sources = [
    ...collection.objects.flatMap((item) => item.sources),
    ...collection.relationships.flatMap((item) => item.sources),
  ];
  const referenced = new Set(collection.objects.flatMap((item) => item.content.flatMap(typeUses)));
  let changed = true;
  while (changed) {
    changed = false;
    collection.definitions.forEach((definition) => {
      if (!referenced.has(definition.id)) return;
      const refs = expressionReferenceIds(definition.expression);
      refs.forEach((id) => {
        if (!referenced.has(id)) {
          referenced.add(id);
          changed = true;
        }
      });
    });
  }
  return {
    ...collection,
    assets: collection.assets.filter((item) => assets.includes(item.id)),
    sources: collection.sources.filter((item) => sources.includes(item.id)),
    definitions: collection.definitions.filter((definition) => referenced.has(definition.id)),
  };
}

function typeUses(
  block: Collection['objects'][number]['content'][number],
): readonly DefinitionId[] {
  const direct = (
    type: string | { readonly kind: 'definition'; readonly id: DefinitionId },
  ): readonly DefinitionId[] => (typeof type === 'string' ? [] : [type.id]);
  if (block.kind === 'field' || block.kind === 'member') return direct(block.type);
  if (block.kind !== 'signature') return [];
  return [
    ...block.parameters.flatMap((parameter) =>
      typeof parameter === 'string' ? [] : direct(parameter.type),
    ),
    ...direct(block.returns),
  ];
}

function expressionReferenceIds(expression: TypeExpression): readonly DefinitionId[] {
  const refs: DefinitionId[] = [];
  const stack: TypeExpression[] = [expression];
  while (stack.length > 0) {
    const current = stack.pop();
    visitExpressionIfPresent(current, refs, stack);
  }
  return refs;
}

function visitExpressionIfPresent(
  current: TypeExpression | undefined,
  refs: DefinitionId[],
  stack: TypeExpression[],
): void {
  if (current !== undefined) visitExpression(current, refs, stack);
}

function visitExpression(
  current: TypeExpression,
  refs: DefinitionId[],
  stack: TypeExpression[],
): void {
  addExpressionReference(current, refs);
  addExpressionChildren(current, stack);
}

function addExpressionReference(
  current: TypeExpression,
  refs: DefinitionId[],
): void {
  if (current.kind === 'reference') refs.push(current.id);
}

function addExpressionChildren(
  current: TypeExpression,
  stack: TypeExpression[],
): void {
  if (current.kind === 'union') stack.push(...current.items);
}
