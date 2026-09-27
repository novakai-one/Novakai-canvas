import type {
  Collection,
  Endpoint,
  DiagramObject,
  ContentBlock,
} from '../../contract/records/owners.js';
import type { EndpointChoice } from '../../contract/records/wire-editor.js';
/** Option identity survives label changes and does not depend on punctuation inside labels. */
export function endpointKey(endpoint: Endpoint): string {
  return JSON.stringify([endpoint.object, endpoint.member ?? null]);
}
/** Human endpoint choices include objects, typed ports, ER fields and callable members. Model owns compatibility checks. */
export function endpointChoices(collection: Collection): readonly EndpointChoice[] {
  return collection.objects.flatMap(objectChoices);
}
/** Descendant identities remain distinct from the whole-object endpoint. */
function objectChoices(object: DiagramObject): readonly EndpointChoice[] {
  return [
    choice(object.label, { object: object.id }),
    ...object.ports.map((port) =>
      choice(`${object.label} · port ${port.label}: ${port.type}`, {
        object: object.id,
        member: port.id,
      }),
    ),
    ...object.content
      .filter(isConnectable)
      .map((item) =>
        choice(`${object.label} · ${item.label}`, { object: object.id, member: item.id }),
      ),
  ];
}
/** Text, lists and decoration are not semantic connection anchors. */
function isConnectable(
  item: ContentBlock,
): item is Extract<ContentBlock, { kind: 'field' | 'member' | 'signature' }> {
  return ['field', 'member', 'signature'].includes(item.kind);
}
/** A single formatter keeps controlled select values consistent with their semantic identities. */
function choice(
  label: string,
  endpoint: Endpoint,
): EndpointChoice {
  return { value: endpointKey(endpoint), label, endpoint };
}
