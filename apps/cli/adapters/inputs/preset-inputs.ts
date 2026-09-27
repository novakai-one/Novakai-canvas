/*
 * Preset commands' owner inputs: the recipe admission record from `recipe admit`'s checked header
 * and source, and the Authoring request for a prepared preset. Pure; the theme grammar and the
 * resource syntax are injected. Fails with `invalid-source` (the recipe's DSL; the caller fixes
 * the file) or `invalid-response` (the service's preparation did not form a request).
 */
import { z } from 'zod';
import type { Snapshot, Request } from '@novakai/canvas-authoring';
import { requestSchema } from '../../contract/schemas.js';
import type { AssetDigest, RequestId } from '../../contract/brands.js';
import type { PresetInputs, ResourceSyntax } from '../../contract/records/resources.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
const prepared = z.looseObject({
  key: z.strictObject({ kind: z.literal('preset'), id: z.string() }),
  reads: z.array(z.unknown()),
});
/** Recipe admission keeps editable DSL as its source; Templates owns canonicalization and immutable identity. */
function recipe(
  header: RecipeHeader,
  source: string,
  syntax: ResourceSyntax,
): ReturnType<PresetInputs['source']> {
  const resources = syntax.requests(source);
  if (!resources.ok) return resources;
  return success({
    admission: { schemaVersion: 1, kind: 'recipe', ...header, description: '', source },
    resources: resources.value,
  });
}
/** The metadata precondition serializes new admissions; exact preset absence/presence is explicitly scoped too. */
function request(
  input: unknown,
  snapshot: Snapshot,
  id: RequestId,
  assets: readonly { readonly alias: string; readonly digest: AssetDigest }[],
): Result<Request> {
  const parsed = prepared.safeParse(input);
  if (!parsed.success)
    return failure({
      code: 'invalid-response',
      message: 'Service returned invalid preset preparation',
    });
  const metadata = snapshot.records.find(
    (item) => item.key.kind === 'workspace' && item.key.id === 'metadata',
  );
  if (!metadata)
    return failure({ code: 'invalid-response', message: 'Workspace metadata is missing' });
  const existing = snapshot.records.find(
    (item) => item.key.kind === 'preset' && item.key.id === parsed.data.key.id,
  );
  const expected = [
    { key: metadata.key, version: metadata.version },
    { key: parsed.data.key, version: existing?.version ?? 'absent' },
  ];
  const checked = requestSchema.safeParse({
    workspace: snapshot.workspace,
    request: id,
    version: 1,
    actor: { id: 'agent:cli', kind: 'agent' },
    expected,
    scope: expected.map((item) => item.key),
    assets,
    intent: { kind: 'change', planner: 'preset', payload: input },
  });
  return checkedResult(checked);
}
/** Owner schema rejection remains a typed CLI failure. */
function checkedResult(checked: ReturnType<typeof requestSchema.safeParse>): Result<Request> {
  if (!checked.success)
    return failure({
      code: 'invalid-response',
      message: 'Prepared preset cannot form an Authoring request',
    });
  return success(checked.data);
}
/** Theme grammar is injected; this adapter owns only command-to-owner envelope construction. */
export function createPresetInputs(
  syntax: ResourceSyntax,
  theme: (source: string) => ReturnType<PresetInputs['source']>,
): PresetInputs {
  return {
    source: (command, source) =>
      command.name === 'theme-admit' ? theme(source) : recipe(command.recipe, source, syntax),
    request,
  };
}
