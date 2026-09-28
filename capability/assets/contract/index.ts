/**
 * Public entry point of Assets. It exports the two factories, the digest and lease ID schemas, and
 * the contract types. Diagram bindings to assets, and retrying submissions, belong to Authoring;
 * lease recovery and orphan cleanup belong to Assets.
 */
export { openAssets } from './compose.js';
export { createAssets } from './api.js';
export { digest, leaseId } from './brands.js';
export type { Digest, LeaseId } from './brands.js';
export type { Result, AssetError, ErrorCode } from './errors.js';
export type {
  Assets,
  AssetDependencies,
  ReadLease,
  WriteLease,
  CollectionReport,
} from './types.js';
export type {
  Admission,
  BlobDescriptor,
  StoredBlob,
  NormalizedMedia,
  SupportedMedia,
  StageInput,
} from './records/media.js';
export type { LeaseRecord } from './records/lease.js';
export type { AssetStorage, AssetTransaction } from './ports/storage.js';
export type { MediaHandler, MediaRegistry } from './ports/media.js';
export type { IdentityPort } from './ports/identity.js';
export type { ReachabilityReader } from './ports/reachability.js';
export type { AssetDatabase, AssetStatement, BlobFiles } from './ports/native.js';
