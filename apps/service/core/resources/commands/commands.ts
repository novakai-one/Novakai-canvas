import type { ValidationError as LanguageError } from '@novakai/canvas-language';
import { z } from 'zod';
import { requestSchema, recordId } from '@novakai/canvas-authoring';
import type { Request, Snapshot } from '@novakai/canvas-authoring';
import type { WriteLease } from '@novakai/canvas-assets';
import type { Catalog, Preset } from '@novakai/canvas-templates';
import type {
  ResourceCommands,
  PresetOwners,
  PresetPreparation,
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';
import { dslCommand, presetAdmission } from '../../../contract/records/planning/commands.js';
import { EMPTY_RESOURCES } from '../../../contract/ports/capabilities.js';
const input = z.strictObject({
  admission: z.json(),
  assets: z.array(z.strictObject({ alias: z.string(), digest: z.string() })).default([]),
});
const restored = z.strictObject({ digest: z.string(), base64: z.string() });
/** Owner diagnostics cross this boundary unchanged; unexpected provider faults become typed invalid-input outcomes. */
class PreparationFault extends Error {
  /** Value-returning helpers retain the complete typed owner failure for the public Result boundary. */
  constructor(readonly diagnostic: ResourceDiagnostic) {
    super(diagnostic.message);
  }
}
/** No failed owner read is replaced by empty resources. */
function accepted<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: ResourceDiagnostic },
): T {
  if (!result.ok) throw new PreparationFault(result.error);
  return result.value;
}
/** Build only a semantic selection envelope, never a persistence transaction or canonical binding. */
function selectionRequest(
  value: ReturnType<typeof input.parse>,
  snapshot: Snapshot,
): Request {
  const header = presetAdmission.parse(value.admission);
  return requestSchema.parse({
    workspace: snapshot.workspace,
    request: 'resource-preparation',
    version: 1,
    actor: { id: 'agent:cli', kind: 'agent' },
    scope: [],
    expected: [],
    assets: value.assets,
    intent: {
      kind: 'change',
      planner: 'preset',
      payload: { admission: value.admission, source: header.source ?? '' },
    },
  });
}
/** Read catalog records through Templates against the exact supplied snapshot. */
function catalog(
  snapshot: Snapshot,
  owners: PresetOwners,
): Catalog {
  const templates = unboundTemplates(owners);
  const records = snapshot.records
    .filter((item) => item.key.kind === 'preset' && !item.deleted)
    .map((item) => item.value);
  return accepted(templates.readCatalog(records));
}
/** Canonical recipe printing freezes theme aliases and local media declarations before returning a retained admission. */
function normalizedAdmission(
  admission: z.infer<ReturnType<typeof z.json>>,
  preset: Preset,
): z.infer<ReturnType<typeof z.json>> {
  if (preset.kind !== 'recipe') return admission;
  const original = z.record(z.string(), z.json()).parse(admission);
  return { ...original, source: preset.payload.source };
}
/** Preparation binds codecs to selected resources; no catalog or workspace state is mutated. */
function prepare(
  raw: unknown,
  snapshot: Snapshot,
  owners: PresetOwners,
): PresetPreparation {
  const value = input.parse(raw);
  const records = catalog(snapshot, owners);
  const admission = z
    .json()
    .parse(accepted(owners.normalize(value.admission, records, value.assets)));
  const selected = accepted(
    owners.selector.select(selectionRequest({ ...value, admission }, snapshot), snapshot),
  );
  const templates = owners.templates(selected.resources);
  const plan = accepted(templates.planAdmission(records, admission));
  const preset = accepted(templates.read(plan.candidate, plan.pin));
  return {
    admission: normalizedAdmission(admission, preset),
    record: z.json().parse(preset),
    pin: plan.pin,
    key: { kind: 'preset', id: recordId.parse(`preset:${plan.pin.digest}`) },
    resources: preset.kind === 'theme' ? preset.payload.fonts : preset.payload.assets,
    reads: snapshot.records
      .filter((item) => ['preset', 'workspace'].includes(item.key.kind))
      .map((item) => ({ key: item.key, version: item.version })),
  };
}
/** Retained DSL requests carry checked alias-to-exact-pin selections, including patch theme changes. */
function freeze(
  raw: unknown,
  snapshot: Snapshot,
  owners: PresetOwners,
): Request {
  const request = requestSchema.parse(raw);
  if (request.intent.kind !== 'change') return request;
  if (request.intent.planner !== 'dsl') return request;
  const command = dslCommand.parse(request.intent.payload);
  const selected = accepted(owners.selector.select(request, snapshot));
  const themePins = Object.fromEntries(
    Object.entries(selected.resources.themes).map(([alias, pin]) => [
      alias,
      `${pin.id}@${pin.version}#${pin.digest}`,
    ]),
  );
  return requestSchema.parse({
    ...request,
    intent: { ...request.intent, payload: { ...command, themePins } },
  });
}
/** Expansion uses exact stored recipe source and normalized resource bindings; Language owns all identity remapping. */
function instantiate(
  raw: unknown,
  snapshot: Snapshot,
  owners: PresetOwners,
): string {
  const records = catalog(snapshot, owners);
  const request = z.strictObject({ pin: z.unknown(), namespace: z.string() }).parse(raw);
  const templates = unboundTemplates(owners);
  const preset = accepted(templates.read(records, request.pin));
  if (preset.kind !== 'recipe')
    throw new PreparationFault({
      code: 'invalid-input',
      path: 'preset.kind',
      message: 'Only recipes can be instantiated',
      recovery: 'Select an immutable recipe pin and prepare again.',
    });
  const selection = selectionRequest(
    { admission: { kind: 'recipe', source: preset.payload.source }, assets: [] },
    snapshot,
  );
  const resources = accepted(owners.selector.select(selection, snapshot)).resources;
  const expansion = owners.templates(resources);
  const expanded = accepted(expansion.instantiate(records, request));
  const printed = owners.language.print({
    collection: expanded.intent.collection,
    scope: { kind: 'all' },
  });
  if (!printed.ok) throw languageFault(printed.error);
  return printed.value.source;
}
/** Exact normalized restoration uses Assets reservations and releases on every settlement path; callers retain local backup bytes. */
async function restore(
  raw: unknown,
  owners: PresetOwners,
): ReturnType<ResourceCommands['restore']> {
  const checked = restored.safeParse(raw);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: 'invalid-input',
        path: 'restore',
        message: 'Expected digest and normalized base64',
        recovery: 'Retain the original backup.',
      },
    };
  return restoreChecked(checked.data, owners);
}
/** Reservation failure leaves no lease; a successful reservation always reaches release. */
async function restoreChecked(
  checked: z.infer<typeof restored>,
  owners: PresetOwners,
): ReturnType<ResourceCommands['restore']> {
  const lease = owners.assets.reserve([checked.digest]);
  if (!lease.ok) return lease;
  return restoreReserved(lease.value, checked);
}
/** Stage failure remains primary; release failure is observable only after successful staging. */
async function restoreReserved(
  lease: WriteLease,
  checked: z.infer<typeof restored>,
): ReturnType<ResourceCommands['restore']> {
  const staged = await lease.stage(checked.digest, checked.base64);
  const released = lease.release();
  if (!staged.ok) return staged;
  return released;
}
/** Typed host outcomes retain source on failure; the caller corrects preparation and retries before Authoring admission. */
function guarded<T>(operation: () => T): ResourceResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: preparationDiagnostic(error) };
  }
}
/** Bind byte and snapshot operations only; Authoring remains the sole canonical write and receipt gate. */
export function createResourceCommands(owners: PresetOwners): ResourceCommands {
  return {
    stage: (input) => owners.assets.stage(input),
    blob: (input) => owners.assets.resolve(input),
    restore: (input) => restore(input, owners),
    freeze: (input, snapshot) => guarded(() => freeze(input, snapshot, owners)),
    preparePreset: (input, snapshot) => guarded(() => prepare(input, snapshot, owners)),
    instantiate: (input, snapshot) => guarded(() => instantiate(input, snapshot, owners)),
  };
}

/** Unexpected schema failures remain distinguishable from owner failures without leaking provider details. */
function preparationDiagnostic(error: unknown): ResourceDiagnostic {
  if (error instanceof PreparationFault) return error.diagnostic;
  return {
    code: 'invalid-input',
    path: 'resources',
    message: 'Resource preparation input is invalid',
    recovery: 'Correct the named resource preparation input and prepare again.',
  };
}

/** Language's complete diagnostic batch survives resource preparation under its typed source. */
function languageFault(source: LanguageError): PreparationFault {
  return new PreparationFault({
    code: 'invalid-input',
    path: 'language',
    message: 'Language could not print the prepared recipe',
    recovery: 'Correct the named source diagnostics and prepare again.',
    source,
  });
}

/** Catalog reads need no selected resources; each caller receives its explicit direct Templates collaborator. */
function unboundTemplates(owners: PresetOwners): ReturnType<PresetOwners['templates']> {
  return owners.templates(EMPTY_RESOURCES);
}
