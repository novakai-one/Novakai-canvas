/*
 * Export for one headless render: Presentation's React drawing over the document's fonts, and
 * Export composed over the one snapshot (a lease that always hands it back, and a resource
 * inspector that admits only the bytes it retained) and the injected documents port. Each section
 * exports in the request's format and label mode. Pure apart from Presentation's font loading.
 * Failures are values; core/render/render.ts owns recovery.
 */
import { createReactBindings } from '@novakai/canvas-presentation';
import { composeExport, type ExportBindings, type SnapshotReader } from '@novakai/canvas-export';
import type {
  ExportInput,
  RenderOutput,
  SectionExporter,
} from '../../contract/ports/render-output.js';
import type { RenderEvidence } from '../../contract/records/render-failure.js';
import type { LabelMode, RenderFormat } from '../../contract/records/render.js';
import type {
  Documents,
  ExportDiagnostic,
  ExportSnapshot,
  ResolvedResources,
  Resource,
  Resources,
} from '../../contract/records/foreign.js';
import type { SectionId } from '../../contract/brands.js';
import { success, type Result } from '../../contract/errors.js';

/** What Export needs from the render besides one snapshot. */
export interface ExportChoices {
  readonly format: RenderFormat;
  readonly labels: LabelMode;
  /** The documents port Export reads, prints and parses collections through, over `pins`. */
  documentsFor(pins: ResolvedResources): Documents;
}

/** The output port's Export. Builds nothing and cannot fail; `exporter` fails as {@link openExporter}. */
export function createExporter(choices: ExportChoices): Pick<RenderOutput, 'exporter'> {
  return { exporter: (input) => openExporter(input, choices) };
}

/**
 * Export over `input`'s snapshot, drawing with the document's fonts. Fails with Presentation's
 * font failure.
 */
async function openExporter(
  input: ExportInput,
  choices: ExportChoices,
): Promise<Result<SectionExporter, RenderEvidence>> {
  const presentation = await createReactBindings(input.document.fonts);
  if (!presentation.ok) return presentation;
  const exporter = composeExport({
    presentation: presentation.value,
    readerCss: '',
    allLabels: choices.labels === 'all',
    snapshots: lease(input.snapshot),
    documents: choices.documentsFor(input.pins),
    resources: resourceInspector(input.snapshot.resources),
  });
  return success({
    export: (section) => sectionBytes(exporter, input.snapshot, choices.format, section),
  });
}

/** A lease that hands back `snapshot`; releasing it does nothing. */
function lease(snapshot: ExportSnapshot): SnapshotReader {
  return {
    acquire: async () => success({ snapshot, release: async () => success(undefined) }),
  };
}

/** Export's `resource-rejected` refusal for a resource the snapshot did not retain. */
const unretained: ExportDiagnostic = Object.freeze({
  code: 'resource-rejected',
  path: 'snapshot.resources',
  message: 'Resource differs from its owner-admitted snapshot',
  recovery: 'Rebuild the snapshot through its resource owners and retry.',
});

/**
 * Export's resource port over the snapshot's `retained` resources: it admits a batch only when each
 * resource equals a retained one, byte for byte and in metadata. Refuses with `resource-rejected`.
 */
function resourceInspector(retained: readonly Resource[]): Resources {
  return {
    async inspect(items) {
      if (!items.every((item) => isRetained(item, retained)))
        return { ok: false, error: unretained };
      return success(items);
    },
  };
}

/** One section of the snapshot's collection in `format`. Fails with Export's diagnostic. */
async function sectionBytes(
  exporter: ExportBindings,
  snapshot: ExportSnapshot,
  format: RenderFormat,
  section: SectionId,
): Promise<Result<Uint8Array, RenderEvidence>> {
  const artifact = await exporter.service.exportArtifact({
    identity: { collectionId: snapshot.collection.id, revision: snapshot.collection.revision },
    format,
    scope: { kind: 'section', id: section },
  });
  if (!artifact.ok) return artifact;
  return success(artifact.value.bytes);
}

/** Whether `item` equals one retained resource. */
function isRetained(
  item: Resource,
  retained: readonly Resource[],
): boolean {
  return retained.some((candidate) => sameResource(item, candidate));
}

/** Same kind, digest, media type, bytes and metadata: no retained identity can be borrowed. */
function sameResource(
  left: Resource,
  right: Resource,
): boolean {
  return (
    left.kind === right.kind &&
    left.digest === right.digest &&
    left.mediaType === right.mediaType &&
    sameBytes(left.bytes, right.bytes) &&
    sameMetadata(left.metadata, right.metadata)
  );
}

/** Byte-for-byte equality. */
function sameBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The same keys, each with the same value. */
function sameMetadata(
  left: Resource['metadata'],
  right: Resource['metadata'],
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([key, value]) => hasEntry(right, key, value))
  );
}

/** Whether `record` holds `key` with exactly `value`. */
function hasEntry(
  record: Resource['metadata'],
  key: string,
  value: unknown,
): boolean {
  return Object.hasOwn(record, key) && Object.is(record[key], value);
}
