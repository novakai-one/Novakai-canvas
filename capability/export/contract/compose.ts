/*
 * Composition root for the real Export service: binds Presentation's React drawing, the native
 * encoders (resvg PNG, PDFKit PDF, fonts, images), the HTML reader and bundle building to the
 * host's snapshot, document and resource providers.
 */
import { initWasm } from '@resvg/resvg-wasm';
import { decompressFont } from '../adapters/native/woff2.js';
import type { ReactBindings, SceneRenderer } from './render-types.js';
import type { Dependencies, Export, TransferDependencies } from './types.js';
import type { SnapshotReader } from './ports/snapshot.js';
import type { FormatRegistry } from './ports/formats.js';
import type { Result } from './errors.js';
import { failure } from './errors.js';
import { createExport } from './api.js';
import { createEncoding } from '../adapters/native/encoding.js';
import { createNodeDrawing } from '../adapters/svg/nodes.js';
import { createMarkerDrawing } from '../adapters/svg/markers.js';
import { createWireDrawing } from '../adapters/svg/wires.js';
import { createSequenceDrawing } from '../adapters/svg/sequence.js';
import { createSceneRenderer } from '../adapters/svg/scene.js';
import { createPngEncoder } from '../adapters/native/png.js';
import { createPdfEncoder } from '../adapters/native/pdf.js';
import { createFontDecoder } from '../adapters/native/fonts.js';
import { createMediaConverter } from '../adapters/native/media.js';
import { createHtmlEncoder } from '../adapters/html/document.js';
import { buildBundle } from '../core/bundles/manifest.js';
import { success } from '../core/validation/outcomes.js';

/**
 * What the host supplies to compose Export: the document and resource providers, the snapshot
 * reader, Presentation's React bindings and the HTML reader stylesheet. Export supplies its own
 * native encoding.
 */
export interface ExportOwners extends Omit<TransferDependencies, 'encoding'> {
  /** Leases requested revisions. */
  readonly snapshots: SnapshotReader;

  /** Presentation's React drawing, fonts, font definitions and markers. */
  readonly presentation: ReactBindings;

  /** CSS embedded in HTML exports. */
  readonly readerCss: string;

  /** Draw every wire label, including ones the diagram hides by default. */
  readonly allLabels?: boolean;
}

/** The composed Export: the service plus the pieces hosts and tests reuse. */
export interface ExportBindings {
  /** The Export service. */
  readonly service: Export;

  /** The dependencies the service was built with (including the five format handlers). */
  readonly dependencies: Dependencies;

  /** The SVG scene renderer the handlers share. */
  readonly renderer: SceneRenderer;
}

/**
 * Initializes the resvg WASM runtime that PNG export needs. Call it once per process, at host
 * startup, before the first PNG export.
 *
 * @param module - The compiled resvg WASM module.
 * @returns Success, or `encoding-failed` if initialization fails. A second call after a
 * successful one also fails, because resvg allows only one initialization per process. After a
 * failed call the host may call it again.
 * @throws Never.
 */
export async function initializeRaster(module: WebAssembly.Module): Promise<Result<void>> {
  try {
    await initWasm(module);
    return success(undefined);
  } catch {
    return failure('encoding-failed', 'composition.wasm', 'Raster runtime initialization failed');
  }
}

/**
 * Builds the real Export service. Presentation's drawing slots, the scene renderer, native
 * encoding and the five format handlers are created once here, not per export. Export has no
 * notation of its own; everything is drawn with Presentation's components.
 *
 * @param owners - The host's providers and Presentation bindings.
 * @returns The service, its dependencies and the shared renderer.
 * @throws Only if reading a host binding throws (for example a throwing getter, or a
 * `presentation.fonts` that is not an array). With plain bindings it never throws.
 */
export function composeExport(owners: ExportOwners): ExportBindings {
  const drawings = createNodeDrawing(owners.presentation);
  const Marker = createMarkerDrawing(owners.presentation);
  const renderer = createSceneRenderer(
    {
      ...drawings,
      wire: createWireDrawing(drawings.label, Marker),
      sequence: createSequenceDrawing(drawings.label, Marker),
    },
    owners.presentation.FontDefinitions,
    owners.presentation.fonts.map(/** The pinned font's digest. */ (font) => font.digest),
    owners.allLabels === true,
  );
  const encoding = createEncoding();
  const transfer = { documents: owners.documents, resources: owners.resources, encoding };
  const formats = createFormats(owners, renderer, transfer);
  const dependencies = { ...transfer, snapshots: owners.snapshots, formats };
  return { service: createExport(dependencies), dependencies, renderer };
}

/**
 * Creates one handler per format: SVG from the renderer, PNG through resvg, PDF through PDFKit
 * with decoded fonts and converted images, HTML with the reader CSS, and bundles built by
 * Export's core.
 */
function createFormats(
  owners: ExportOwners,
  renderer: SceneRenderer,
  transfer: TransferDependencies,
): FormatRegistry {
  const render = { renderer, encoding: transfer.encoding };
  const fonts = createFontDecoder(owners.presentation.fonts, decompressFont);
  return {
    svg: {
      encode: /** Renders the selection as SVG and encodes it as UTF-8. */ async (input) => {
        const result = renderer.render(input);
        if (!result.ok) return result;
        return success({
          bytes: transfer.encoding.utf8(result.value),
          pages: [],
          warnings: [],
        });
      },
    },
    png: createPngEncoder(render, fonts),
    pdf: createPdfEncoder({ renderer }, fonts, createMediaConverter()),
    html: createHtmlEncoder(render, owners.readerCss),
    bundle: {
      encode: /** Builds the portable bundle for the snapshot. */ (input) =>
        buildBundle(input.snapshot, transfer, input.signal),
    },
  };
}
