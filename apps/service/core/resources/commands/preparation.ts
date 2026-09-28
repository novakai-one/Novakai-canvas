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
  StoredRecord,
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
import { success } from '../../../contract/errors.js';
import { listPresetFileDigests } from '../../presets/resources.js';
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
  const translated = translateInput(input, snapshot, dependencies);
  if (!translated.ok) {
    return translated;
  }
  const planned = planPreset(translated.value, snapshot, dependencies);
  if (!planned.ok) {
    return planned;
  }
  return buildPreparation(planned.value, snapshot);
}

/** An admission checked as JSON, as saving would store it. */
type AdmissionJson = PresetPreparation['admission'];

/** The checked request body, the stored catalog, and the admission translated against it. */
interface TranslatedInput {
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

/** The admission and the preset record, each checked as the JSON saving would store. */
interface SavedJson {
  readonly admission: AdmissionJson;
  readonly record: PresetPreparation['record'];
}

/** Checks the request body, reads the stored catalog, then translates the admission against it. */
function translateInput(
  body: unknown,
  snapshot: Snapshot,
  dependencies: PreparationDependencies,
): ResourceResult<TranslatedInput> {
  const input = preparationInput.safeParse(body);
  if (!input.success) {
    return invalidInputFailure();
  }
  const catalog = readStoredCatalog(snapshot, dependencies);
  if (!catalog.ok) {
    return catalog;
  }
  return translateAdmission(input.data, catalog.value, dependencies);
}

/** Translates a source-syntax theme into the form Templates checks, then checks it is JSON. */
function translateAdmission(
  input: PreparationInput,
  catalog: Catalog,
  dependencies: PreparationDependencies,
): ResourceResult<TranslatedInput> {
  const translated = dependencies.translateTheme(input.admission, catalog, input.assets);
  if (!translated.ok) {
    return translated;
  }
  const admission = json.safeParse(translated.value);
  if (!admission.success) {
    return invalidInputFailure();
  }
  return success({ input, catalog, admission: admission.data });
}

/** Asks the selector which themes and files the admission uses, then plans it with them. */
function planPreset(
  translated: TranslatedInput,
  snapshot: Snapshot,
  dependencies: PreparationDependencies,
): ResourceResult<PlannedPreset> {
  const selectionInput = { ...translated.input, admission: translated.admission };
  const request = buildSelectionRequest(selectionInput, snapshot);
  if (!request.ok) {
    return request;
  }
  const selected = dependencies.selector.select(request.value, snapshot);
  if (!selected.ok) {
    return selected;
  }
  const templates = dependencies.templates(selected.value.resources);
  return planWithTemplates(translated, templates);
}

/** Has Templates plan the admission, then reads the planned preset back from the new catalog. */
function planWithTemplates(
  translated: TranslatedInput,
  templates: Pick<Templates<LoweredIntent>, 'planAdmission' | 'read'>,
): ResourceResult<PlannedPreset> {
  const plan = templates.planAdmission(translated.catalog, translated.admission);
  if (!plan.ok) {
    return plan;
  }
  const preset = templates.read(plan.value.candidate, plan.value.pin);
  if (!preset.ok) {
    return preset;
  }
  return success({ admission: translated.admission, preset: preset.value, pin: plan.value.pin });
}

/** Builds the preparation: what saving would store, its key and files, and every record read. */
function buildPreparation(
  planned: PlannedPreset,
  snapshot: Snapshot,
): ResourceResult<PresetPreparation> {
  const saved = checkSavedJson(planned);
  if (!saved.ok) {
    return saved;
  }
  const key = presetKey(planned.pin);
  if (!key.ok) {
    return key;
  }
  const resources = listPresetFileDigests(planned.preset);
  const reads = catalogReads(snapshot);
  return success({
    admission: saved.value.admission,
    record: saved.value.record,
    pin: planned.pin,
    key: key.value,
    resources,
    reads,
  });
}

/** Checks the admission and the planned preset as the JSON that saving would store. */
function checkSavedJson(planned: PlannedPreset): ResourceResult<SavedJson> {
  const admission = admissionToSave(planned.admission, planned.preset);
  if (!admission.ok) {
    return admission;
  }
  const record = json.safeParse(planned.preset);
  if (!record.success) {
    return invalidInputFailure();
  }
  return success({ admission: admission.value, record: record.data });
}

/**
 * Keeps a theme admission as it is, and gives a recipe admission the planned recipe's source,
 * printed with its themes and local files fixed to exact versions.
 */
function admissionToSave(
  admission: AdmissionJson,
  preset: Preset,
): ResourceResult<AdmissionJson> {
  if (preset.kind === 'theme') {
    return success(admission);
  }
  const fields = presetFields.safeParse(admission);
  if (!fields.success) {
    return invalidInputFailure();
  }
  const printed = { ...fields.data, source: preset.payload.source };
  return success(printed);
}

/** Makes the key the preset is saved under, `preset:<digest>`, checked as a record ID. */
function presetKey(pin: PresetPin): ResourceResult<RecordKey> {
  const idText = presetRecordId(pin.digest);
  const id = recordId.safeParse(idText);
  if (!id.success) {
    return invalidInputFailure();
  }
  return success({ kind: 'preset', id: id.data });
}

/** Lists every preset and workspace record, deleted ones included, at the version read. */
function catalogReads(snapshot: Snapshot): PresetPreparation['reads'] {
  const catalogRecords = snapshot.records.filter(isCatalogRecord);
  return catalogRecords.map((record) => ({ key: record.key, version: record.version }));
}

/** Whether a stored record is a preset or the workspace record. */
function isCatalogRecord(record: StoredRecord): boolean {
  return record.key.kind === 'preset' || record.key.kind === 'workspace';
}
