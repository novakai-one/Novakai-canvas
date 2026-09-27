/*
 * Preset commands' owner inputs: the recipe admission record from `recipe admit` flags, the
 * Authoring request for a prepared preset, and the expansion request for `recipe instantiate`.
 * Pure; the theme grammar is injected. Fails with `invalid-arguments` (the caller fixes the
 * flags) or `invalid-response` (the service's preparation did not form a request).
 */
import { z } from 'zod';
import type { Snapshot, Request } from '@novakai/canvas-authoring';
import { recipeFamily, requestSchema } from '../../contract/schemas.js';
import type { AssetDigest } from '../../contract/brands.js';
import type { PresetInputs, ResourceSyntax } from '../../contract/records/resources.js';
import type { Command } from '../../contract/records/command.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
const flags = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  family: recipeFamily,
  title: z.string().min(1),
});
const prepared = z.looseObject({
  key: z.strictObject({ kind: z.literal('preset'), id: z.string() }),
  reads: z.array(z.unknown()),
});
/** Recipe admission keeps editable DSL as its source; Templates owns canonicalization and immutable identity. */
function recipe(
  command: Command,
  source: string,
  syntax: ResourceSyntax,
): ReturnType<PresetInputs['source']> {
  const parsed = flags.safeParse(command.preset);
  if (!parsed.success)
    return failure({
      code: 'invalid-arguments',
      message: 'recipe admit requires --id --version --family --title',
    });
  const resources = syntax.requests(source);
  if (!resources.ok) return resources;
  return success({
    admission: { schemaVersion: 1, kind: 'recipe', ...parsed.data, description: '', source },
    resources: resources.value,
  });
}
/** The metadata precondition serializes new admissions; exact preset absence/presence is explicitly scoped too. */
function request(
  input: unknown,
  snapshot: Snapshot,
  id: string,
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
/** Expansion requires an exact recipe pin and explicit fresh namespace; Language remaps the resulting editable document. */
function expansion(
  pin: string,
  namespace: string,
): Result<unknown> {
  const exact = /^([^@]+)@([^#]+)#sha256:([a-f0-9]{64})$/.exec(pin);
  if (!exact || namespace.length === 0)
    return failure({
      code: 'invalid-arguments',
      message: 'Use recipe instantiate ID@VERSION#sha256:DIGEST --namespace ID --out FILE',
    });
  return success({
    pin: { kind: 'recipe', id: exact[1], version: exact[2], digest: exact[3] },
    namespace,
  });
}
/** Theme grammar is injected; this adapter owns only command-to-owner envelope construction. */
export function createPresetInputs(
  syntax: ResourceSyntax,
  theme: (source: string) => ReturnType<PresetInputs['source']>,
): PresetInputs {
  return {
    source: (command, source) =>
      command.name === 'theme-admit' ? theme(source) : recipe(command, source, syntax),
    request,
    expansion,
  };
}
