import type { CliDependencies, RequestDraft } from '../../contract/ports/runtime.js';
import type { ByteBackup, LocalInput } from '../../contract/records/resources.js';
import type { Command } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
/** This resource flow consumes only byte I/O plus the four semantic decoders it invokes. */
interface ResourceDependencies {
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
  return response.value.outcome;
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
  digest: string,
  dependencies: ResourceDependencies,
): Promise<Result<{ readonly alias: string; readonly backup: ByteBackup }>> {
  const blob = await resourceCall('blob', digest, dependencies);
  if (!blob.ok) return blob;
  const bytes = dependencies.semantic.backup(blob.value);
  if (!bytes.ok) return bytes;
  return { ok: true, value: { alias, backup: bytes.value } };
}
/** Stage each declaration before freezing aliases; failure leaves only collectable Assets orphans. */
export async function prepareResources(
  command: Command,
  source: string,
  draft: RequestDraft,
  dependencies: ResourceDependencies,
): Promise<Result<RequestDraft>> {
  const requests = dependencies.semantic.requests(source);
  if (!requests.ok) return requests;
  const staged = await stageResources(command.target, requests.value, dependencies);
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
  return {
    ok: true,
    value: { ...draft, request: checked.value, backups: values.map((item) => item.backup) },
  };
}
/** Restage exact normalized bytes before admission; receipt reconciliation has already established no commit exists. */
export async function restoreResources(
  draft: RequestDraft,
  dependencies: Pick<ResourceDependencies, 'transport'>,
): Promise<Result<void>> {
  return restoreBackups(draft.backups ?? [], dependencies);
}
/** Restore failures stop before canonical admission, while successful backups remain safe to replay. */
async function restoreBackups(
  backups: readonly ByteBackup[],
  dependencies: Pick<ResourceDependencies, 'transport'>,
): Promise<Result<void>> {
  const result = combined(
    await Promise.all(backups.map((backup) => resourceCall('restore', backup, dependencies))),
  );
  if (!result.ok) return result;
  return { ok: true, value: undefined };
}

/** Stage a semantic declaration list; a failed member prevents any canonical request submission. */
export async function stageResources(
  file: string,
  requests: readonly import('../../contract/records/resources.js').ResourceRequest[],
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
/** Preserve the first typed failure without inventing successful values for rejected members. */
function combined<T>(results: readonly Result<T>[]): Result<readonly T[]> {
  const failed = results.find((item) => !item.ok);
  if (failed) return failed;
  return { ok: true, value: results.filter((item) => item.ok).map((item) => item.value) };
}
