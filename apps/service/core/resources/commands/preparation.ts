/*
 * Why this file exists
 *
 * Saving a theme or recipe (a "preset") takes two steps. First,
 * `pnpm canvas theme admit blueprint.theme` asks `POST /api/v1/resources/prepare` what saving it
 * would store: the exact record, its version and digest, and every stored record it read. Then the
 * preset planner prepares it again at save, and refuses the change if anything moved.
 *
 * This file prepares one preset against one snapshot: it translates a source-syntax theme, picks
 * the themes and files it uses, and has Templates plan it. Each step answers a `Result`
 * (contract/errors.ts); the first mistake stops it. It never saves anything.
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
} from '../../../contract/records/capability-types.js';
import type { PresetPreparation } from '../../../contract/records/presets/preparation.js';
import { presetFields } from '../../../contract/records/presets/preparation.js';
import type {
  PreparationInput,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';
import { preparationInput } from '../../../contract/records/presets/resource-commands.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import type { FontBinding } from '../../../contract/ports/headless.js';
import { json, recordId } from '../../../contract/schemas.js';
import { andThen, success } from '../../../contract/errors.js';
import { presetResources } from '../../presets/resources.js';
import { presetRecordId } from '../../workspace/records.js';
import { buildSelectionRequest, readStoredCatalog } from './catalog.js';
import { invalidInputFailure } from './refusal.js';

/** What preparing a preset needs. */
export interface PreparationDependencies {
  /** Picks the themes and files the preset uses (selection/select.ts). */
  readonly selector: Pick<ResourceSelector, 'select'>;
  /**
   * Translates a theme written in source syntax (hex colours, font names) into the form Templates
   * checks. Anything else comes back unchanged (see core/presets/theme-admission.ts).
   */
  translateTheme(
    preset: Json,
    catalog: Catalog,
    fonts: readonly FontBinding[],
  ): ResourceResult<Json>;
  /** Makes a Templates that can use only the themes and files picked for this preset. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read'>;
}

/**
 * Works out exactly what saving one theme or recipe would store, saving nothing. `input` is the
 * request body as sent (`{ admission, assets }`); it is checked here. Fails with `invalid-input` at
 * `resources` for a malformed body, or with the mistake of Templates, theme translation or the
 * selector.
 */
export function preparePreset(
  input: unknown,
  snapshot: Snapshot,
  dependencies: PreparationDependencies,
): ResourceResult<PresetPreparation> {
  const normalized = normalizeInput(input, snapshot, dependencies);
  if (!normalized.ok) return normalized;
  const planned = planPreset(normalized.value, snapshot, dependencies);
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
  dependencies: PreparationDependencies,
): ResourceResult<NormalizedInput> {
  const input = preparationInput.safeParse(raw);
  if (!input.success) return invalidInputFailure();
  const catalog = readStoredCatalog(snapshot, dependencies);
  if (!catalog.ok) return catalog;
  const normalized = dependencies.translateTheme(
    input.data.admission,
    catalog.value,
    input.data.assets,
  );
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
  if (!admission.success) return invalidInputFailure();
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
  dependencies: PreparationDependencies,
): ResourceResult<PlannedPreset> {
  const request = buildSelectionRequest(
    { ...normalized.input, admission: normalized.admission },
    snapshot,
  );
  if (!request.ok) return request;
  const selected = dependencies.selector.select(request.value, snapshot);
  if (!selected.ok) return selected;
  return readPlanned(normalized, dependencies.templates(selected.value.resources));
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
  if (!record.success) return invalidInputFailure();
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
  const original = presetFields.safeParse(admission);
  if (!original.success) return invalidInputFailure();
  return success({ ...original.data, source: preset.payload.source });
}

/**
 * The preset's record key, `preset:<digest>`. Fails with `invalid-input` at `resources` when it is
 * not an Authoring record ID.
 */
function presetKey(pin: PresetPin): ResourceResult<RecordKey> {
  const id = recordId.safeParse(presetRecordId(pin.digest));
  if (!id.success) return invalidInputFailure();
  return success({ kind: 'preset', id: id.data });
}

/** Every preset and workspace record, deleted ones included, at the version read. Never fails. */
function catalogReads(snapshot: Snapshot): PresetPreparation['reads'] {
  return snapshot.records
    .filter((item) => ['preset', 'workspace'].includes(item.key.kind))
    .map((item) => ({ key: item.key, version: item.version }));
}
