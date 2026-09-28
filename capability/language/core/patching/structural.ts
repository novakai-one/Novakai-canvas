/*
 * Whole-record patch operations (`add`, `replace`, `delete`) and `reset`, compiled into Model
 * change data. Language lowers the declaration the same way as in a document; Model owns what a
 * delete cascades into and clearing manual layout. Pure: nothing is written. Faults are
 * `LanguageFault`s for `protect`. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { Operation } from '../../contract/records/syntax.js';
import type { ResolvedResources } from '../../contract/records/requests.js';
import { lowerNode, lowerRecord } from '../lowering/content.js';
import { lowerSection } from '../lowering/views.js';
import { lowerAsset } from '../lowering/resources.js';
import type { RawRecord } from '../lowering/fields.js';
import { accepted, reject } from '../validation/outcomes.js';
import { recordNamespaces } from '../vocabulary/defaults.js';
import { requirePlainAddress } from './targets.js';

/**
 * Compiles an `add`, `replace` or `delete` of a whole record addressed by a plain `@id`.
 *
 * - `add` / `replace`: the declaration is lowered (node, section and asset have their own
 *   lowering; anything else is lowered as a plain record) and becomes a `create` or `replace`
 *   in the target's namespace.
 * - `delete node @id [cascade=true]`: becomes `delete-object`; `cascade` defaults to `false`.
 * - `delete` of any other target: becomes a `remove` in its namespace.
 *
 * @throws `invalid-value` for an address that is not a plain `@id`; `syntax` for an `add` or
 * `replace` without a declaration; and the faults of lowering the declaration.
 */
export function structuralChange(
  operation: Operation,
  resources: ResolvedResources,
): RawRecord {
  requirePlainAddress(operation);
  if (operation.action === 'delete') return deleteRecord(operation);
  const value = declarationRecord(operation, resources);
  return {
    op: operation.action === 'add' ? 'create' : 'replace',
    target: namespaces[operation.target],
    value,
  };
}

/**
 * Compiles a `reset`: `reset layout @section` becomes `reset-layout`; `reset route
 *
 * @section/@wire` becomes `reset-route`. Model clears only the manual data.
 *
 * @throws `invalid-value` for a layout reset without a plain `@id`, or a route reset without a
 * section.
 */
export function resetChange(operation: Operation): RawRecord {
  if (operation.target === 'layout') {
    requirePlainAddress(operation);
    return { op: 'reset-layout', section: operation.address.id };
  }
  if (operation.address.section === undefined)
    reject('invalid-value', operation.span, '@section/@wire', 'Route reset needs section address');
  return {
    op: 'reset-route',
    section: operation.address.section,
    relationship: operation.address.id,
  };
}

/** Deleting a node is the only explicit cascade; Model removes what depends on it. */
function deleteRecord(operation: Operation): RawRecord {
  if (operation.target === 'node')
    return {
      op: 'delete-object',
      id: operation.address.id,
      cascade: operation.fields.cascade?.value ?? false,
    };
  return { op: 'remove', target: namespaces[operation.target], id: operation.address.id };
}

/** The declaration lowered as in a document: node, section and asset have their own lowering. */
function declarationRecord(
  operation: Operation,
  resources: ResolvedResources,
): RawRecord {
  const item = operation.declaration;
  if (item === null)
    reject('syntax', operation.span, 'Complete declaration', 'Missing replacement declaration');
  switch (item.kind) {
    case 'node':
      return lowerNode(item);
    case 'section':
      return accepted(lowerSection(item));
    case 'asset':
      return lowerAsset(item, resources);
    default:
      return lowerRecord(item);
  }
}

/** The shared namespace table, looked up by any target (the parser only sends record targets). */
const namespaces: Readonly<Record<string, string>> = recordNamespaces;
