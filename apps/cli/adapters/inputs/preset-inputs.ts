/*
 * Preset commands' owner inputs: the recipe admission record from `recipe admit`'s checked header
 * and source, and the Authoring request for a prepared preset. Pure; the theme grammar and the
 * resource syntax are injected. Fails with `invalid-source` (the recipe's DSL; the caller fixes
 * the file) or `invalid-response` (the service's preparation did not form a request).
 */
import type { Snapshot, Request } from '@novakai/canvas-authoring';
import { requestSchema } from '../../contract/schemas.js';
import type { RequestId } from '../../contract/brands.js';
import type { AssetBinding } from '../../contract/records/staged-resource.js';
import type { PresetInputs, PresetSource, ResourceSyntax } from '../../contract/ports/runtime.js';
import type { ThemeSource } from '../../contract/records/theme-source.js';
import type { RecipeHeader } from '../../contract/records/command.js';
import type { PresetPreparation } from '../../contract/records/service-answers.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
/** Recipe admission keeps editable DSL as its source; Templates owns canonicalization and immutable identity. */
function recipe(
  header: RecipeHeader,
  source: string,
  syntax: ResourceSyntax,
): Result<PresetSource> {
  const resources = syntax.requests(source);
  if (!resources.ok) return resources;
  return success({
    admission: { schemaVersion: 1, kind: 'recipe', ...header, description: '', source },
    resources: resources.value,
  });
}
/** The metadata precondition serializes new admissions; exact preset absence/presence is explicitly scoped too. */
function request(
  preparation: PresetPreparation,
  snapshot: Snapshot,
  id: RequestId,
  assets: readonly AssetBinding[],
): Result<Request> {
  const metadata = snapshot.records.find(
    (item) => item.key.kind === 'workspace' && item.key.id === 'metadata',
  );
  if (!metadata)
    return failure({ code: 'invalid-response', message: 'Workspace metadata is missing' });
  const existing = snapshot.records.find(
    (item) => item.key.kind === 'preset' && item.key.id === preparation.key.id,
  );
  const expected = [
    { key: metadata.key, version: metadata.version },
    { key: preparation.key, version: existing?.version ?? 'absent' },
  ];
  const checked = requestSchema.safeParse({
    workspace: snapshot.workspace,
    request: id,
    version: 1,
    actor: { id: 'agent:cli', kind: 'agent' },
    expected,
    scope: expected.map((item) => item.key),
    assets,
    intent: { kind: 'change', planner: 'preset', payload: preparation.document },
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
  theme: (source: string) => Result<ThemeSource>,
): PresetInputs {
  return {
    source: (command, source) =>
      command.name === 'theme-admit'
        ? themeAdmission(theme(source))
        : recipe(command.recipe, source, syntax),
    request,
  };
}

/** A checked theme file's admission, with its three fonts as the declarations to stage. */
function themeAdmission(theme: Result<ThemeSource>): Result<PresetSource> {
  if (!theme.ok) return theme;
  return success({ admission: theme.value.admission, resources: theme.value.fonts });
}
