/*
 * Resource staging for authoring and preset admission: read each declared font or image, stage it
 * with Assets (or keep its pinned digest), back up the normalised bytes, then freeze the aliases
 * into the Authoring request. Uses injected ports only. A failure stops before any Authoring
 * request is sent; staged bytes left behind are collectable Assets orphans.
 */
import type { ResourceSyntax } from '../../contract/ports/runtime.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type {
  AssetBinding,
  StagedBackup,
  StagedResource,
} from '../../contract/records/staged-resource.js';
import type { ResourceRequest, StageInput } from '../../contract/records/foreign.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { AssetDigest, FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** What staging uses: the confined resource reader and the service's stage and blob calls. */
export interface StagingDependencies {
  readonly reader: ResourceReader;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob'>;
}

/** What DSL preparation adds: the source's resource declarations and the service's freeze. */
export interface ResourceDependencies extends StagingDependencies {
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'freeze'>;
  readonly semantic: ResourceSyntax;
}

/**
 * Stage each declaration of `source`, read relative to its file, before freezing aliases. Fails
 * with `invalid-source`, as the resource read or a service call does, or with `invalid-input`
 * when the frozen request fails Authoring's schema.
 */
export async function prepareResources(
  source: SourceFile,
  retained: RetainedRequest,
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const requests = dependencies.semantic.requests(source.source);
  if (!requests.ok) return requests;
  const staged = await stageResources(source.file, requests.value, dependencies);
  if (!staged.ok) return staged;
  return freeze(retained, staged.value, dependencies);
}

/**
 * Stage a declaration list; a failed member prevents any canonical request submission. Fails as
 * the first failed resource read, then the first failed stage or blob call, does.
 */
export async function stageResources(
  file: FilePath,
  requests: readonly ResourceRequest[],
  dependencies: StagingDependencies,
): Promise<Result<readonly StagedBackup[]>> {
  const read = await Promise.all(
    requests
      .filter((item) => item.kind !== 'theme')
      .map((item) => dependencies.reader.read(file, item)),
  );
  const checked = combined(read);
  if (!checked.ok) return checked;
  return combined(await Promise.all(checked.value.map((item) => stage(item, dependencies))));
}

/** Each staged alias and the digest of its bytes, in declaration order. */
export function assetBindings(staged: readonly StagedBackup[]): readonly AssetBinding[] {
  return staged.map((item) => ({ alias: item.alias, digest: item.backup.digest }));
}

/** Exact aliases are retained after all declared bytes have been admitted. */
async function freeze(
  retained: RetainedRequest,
  values: readonly StagedBackup[],
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const frozen = await dependencies.resources.freeze(retained.request, assetBindings(values));
  if (!frozen.ok) return frozen;
  return success({
    ...retained,
    request: frozen.value,
    backups: values.map((item) => item.backup),
  });
}

/** A pinned digest is backed up as it is; local bytes are staged first. */
function stage(
  resource: StagedResource,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  if (resource.kind === 'pinned') return backup(resource.alias, resource.digest, dependencies);
  return stageLocal(resource.alias, resource.input, dependencies);
}

/** One upload is followed by an exact normalized byte read for durable local replay protection. */
async function stageLocal(
  alias: string,
  input: StageInput,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const digest = await dependencies.resources.stage(input);
  if (!digest.ok) return digest;
  return backup(alias, digest.value, dependencies);
}

/** Every referenced byte, including already-pinned resources, is retained before the Authoring request can be sent. */
async function backup(
  alias: string,
  digest: AssetDigest,
  dependencies: StagingDependencies,
): Promise<Result<StagedBackup>> {
  const bytes = await dependencies.resources.blob(digest);
  if (!bytes.ok) return bytes;
  return success({ alias, backup: bytes.value });
}
