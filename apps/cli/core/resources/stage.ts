/*
 * Resource staging for authoring and preset admission: read each declared font or image, stage it
 * with Assets (or keep its pinned digest), back up the normalised bytes, then freeze the aliases
 * into the Authoring request. Uses injected ports only. A failure stops before any Authoring
 * request is sent; staged bytes left behind are collectable Assets orphans.
 */
import type { SemanticInputs, Transport } from '../../contract/ports/runtime.js';
import type { ResourceReader } from '../../contract/ports/resource-reader.js';
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
import { rejected, success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** What a single `/api/v1/resources/` call needs: the transport's POST. */
export interface ResourcePoster {
  readonly transport: Pick<Transport, 'post'>;
}
/** This resource flow consumes only byte I/O plus the four semantic decoders it invokes. */
export interface ResourceDependencies extends ResourcePoster {
  readonly resources: ResourceReader;
  readonly semantic: Pick<
    SemanticInputs,
    'admissionDigest' | 'backup' | 'requests' | 'checkedRequest'
  >;
}
/** Service envelope failures retain their owner diagnostic; preparation never reports an optimistic commit. */
export async function resourceCall(
  path: string,
  input: unknown,
  dependencies: ResourcePoster,
): Promise<Result<unknown>> {
  const response = await dependencies.transport.post(`/api/v1/resources/${path}`, input);
  if (!response.ok) return response;
  const outcome = response.value.outcome;
  if (!outcome.ok) return rejected('service-rejected', outcome.error);
  return success(outcome.value);
}
/** A pinned digest is backed up as it is; local bytes are staged first. */
function stage(
  resource: StagedResource,
  dependencies: ResourceDependencies,
): Promise<Result<StagedBackup>> {
  if (resource.kind === 'pinned') return backup(resource.alias, resource.digest, dependencies);
  return stageLocal(resource.alias, resource.input, dependencies);
}
/** One upload is followed by an exact normalized byte read for durable local replay protection. */
async function stageLocal(
  alias: string,
  input: StageInput,
  dependencies: ResourceDependencies,
): Promise<Result<StagedBackup>> {
  const staged = await resourceCall('stage', input, dependencies);
  if (!staged.ok) return staged;
  return stagedBackup(alias, staged.value, dependencies);
}
/** Assets admission identity is checked before resolving its normalized copy. */
function stagedBackup(
  alias: string,
  input: unknown,
  dependencies: ResourceDependencies,
): Promise<Result<StagedBackup>> {
  const digest = dependencies.semantic.admissionDigest(input);
  if (!digest.ok) return Promise.resolve(digest);
  return backup(alias, digest.value, dependencies);
}
/** Every referenced byte, including already-pinned resources, is retained before the Authoring request can be sent. */
async function backup(
  alias: string,
  digest: AssetDigest,
  dependencies: ResourceDependencies,
): Promise<Result<StagedBackup>> {
  const blob = await resourceCall('blob', digest, dependencies);
  if (!blob.ok) return blob;
  const bytes = dependencies.semantic.backup(blob.value);
  if (!bytes.ok) return bytes;
  return success({ alias, backup: bytes.value });
}
/**
 * Stage each declaration of `source`, read relative to its file, before freezing aliases; failure
 * leaves only collectable Assets orphans.
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
/** Exact aliases are retained after all declared bytes have been admitted. */
async function freeze(
  retained: RetainedRequest,
  values: readonly StagedBackup[],
  dependencies: ResourceDependencies,
): Promise<Result<RetainedRequest>> {
  const request = { ...retained.request, assets: assetBindings(values) };
  const frozen = await resourceCall('freeze', request, dependencies);
  if (!frozen.ok) return frozen;
  const checked = dependencies.semantic.checkedRequest(frozen.value);
  if (!checked.ok) return checked;
  return success({
    ...retained,
    request: checked.value,
    backups: values.map((item) => item.backup),
  });
}
/** Each staged alias and the digest of its bytes, in declaration order. */
export function assetBindings(staged: readonly StagedBackup[]): readonly AssetBinding[] {
  return staged.map((item) => ({ alias: item.alias, digest: item.backup.digest }));
}
/** Stage a semantic declaration list; a failed member prevents any canonical request submission. */
export async function stageResources(
  file: FilePath,
  requests: readonly ResourceRequest[],
  dependencies: ResourceDependencies,
): Promise<Result<readonly StagedBackup[]>> {
  const read = await Promise.all(
    requests
      .filter((item) => item.kind !== 'theme')
      .map((item) => dependencies.resources.read(file, item)),
  );
  const checked = combined(read);
  if (!checked.ok) return checked;
  return combined(await Promise.all(checked.value.map((item) => stage(item, dependencies))));
}
