/*
 * Resource staging for authoring and preset admission: read each declared font or image, stage it
 * with Assets (or keep its pinned digest), back up the normalised bytes, then freeze the aliases
 * into the Authoring request. Uses injected ports only. A failure stops before any Authoring
 * request is sent; staged bytes left behind are collectable Assets orphans.
 */
import type { CliDependencies, RequestDraft } from '../../contract/ports/runtime.js';
import type { ByteBackup, LocalInput, ResourceRequest } from '../../contract/records/resources.js';
import type { SourceFile } from '../../contract/records/source-file.js';
import type { AssetDigest, FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { rejected, success } from '../../contract/errors.js';
import { combined } from '../shared/results.js';

/** This resource flow consumes only byte I/O plus the four semantic decoders it invokes. */
export interface ResourceDependencies {
  readonly transport: CliDependencies['transport'];
  readonly resourceFiles: CliDependencies['resourceFiles'];
  readonly semantic: Pick<
    CliDependencies['semantic'],
    'admissionDigest' | 'backup' | 'requests' | 'checkedRequest'
  >;
}
/** Service envelope failures retain their owner diagnostic; preparation never reports an optimistic commit. */
export async function resourceCall(
  path: string,
  input: unknown,
  dependencies: Pick<ResourceDependencies, 'transport'>,
): Promise<Result<unknown>> {
  const response = await dependencies.transport.post(`/api/v1/resources/${path}`, input);
  if (!response.ok) return response;
  const outcome = response.value.outcome;
  if (!outcome.ok) return rejected('service-rejected', outcome.error);
  return success(outcome.value);
}
/** One upload is followed by an exact normalized byte read for durable local replay protection. */
async function stage(
  input: LocalInput,
  dependencies: ResourceDependencies,
): Promise<Result<{ readonly alias: string; readonly backup: ByteBackup }>> {
  if (input.digest !== null) return backup(input.alias, input.digest, dependencies);
  const staged = await resourceCall('stage', input.stage, dependencies);
  if (!staged.ok) return staged;
  return stagedBackup(input.alias, staged.value, dependencies);
}
/** Assets admission identity is checked before resolving its normalized copy. */
function stagedBackup(
  alias: string,
  input: unknown,
  dependencies: ResourceDependencies,
): Promise<Result<{ readonly alias: string; readonly backup: ByteBackup }>> {
  const digest = dependencies.semantic.admissionDigest(input);
  if (!digest.ok) return Promise.resolve(digest);
  return backup(alias, digest.value, dependencies);
}
/** Every referenced byte, including already-pinned resources, is retained before the Authoring request can be sent. */
async function backup(
  alias: string,
  digest: AssetDigest,
  dependencies: ResourceDependencies,
): Promise<Result<{ readonly alias: string; readonly backup: ByteBackup }>> {
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
  draft: RequestDraft,
  dependencies: ResourceDependencies,
): Promise<Result<RequestDraft>> {
  const requests = dependencies.semantic.requests(source.source);
  if (!requests.ok) return requests;
  const staged = await stageResources(source.file, requests.value, dependencies);
  if (!staged.ok) return staged;
  return freezeDraft(draft, staged.value, dependencies);
}
/** Exact aliases are retained after all declared bytes have been admitted. */
async function freezeDraft(
  draft: RequestDraft,
  values: readonly { readonly alias: string; readonly backup: ByteBackup }[],
  dependencies: ResourceDependencies,
): Promise<Result<RequestDraft>> {
  const request = {
    ...draft.request,
    assets: values.map((item) => ({ alias: item.alias, digest: item.backup.digest })),
  };
  const frozen = await resourceCall('freeze', request, dependencies);
  if (!frozen.ok) return frozen;
  const checked = dependencies.semantic.checkedRequest(frozen.value);
  if (!checked.ok) return checked;
  return success({ ...draft, request: checked.value, backups: values.map((item) => item.backup) });
}
/** Stage a semantic declaration list; a failed member prevents any canonical request submission. */
export async function stageResources(
  file: FilePath,
  requests: readonly ResourceRequest[],
  dependencies: ResourceDependencies,
): Promise<Result<readonly { readonly alias: string; readonly backup: ByteBackup }[]>> {
  const inputs = await Promise.all(
    requests
      .filter((item) => item.kind !== 'theme')
      .map((item) => dependencies.resourceFiles.read(file, item)),
  );
  const checked = combined(inputs);
  if (!checked.ok) return checked;
  return combined(await Promise.all(checked.value.map((item) => stage(item, dependencies))));
}
