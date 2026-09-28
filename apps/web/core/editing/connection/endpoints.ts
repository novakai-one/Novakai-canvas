/*
 * Connection endpoint resolution: a gesture endpoint becomes a canonical view address (its node
 * and object must still exist, its member must be measured and legal), and a view address becomes
 * the Model endpoint the request needs (member IDs checked against the grammar). Pure; Model's
 * policy tables and ID grammar arrive through ConnectionPolicy.
 */
import type { Result } from '../../../contract/errors.js';
import type {
  DiagramObject,
  MemberEndpointKind,
  Endpoint,
} from '../../../contract/records/owners.js';
import type { ActiveDiagram } from '../../../contract/records/active-diagram.js';
import type { ConnectionEndpointView } from '../../../contract/records/connection.js';
import type { ConnectionIntent, ConnectionPolicy, ResolvedEndpoints } from './types.js';
import { connectionFailure } from './failure.js';

/** The policy parts endpoint resolution reads: the member ID grammar and the endpoint tables. */
type EndpointPolicy = Pick<
  ConnectionPolicy,
  'descendantId' | 'memberEndpoints' | 'genericMemberEndpoints'
>;

/** The scene node a gesture endpoint can point at. */
type SceneNode = ActiveDiagram['document']['scene']['sections'][number]['nodes'][number];

/** Both gesture endpoints resolved to canonical addresses. */
export function resolveEndpoints(
  policy: EndpointPolicy,
  active: ActiveDiagram,
  intent: ConnectionIntent,
): Result<ResolvedEndpoints> {
  const source = resolveEndpoint(policy, active, intent.source);
  if (!source.ok) {
    return source;
  }
  const target = resolveEndpoint(policy, active, intent.target);
  if (!target.ok) {
    return target;
  }
  return { ok: true, value: { source: source.value, target: target.value } };
}

/** One endpoint as Model addresses it; the member ID is checked against the grammar. */
export function relationshipEndpoint(
  policy: EndpointPolicy,
  endpoint: ConnectionEndpointView,
): Result<Endpoint> {
  if (endpoint.member === undefined) {
    return { ok: true, value: { object: endpoint.object } };
  }
  const member = policy.descendantId.safeParse(endpoint.member);
  if (!member.success) {
    return connectionFailure(
      'invalid-edit',
      'The member address is not readable.',
      'Reconnect the current members.',
    );
  }
  return { ok: true, value: { object: endpoint.object, member: member.data } };
}

/** One endpoint: its node and object must still exist, then its member must be addressable. */
function resolveEndpoint(
  policy: EndpointPolicy,
  active: ActiveDiagram,
  endpoint: ConnectionIntent['source'],
): Result<ConnectionEndpointView> {
  const node = endpointNode(active, endpoint);
  if (node === undefined) {
    return staleTarget();
  }
  const object = endpointObject(active, node);
  if (object === undefined) {
    return staleTarget();
  }
  return endpointMember(policy, object, node, endpoint.member);
}

/** The endpoint vanished from the canonical document while the gesture was in flight. */
function staleTarget(): Result<ConnectionEndpointView> {
  return connectionFailure(
    'stale-target',
    'The connection endpoint is no longer represented by a canonical object.',
    'Reconnect the current nodes.',
  );
}

/** The scene node a gesture endpoint points at. */
function endpointNode(
  active: ActiveDiagram,
  endpoint: ConnectionIntent['source'],
): SceneNode | undefined {
  const section = active.document.scene.sections.find((item) => item.id === endpoint.section);
  return section?.nodes.find((item) => item.id === endpoint.node);
}

/** The canonical object a scene node measures, when it still represents one. */
function endpointObject(
  active: ActiveDiagram,
  node: SceneNode,
): DiagramObject | undefined {
  const objectId = node.measured.objectId;
  if (objectId === null || objectId === undefined) {
    return undefined;
  }
  return active.document.collection.objects.find((item) => item.id === objectId);
}

/** The member address of an endpoint; no member addresses the whole object. */
function endpointMember(
  policy: EndpointPolicy,
  object: DiagramObject,
  node: SceneNode,
  member: string | null,
): Result<ConnectionEndpointView> {
  if (member === null) {
    return { ok: true, value: endpointView(object, undefined) };
  }
  return addressMember(policy, object, node, member);
}

/** A member must exist in the node's measured anchors and be a legal endpoint on the object. */
function addressMember(
  policy: EndpointPolicy,
  object: DiagramObject,
  node: SceneNode,
  member: string,
): Result<ConnectionEndpointView> {
  const anchor = node.measured.content.anchors.find((item) => item.member === member);
  if (anchor === undefined) {
    return connectionFailure(
      'stale-target',
      'The selected member is no longer available.',
      'Reconnect the current members.',
    );
  }
  if (!canonicalMemberAllowed(policy, object, anchor.member)) {
    return connectionFailure(
      'unsupported-edit',
      'The selected member is not a legal connection endpoint for this object.',
      'Choose a field, member, signature, port or row supported by the object.',
    );
  }
  return { ok: true, value: endpointView(object, anchor) };
}

/** The view address of an object endpoint, with the anchor's member when one was picked. */
function endpointView(
  object: DiagramObject,
  anchor: { readonly member: string; readonly label: string } | undefined,
): ConnectionEndpointView {
  if (anchor === undefined) {
    return { object: object.id, kind: object.kind, label: object.label };
  }
  return {
    object: object.id,
    kind: object.kind,
    label: object.label,
    member: anchor.member,
    memberLabel: anchor.label,
  };
}

/** A member is a legal endpoint when its kind is allowed on this kind of object. */
function canonicalMemberAllowed(
  policy: EndpointPolicy,
  object: DiagramObject,
  member: string,
): boolean {
  const kind = canonicalMemberKind(object, member);
  const allowed = policy.memberEndpoints[object.kind] ?? policy.genericMemberEndpoints;
  return kind !== undefined && allowed.includes(kind);
}

/** The runtime form of `MemberEndpointKind` (Model exports the type only). */
const memberEndpointKinds: readonly MemberEndpointKind[] = [
  'field',
  'member',
  'signature',
  'port',
  'row',
];

/** The member kind of a port or content block ID, when it is addressable. */
function canonicalMemberKind(
  object: DiagramObject,
  member: string,
): MemberEndpointKind | undefined {
  if (object.ports.some((port) => port.id === member)) {
    return 'port';
  }
  return contentMemberKind(object, member);
}

/** A content block's member kind; table rows are found through their table. */
function contentMemberKind(
  object: DiagramObject,
  member: string,
): MemberEndpointKind | undefined {
  const block = object.content.find((item) => item.id === member);
  if (block === undefined || block.kind === 'table') {
    return tableRowKind(object, member);
  }
  return memberEndpointKinds.find((kind) => kind === block.kind);
}

/** The member is a table row when any table holds a row with this ID. */
function tableRowKind(
  object: DiagramObject,
  member: string,
): MemberEndpointKind | undefined {
  const table = object.content.find(
    (item) => item.kind === 'table' && item.rows.some((row) => row.id === member),
  );
  return table === undefined ? undefined : 'row';
}
