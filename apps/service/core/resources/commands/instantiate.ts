/*
 * Recipe instantiation: one stored recipe expanded with its selected resources and printed as DSL
 * source. Pure over the injected owners; Language owns all identity remapping. A refusal throws
 * PreparationFault or zod's error (`guarded` in refusal.ts turns both into a ResourceResult), and
 * Authoring owns the canonical write and receipt.
 */
import type {
  Language,
  LanguageError,
  LoweredIntent,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capabilities.js';
import { instantiateInput } from '../../../contract/records/presets/preparation.js';
import type { ResourceSelector } from '../../../contract/records/planning/selection.js';
import { selectionRequest, storedCatalog, unboundTemplates } from './catalog.js';
import { PreparationFault, accepted } from './refusal.js';

/** The owners instantiation works through. */
export interface InstantiateOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
  readonly language: Pick<Language, 'print'>;
  /** Templates bound to one call's resolved resources. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'read' | 'instantiate'>;
}

/**
 * Expansion uses exact stored recipe source and normalized resource bindings. Throws zod's error
 * for a malformed input; PreparationFault with `invalid-input` at `preset.kind` for a non-recipe
 * pin, at `language` for an unprintable expansion, or with the owner's diagnostic when Templates or
 * the selector refuses.
 */
export function instantiate(
  raw: unknown,
  snapshot: Snapshot,
  owners: InstantiateOwners,
): string {
  const records = storedCatalog(snapshot, owners);
  const request = instantiateInput.parse(raw);
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
