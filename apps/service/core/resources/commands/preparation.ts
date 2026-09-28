/*
 * Preset preparation: a theme or recipe admission normalised, bound to its selected resources and
 * planned by Templates against one snapshot, without a canonical write. Pure over the injected
 * owners; every refusal is a returned value (refusal.ts), and Authoring owns the canonical write
 * and receipt.
 */
import type {
  Catalog,
  Json,
  LoweredIntent,
  Preset,
  PresetPin,
  RecordKey,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capabilities.js';
import type {
  PreparationInput,
  PresetPreparation,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';
import {
  admissionFields,
  preparationInput,
} from '../../../contract/records/presets/preparation.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { json, recordId } from '../../../contract/schemas.js';
import { andThen, success } from '../../../contract/errors.js';
import { presetResources } from '../../presets/resources.js';
import { presetRecordId } from '../../workspace/records.js';
import { selectionRequest, storedCatalog } from './catalog.js';
import { invalidPreparation } from './refusal.js';

/** The owners preparation works through. */
export interface PreparationOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
  /** Normalises a theme admission against the catalog and the uploaded font bindings. */
  normalize(
    admission: Json,
    catalog: Catalog,
    assets: readonly { readonly alias: string; readonly digest: string }[],
  ): ResourceResult<Json>;
  /** Templates bound to one call's resolved resources. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read'>;
}

/**
 * Preparation binds codecs to selected resources; no catalog or workspace state is mutated.
 *
 * Steps; the first failure stops the preparation:
 * 1. Decode the input and normalise its admission against the stored catalog (see `normalizeInput`).
 * 2. Select its resources and plan the preset through Templates (see `planPreset`).
 * 3. Build the preparation the preset planner repeats (see `preparation`).
 *
 * Fails with `invalid-input` at `resources` for a malformed input, and with the owner's diagnostic
 * when Templates, theme normalisation or the selector refuses.
 */
export function prepare(
  raw: unknown,
  snapshot: Snapshot,
  owners: PreparationOwners,
): ResourceResult<PresetPreparation> {
  const normalized = normalizeInput(raw, snapshot, owners);
  if (!normalized.ok) return normalized;
  const planned = planPreset(normalized.value, snapshot, owners);
  return andThen(planned, (preset) => preparation(preset, snapshot));
}

/** An admission checked as JSON, in the form a preparation retains. */
type AdmissionJson = PresetPreparation['admission'];

/** A decoded input with its admission normalised, and the stored catalog it was normalised against. */
interface NormalizedInput {
  readonly input: PreparationInput;
  readonly catalog: Catalog;
  readonly admission: AdmissionJson;
}

/** The preset Templates planned and read back, and the admission it was planned from. */
interface PlannedPreset {
  readonly admission: AdmissionJson;
  readonly preset: Preset;
  readonly pin: PresetPin;
}

/**
 * Decodes the input, reads the stored catalog, then normalises the admission. Fails with
 * `invalid-input` at `resources` for a malformed input or a normalised admission that is not JSON,
 * and with the Templates or normalisation diagnostic.
 */
function normalizeInput(
  raw: unknown,
  snapshot: Snapshot,
  owners: PreparationOwners,
): ResourceResult<NormalizedInput> {
  const input = preparationInput.safeParse(raw);
  if (!input.success) return invalidPreparation();
  const catalog = storedCatalog(snapshot, owners);
  if (!catalog.ok) return catalog;
  const normalized = owners.normalize(input.data.admission, catalog.value, input.data.assets);
  return andThen(normalized, (admission) => jsonAdmission(input.data, catalog.value, admission));
}

/**
 * The normalised admission, checked as JSON. Fails with `invalid-input` at `resources` when it is
 * not JSON.
 */
function jsonAdmission(
  input: PreparationInput,
  catalog: Catalog,
  normalized: Json,
): ResourceResult<NormalizedInput> {
  const admission = json.safeParse(normalized);
  if (!admission.success) return invalidPreparation();
  return success({ input, catalog, admission: admission.data });
}

/**
 * Selects the normalised admission's resources, then plans it (see `readPlanned`). Fails with
 * `invalid-input` at `resources` when the selection envelope does not parse, and with the
 * selector's diagnostic.
 */
function planPreset(
  normalized: NormalizedInput,
  snapshot: Snapshot,
  owners: PreparationOwners,
): ResourceResult<PlannedPreset> {
  const request = selectionRequest(
    { ...normalized.input, admission: normalized.admission },
    snapshot,
  );
  if (!request.ok) return request;
  const selected = owners.selector.select(request.value, snapshot);
  if (!selected.ok) return selected;
  return readPlanned(normalized, owners.templates(selected.value.resources));
}

/**
 * Plans the admission through Templates bound to the selected resources, then reads the planned
 * preset back from the candidate catalog. Fails with the Templates diagnostic.
 */
function readPlanned(
  normalized: NormalizedInput,
  templates: Pick<Templates<LoweredIntent>, 'planAdmission' | 'read'>,
): ResourceResult<PlannedPreset> {
  const plan = templates.planAdmission(normalized.catalog, normalized.admission);
  if (!plan.ok) return plan;
  const preset = templates.read(plan.value.candidate, plan.value.pin);
  return andThen(preset, (read) =>
    success({ admission: normalized.admission, preset: read, pin: plan.value.pin }),
  );
}

/**
 * The preparation: the retained admission, the preset record, its pin and record key, the bytes it
 * retains and the preset and workspace records read. Fails with `invalid-input` at `resources`
 * when a value does not decode.
 */
function preparation(
  planned: PlannedPreset,
  snapshot: Snapshot,
): ResourceResult<PresetPreparation> {
  const admission = normalizedAdmission(planned.admission, planned.preset);
  if (!admission.ok) return admission;
  const record = json.safeParse(planned.preset);
  if (!record.success) return invalidPreparation();
  return andThen(presetKey(planned.pin), (key) =>
    success({
      admission: admission.value,
      record: record.data,
      pin: planned.pin,
      key,
      resources: presetResources(planned.preset),
      reads: catalogReads(snapshot),
    }),
  );
}

/**
 * Canonical recipe printing freezes theme aliases and local media declarations before returning a
 * retained admission; a theme admission is kept as it is. Fails with `invalid-input` at
 * `resources` when a recipe admission is not a record of JSON fields.
 */
function normalizedAdmission(
  admission: AdmissionJson,
  preset: Preset,
): ResourceResult<AdmissionJson> {
  if (preset.kind !== 'recipe') return success(admission);
  const original = admissionFields.safeParse(admission);
  if (!original.success) return invalidPreparation();
  return success({ ...original.data, source: preset.payload.source });
}

/**
 * The preset's record key, `preset:<digest>`. Fails with `invalid-input` at `resources` when it is
 * not an Authoring record ID.
 */
function presetKey(pin: PresetPin): ResourceResult<RecordKey> {
  const id = recordId.safeParse(presetRecordId(pin.digest));
  if (!id.success) return invalidPreparation();
  return success({ kind: 'preset', id: id.data });
}

/** Every preset and workspace record, deleted ones included, at the version read. Never fails. */
function catalogReads(snapshot: Snapshot): PresetPreparation['reads'] {
  return snapshot.records
    .filter((item) => ['preset', 'workspace'].includes(item.key.kind))
    .map((item) => ({ key: item.key, version: item.version }));
}
