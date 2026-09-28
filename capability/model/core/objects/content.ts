import type { DescendantId } from '../../contract/brands.js';
import type { Diagnostic } from '../../contract/errors.js';
import type { Collection } from '../../contract/records/collection.js';
import type { ContentBlock } from '../../contract/records/content.js';
import type { DiagramObject, ObjectKind } from '../../contract/records/object.js';
import { duplicates } from '../invariants/duplicates.js';
import { diagnoseWhen, referenceIssue } from '../invariants/issues.js';

/**
 * One thing inside an object that an endpoint's `member` is matched against: a port, a content
 * block or a table row. Only its ID and kind, not the block's payload. Which kinds an endpoint
 * accepts is set by `memberEndpoints` and `genericMemberEndpoints`.
 */
export interface ObjectDescendant {
  /** The port, block or row ID. */
  readonly id: DescendantId;
  /** The block's kind, or `port` or `row`. */
  readonly kind: ContentBlock['kind'] | 'port' | 'row';
}

/**
 * Checks every object's content, in object order. For each object, in this order:
 * 1. descendant IDs (ports, blocks and table rows share one namespace) must be unique:
 *    `duplicate` at `objects.<id>.descendants.<descendant>`;
 * 2. for each block: its kind must be allowed on the object's kind ({@link contentOwners}; a kind
 *    without an entry is allowed anywhere): `content` at `objects.<id>.content.<block>`, "Content kind is not legal on
 *    this object kind"; then, for a table, every row must have one cell per column: `content` at
 *    `objects.<id>.content.<block>.<row>`, "Row width must equal column count";
 * 3. the object's role must be in `theme.roles`: `reference` at `objects.<id>.role`.
 *
 * Every failure is collected. Pure: Authoring owns correction, commit and crash recovery.
 *
 * @param collection - A parsed collection.
 * @returns Every diagnostic, in the order above, or an empty list.
 * @throws Never for a parsed collection.
 */
export function validateContent(collection: Collection): readonly Diagnostic[] {
  return collection.objects.flatMap(
    /** Checks one object's content. */
    (object) => validateObjectContent(object, collection),
  );
}

/**
 * Lists an object's descendants: its ports first, then each content block followed by that
 * block's table rows (if it is a table). Duplicates are kept, so callers can detect them.
 *
 * @param object - A parsed object.
 * @returns A new list of new `{ id, kind }` descriptions.
 * @throws Never for a parsed object.
 */
export function descendants(object: DiagramObject): readonly ObjectDescendant[] {
  const ports = object.ports.map(
    /** Describes one port. */
    (port): ObjectDescendant => ({ id: port.id, kind: 'port' }),
  );
  const content = object.content.flatMap(contentDescendants);
  return [...ports, ...content];
}

/**
 * The object kinds each content kind is allowed on. A content kind without an entry is allowed
 * on every object kind.
 */
const contentOwners: Readonly<Partial<Record<ContentBlock['kind'], readonly ObjectKind[]>>> = {
  field: ['entity'],
  keygroup: ['entity'],
  member: ['module', 'interface', 'function'],
  signature: ['module', 'interface', 'function'],
};

/** Describes a block, followed by its rows when it is a table. */
function contentDescendants(block: ContentBlock): readonly ObjectDescendant[] {
  const identity: ObjectDescendant = { id: block.id, kind: block.kind };
  if (block.kind !== 'table') {
    return [identity];
  }
  const rows = block.rows.map(
    /** Describes one table row. */
    (row): ObjectDescendant => ({ id: row.id, kind: 'row' }),
  );
  return [identity, ...rows];
}

/** Reports a block whose kind is not allowed on its object's kind. */
function validateContentPlacement(
  block: ContentBlock,
  object: DiagramObject,
): readonly Diagnostic[] {
  const allowedOwners = contentOwners[block.kind];
  if (allowedOwners === undefined) {
    return [];
  }
  return diagnoseWhen(
    !allowedOwners.includes(object.kind),
    'content',
    `objects.${object.id}.content.${block.id}`,
    'Content kind is not legal on this object kind',
  );
}

/** Reports each row of a table block whose cell count differs from its column count. */
function validateTableWidth(
  block: ContentBlock,
  path: string,
): readonly Diagnostic[] {
  if (block.kind !== 'table') {
    return [];
  }
  return block.rows.flatMap(
    /** Checks one row's width. */
    (row) =>
      diagnoseWhen(
        row.cells.length !== block.columns.length,
        'content',
        `${path}.${row.id}`,
        'Row width must equal column count',
      ),
  );
}

/** Checks one object: descendant uniqueness, then each block, then the object's theme role. */
function validateObjectContent(
  object: DiagramObject,
  collection: Collection,
): readonly Diagnostic[] {
  const path = `objects.${object.id}`;
  const identityIssues = duplicates(
    descendants(object),
    /** A descendant's key is its ID. */
    (item) => item.id,
    `${path}.descendants`,
  );
  const blockIssues = object.content.flatMap(
    /** Checks one block's placement, then its table width. */
    (block) => {
      const placementIssues = validateContentPlacement(block, object);
      const tableIssues = validateTableWidth(block, `${path}.content.${block.id}`);
      return [...placementIssues, ...tableIssues];
    },
  );
  const roleIssues = referenceIssue(!collection.theme.roles.includes(object.role), `${path}.role`);
  return [...identityIssues, ...blockIssues, ...roleIssues];
}
