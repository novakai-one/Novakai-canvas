/*
 * Figure composition in export: a frame-free figure keeps Presentation's measured text and
 * media positions in the SVG, and PNG raster size rounds fractional bounds up to whole pixels.
 */
import { assert, expect, it, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { createExport } from '../contract/index.js';
import { fixture, value, startRaster, type Fixture } from './fixtures.js';

beforeAll(startRaster);

/**
 * Exports the `media-top` fixture (no frame) as SVG and checks node `alpha`:
 * - it is marked `data-frame="none"` and draws no frame shape;
 * - its image sits at the measured media box (viewport offset plus image offset), at the
 *   measured size, with the measured data URL;
 * - its text sits at the measured text position, below the image, in the pinned font alias,
 *   reading "Agent & human".
 * Then checks the fractional-bounds PNG size (see {@link checkFractionalRaster}).
 */
async function exportsFrameFreeFigure(): Promise<void> {
  // Arrange: export the frame-free fixture as SVG and find node `alpha`.
  const setup = await fixture('media-top');
  const artifact = value(await setup.bindings.service.exportArtifact(setup.request('svg')));
  const svg = value(setup.bindings.dependencies.encoding.text(artifact.bytes));
  const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const node = setup.snapshot.scene.sections
    .flatMap(/** The section's nodes. */ (section) => section.nodes)
    .find(
      /** Whether the node draws object `alpha`. */
      (node) => node.measured.objectId === 'alpha',
    );
  assert(node);
  const rendered = document.querySelector(`[data-node-id="${node.id}"]`);
  assert(rendered);

  // Check: no frame.
  expect(rendered.getAttribute('data-frame')).toBe('none');
  expect(rendered.querySelector('rect,polygon')).toBeNull();

  // Check: the image at the measured media box.
  const media = node.measured.content.primitives.find(
    /** Whether the primitive is the media. */
    (item) => item.kind === 'media',
  );
  assert(media?.kind === 'media');
  const image = rendered.querySelector('image');
  assert(image);
  const viewport = image.parentElement;
  assert(viewport);
  expect(Number(viewport.getAttribute('x')) + Number(image.getAttribute('x'))).toBe(media.x);
  expect(Number(viewport.getAttribute('y')) + Number(image.getAttribute('y'))).toBe(media.y);
  expect(Number(viewport.getAttribute('width'))).toBe(media.width);
  expect(Number(viewport.getAttribute('height'))).toBe(media.height);
  expect(Number(image.getAttribute('width'))).toBe(media.width);
  expect(Number(image.getAttribute('height'))).toBe(media.height);
  expect(image.getAttribute('href')).toBe(media.dataUri);

  // Check: the text at the measured position, below the image, in the pinned font.
  const text = rendered.querySelector('text');
  const run = node.measured.content.primitives.find(
    /** Whether the primitive is a text run. */
    (item) => item.kind === 'text',
  );
  assert(text && run?.kind === 'text');
  expect(Number(text.getAttribute('x'))).toBe(run.x);
  expect(Number(text.getAttribute('y'))).toBe(run.y);
  expect(run.y).toBeGreaterThan(media.y + media.height);
  expect(text.getAttribute('font-family')).toBe(`canvas-${run.font.digest}`);
  expect(text.textContent).toBe('Agent & human');

  // Check: fractional bounds round up to whole pixels.
  await checkFractionalRaster(setup);
}

it(
  'exports frame-free measured figures with the same text and media coordinates',
  exportsFrameFreeFigure,
);

/**
 * Exports a PNG at scale 1.3 of a snapshot whose scene bounds are fractional (1000.4 × 800.2)
 * and checks the image is 1301 × 1041: Export's PNG encoder rounds each side up itself, rather
 * than relying on the native renderer's rounding.
 */
async function checkFractionalRaster(setup: Pick<Fixture, 'bindings' | 'snapshot'>): Promise<void> {
  const snapshot = {
    ...setup.snapshot,
    scene: { ...setup.snapshot.scene, bounds: { x: 0, y: 0, width: 1000.4, height: 800.2 } },
  };
  const exporter = createExport({
    ...setup.bindings.dependencies,
    snapshots: {
      acquire: /** Leases the fractional snapshot; its release always succeeds. */ async () => ({
        ok: true,
        value: {
          snapshot,
          release: /** Succeeds without doing anything. */ async () => ({
            ok: true,
            value: undefined,
          }),
        },
      }),
    },
  });
  const artifact = value(
    await exporter.exportArtifact({
      identity: { collectionId: snapshot.identity.collectionId, revision: 7 },
      format: 'png',
      scale: 1.3,
    }),
  );
  const pixels = await sharp(artifact.bytes).metadata();
  expect([pixels.width, pixels.height]).toEqual([1301, 1041]);
}
