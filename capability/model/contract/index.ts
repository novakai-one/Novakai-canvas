/**
 * The Model capability's public entry point.
 *
 * It exports the names that code outside Model (or Model's own contract tests) imports, checked
 * against the workspace, plus the types that name an exported helper's result
 * (`CallableEndpoint`, `DefinitionUsage`). Everything else in `contract/` stays inside the
 * capability. Add a name only when a real consumer needs it.
 *
 * The export statements keep their original order, so modules load in the same order.
 */

/**
 * Validate unknown data, plan a valid transition, or stage one unchecked. Every outcome is
 * deeply frozen. Documented in `api.ts`.
 */
export { validate, plan, stage } from './api.js';

/**
 * Checked ID and digest schemas: `safeParse` builds a typed ID without a cast. They are shared,
 * unfrozen schema objects. Documented in `brands.ts`.
 */
export {
  digest,
  objectId,
  collectionId,
  descendantId,
  assetId,
  definitionId,
  relationshipId,
  sectionId,
  groupId,
} from './brands.js';
export type { ObjectId, SectionId, DescendantId, DefinitionId } from './brands.js';

/** The result type and the machine-readable failure codes. Documented in `errors.ts`. */
export type { Result, DiagnosticCode } from './errors.js';

/**
 * The collection record and the object, content, definition, relationship, section and layout
 * types consumers read. `definitionSchema` is the strict definition schema (shared, unfrozen).
 * `primitiveType` is the enum of primitive type names a definition may use (shared, unfrozen).
 * The definition and callable helpers are documented in `api.ts`.
 */
export type { Collection } from './records/collection.js';
export type { DiagramObject, ObjectKind } from './records/object.js';
export type { ContentBlock, Endpoint } from './records/content.js';
export type { Definition, TypeExpression, FieldType, TypeUse } from './records/definition.js';
export { definitionSchema, primitiveType } from './records/definition.js';
export { definitionDisplay, definitionUsages, fieldTypeDisplay, typeUseDisplay } from './api.js';
export { resolveCallableEndpoint } from './api.js';
export type { CallableEndpoint, DefinitionUsage } from './api.js';
export type { Relationship, RelationshipKind } from './records/relationship.js';
export { relationshipKind } from './records/relationship.js';
export type {
  Section,
  Appearance,
  Group,
  WireAppearance,
  SequenceItem,
  Mode,
} from './records/section.js';
export type { LayoutIntent, Placement } from './records/layout.js';

/** One change, and the planned or staged outcome of a batch. */
export type { Change } from './records/change.js';
export type { ChangePlan, ChangeStage } from './types.js';

/**
 * Policy tables: which layouts and relationship kinds each section mode allows, which members
 * each object kind exposes as endpoints, and which object kinds each relationship kind accepts
 * as source and target. Typed read-only; not frozen at runtime. Documented in
 * `records/policies.ts`.
 */
export {
  compatibleLayouts,
  compatibleWires,
  memberEndpoints,
  genericMemberEndpoints,
  sourceEndpoints,
  targetEndpoints,
} from './records/policies.js';
export type { MemberEndpointKind } from './records/policies.js';
