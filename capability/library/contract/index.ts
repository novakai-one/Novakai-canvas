/**
 * The package entry point of `@novakai/canvas-library` (see package.json `exports`): every name a
 * consumer may import, listed explicitly.
 *
 * The four entry points — `validateLibrarySnapshot`, `planOrganisation`, `planMembership`,
 * `queryLibrary` — come
 * from `api.ts`, the only file allowed to import core; their behaviour is documented there. The
 * ID schema factories check and brand IDs; each call returns a new schema. Everything else is a
 * type. Nothing in this file imports the implementation.
 */
export { validateLibrarySnapshot, planOrganisation, planMembership, queryLibrary } from './api.js';
export {
  organisationIdSchema,
  folderIdSchema,
  collectionIdSchema,
  objectIdSchema,
  sectionIdSchema,
} from './brands.js';
export type { OrganisationId, FolderId, CollectionId, ObjectId, SectionId } from './brands.js';
export type { LibraryResult, ValidationError, Diagnostic, DiagnosticCode } from './errors.js';
export type { Organisation, Folder, OrganisationEntry } from './records/organisation.js';
export type {
  LibrarySnapshot,
  CollectionProjection,
  SectionProjection,
  ObjectProjection,
  RecentVisit,
} from './records/snapshot.js';
export type { OrganisationChange, RemovalPolicy } from './records/change.js';
export type {
  QueryRequest,
  QueryPage,
  SearchHit,
  HitKind,
  ArchiveMode,
  SortMode,
} from './records/query.js';
export type {
  PlanInput,
  MembershipInput,
  QueryInput,
  ReadVersions,
  OrganisationVersion,
  CollectionVersion,
  OrganisationPlan,
} from './types.js';
