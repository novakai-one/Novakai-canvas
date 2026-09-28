/*
 * Entity rules of the build-spec profile: every object the entities section shows is an entity
 * node with at least one invariant text child. Pure; the findings are returned.
 */
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import { id, text, type Declaration } from './declarations.js';
import { findingAt } from './findings.js';

/** Each shown entity must resolve to an entity node with an invariant. */
export function entityFindings(
  entityIds: readonly string[],
  nodes: readonly Declaration[],
  section: Declaration,
): readonly ProfileFinding[] {
  return entityIds.flatMap((entityId) =>
    entityFinding(
      nodes.find((node) => id(node) === entityId),
      entityId,
      section,
    ),
  );
}

/** A missing or wrongly-kinded entity is reported at the section; a missing invariant at the node. */
function entityFinding(
  entity: Declaration | undefined,
  entityId: string,
  section: Declaration,
): readonly ProfileFinding[] {
  if (!isEntityNode(entity))
    return [
      findingAt(section, {
        code: 'entity-kind',
        path: `section @entities show @${entityId}`,
        message: 'Entities must show entity nodes.',
      }),
    ];
  return invariantFinding(entity, entityId);
}

/** The declaration exists and its kind field is 'entity'. */
function isEntityNode(entity: Declaration | undefined): entity is Declaration {
  return entity !== undefined && text(entity, 'kind') === 'entity';
}

/** An entity without an invariant text child is reported. */
function invariantFinding(
  entity: Declaration,
  entityId: string,
): readonly ProfileFinding[] {
  if (entity.children.some((child) => child.kind === 'text')) return [];
  return [
    findingAt(entity, {
      code: 'entity-invariant',
      path: `node @${entityId}`,
      message: 'Entity must contain at least one invariant text child.',
    }),
  ];
}
