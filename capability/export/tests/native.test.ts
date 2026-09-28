/*
 * Concrete rendering through the real native encoders: the shared SVG, a real PNG (size,
 * glyph pixels, allocation limit), a real PDF (pages, overlap, painted footers, page limit),
 * the offline HTML page, and typed native faults.
 */
import { beforeAll, describe, it, expect, assert } from 'vitest';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-wasm';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { decompressFont } from '../adapters/native/woff2.js';
import type { Fixture } from './fixtures.js';
import { createExport } from '../contract/index.js';
import { createFontDecoder } from '../adapters/native/fonts.js';
import { createPdfEncoder } from '../adapters/native/pdf.js';
import { fixture, value, startRaster, failed, succeeded } from './fixtures.js';

beforeAll(startRaster);

describe('Concrete portable rendering', /** The native SVG, PNG, PDF and HTML tests. */ () => {
  /**
   * The SVG has no script, draws the `zero-many` marker, the wire label and the sequence message;
   * the sequence layer is stroked in the text colour, while the message label has no stroke and
   * sits on a white, non-empty backing rectangle. Its metadata holds revision 7, it has 3 nodes
   * and exactly one `<style>`.
   */
  async function sharedSvgRetainsContent(): Promise<void> {
    // Act: export the fixture as SVG and parse it.
    const f = await fixture();
    const artifact = value(await f.bindings.service.exportArtifact(f.request('svg')));
    const text = value(f.bindings.dependencies.encoding.text(artifact.bytes));
    const document = new JSDOM(text, { contentType: 'image/svg+xml' }).window.document;

    // Check: escaping, notation and sequence drawing.
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[data-marker="zero-many"]')).not.toBeNull();
    expect(document.querySelector('[data-wire="apply"] text')?.textContent).toBe(
      'validated changes',
    );
    expect(document.querySelector('[data-sequence-event="message"]')).not.toBeNull();
    expect(document.querySelector('[data-layer="sequence"]')?.getAttribute('stroke')).toBe(
      '#0f172a',
    );

    // Check: the message label's backing.
    const messageText = document.querySelector('[data-sequence-event="message"] text');
    assert(messageText);
    const labelLayer = messageText.closest('[stroke]');
    expect(labelLayer?.getAttribute('stroke')).toBe('none');
    const backing = labelLayer?.querySelector('rect');
    assert(backing);
    expect(backing.getAttribute('fill')).toBe('#ffffff');
    expect(Number(backing.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(backing.getAttribute('height'))).toBeGreaterThan(0);

    // Check: metadata, node count and styles.
    expect(document.querySelector('metadata')?.textContent).toContain('"revision":7');
    expect(document.querySelectorAll('[data-node-id]').length).toBe(3);
    expect(document.querySelectorAll('style')).toHaveLength(1);
  }

  it(
    '4 shared SVG retains labelled ER notation, nested nodes, sequence and escaped text',
    sharedSvgRetainsContent,
  );

  /**
   * The PNG starts with the PNG signature, is 1000 × 800, is not blank, and its group-header
   * area has dark glyph pixels identical to an independent resvg rendering of the same run (see
   * {@link interHeader}). Scale 4 still succeeds; a 9000-wide scene fails with `limit-exceeded`.
   */
  async function pngHasExactPixels(): Promise<void> {
    // Act: export the fixture as PNG.
    const f = await fixture();
    const image = value(await f.bindings.service.exportArtifact(f.request('png')));

    // Check: signature, size and contrast.
    expect([...image.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const metadata = await sharp(image.bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([1000, 800]);
    const stats = await sharp(image.bytes).stats();
    expect(stats.channels[0]?.stdev).toBeGreaterThan(10);

    // Check: the group header's glyph pixels.
    const exportedHeader = await sharp(image.bytes)
      .extract({ left: 52, top: 92, width: 180, height: 20 })
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer();
    expect(
      [...exportedHeader].filter(/** Whether the pixel is dark. */ (pixel) => pixel < 100).length,
    ).toBeGreaterThan(40);
    expect(exportedHeader).toEqual(await interHeader(f));

    // Check: scale 4 succeeds; a 9000-wide scene is over the allocation limit.
    const scaled = await f.bindings.service.exportArtifact({
      ...f.request('png'),
      scale: 4,
    });
    expect(scaled.ok).toBe(true);
    const snapshot = {
      ...f.snapshot,
      scene: { ...f.snapshot.scene, bounds: { x: 0, y: 0, width: 9000, height: 100 } },
    };
    const deps = {
      ...f.bindings.dependencies,
      snapshots: {
        acquire: /** Leases the wide snapshot; its release always succeeds. */ async () =>
          succeeded({
            snapshot,
            release: /** Succeeds without doing anything. */ async () => succeeded(undefined),
          }),
      },
    };
    expect(await createExport(deps).exportArtifact(f.request('png'))).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' },
    });
  }

  it(
    '5 actual PNG has exact dimensions, font-bearing pixels and bounded allocation',
    pngHasExactPixels,
  );

  /**
   * The PDF has one `/Page` per planned page (2), mentions revision 7, embeds an image, and
   * PDF.js reads the painted footers "revision 7 · 1/2" and "revision 7 · 2/2". The second page
   * starts one printable width minus the 16-unit overlap after the first, and together they
   * reach the section's right edge (920). Sections of 1,000,000 × 1,000,000 fail with
   * `limit-exceeded`.
   */
  async function pdfPaginatesWithFooters(): Promise<void> {
    // Act: export the fixture as PDF.
    const f = await fixture();
    const pdf = value(await f.bindings.service.exportArtifact(f.request('pdf')));
    const text = Buffer.from(pdf.bytes).toString('latin1');

    // Check: pages, metadata and painted footers.
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(pdf.pages.length);
    expect(pdf.pages.length).toBe(2);
    expect(text).toContain('revision 7');
    expect(text).toContain('/Subtype /Image');
    const footers = await paintedFooters(pdf.bytes);
    expect(footers).toHaveLength(2);
    expect(footers[0]).toContain('revision 7 · 1/2');
    expect(footers[1]).toContain('revision 7 · 2/2');

    // Check: page crops overlap and cover the section.
    const first = pdf.pages[0];
    const second = pdf.pages[1];
    expect(first?.crop.x).toBe(-80);
    expect(second?.crop.x).toBeCloseTo(-80 + (595.276 - 48) / 0.75 - 16);
    expect(
      pdf.pages.every(
        /** Whether the page footer names revision 7. */ (page) =>
          page.footer.includes('revision 7'),
      ),
    ).toBe(true);
    expect((second?.crop.x ?? 0) + (second?.crop.width ?? 0)).toBeGreaterThanOrEqual(920);

    // Check: huge sections are over the page limit.
    const snapshot = {
      ...f.snapshot,
      scene: {
        ...f.snapshot.scene,
        sections: f.snapshot.scene.sections.map(
          /** The section with a 1,000,000 × 1,000,000 box. */
          (section) => ({
            ...section,
            box: { ...section.box, width: 1000000, height: 1000000 },
          }),
        ),
      },
    };
    const tooMany = createExport({
      ...f.bindings.dependencies,
      snapshots: {
        acquire: /** Leases the huge snapshot; its release always succeeds. */ async () =>
          succeeded({
            snapshot,
            release: /** Succeeds without doing anything. */ async () => succeeded(undefined),
          }),
      },
    });
    expect(await tooMany.exportArtifact(f.request('pdf'))).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' },
    });
  }

  it(
    '6 actual WebP-bearing PDF paginates with complete overlap and source footer metadata',
    pdfPaginatesWithFooters,
  );

  /**
   * The HTML page links to `#section-0`, lists the wire label in its contents, has no script,
   * link or iframe element, inlines the WebP image as a data URL, and uses the collection
   * title as its heading.
   */
  async function htmlIsOffline(): Promise<void> {
    // Act: export the fixture as HTML and parse it.
    const f = await fixture();
    const artifact = value(await f.bindings.service.exportArtifact(f.request('html')));
    const text = value(f.bindings.dependencies.encoding.text(artifact.bytes));
    const document = new JSDOM(text).window.document;

    // Check: navigation, contents, no remote loads, inline image, heading.
    expect(document.querySelector('nav a')?.getAttribute('href')).toBe('#section-0');
    expect(document.querySelector('details')?.textContent).toContain('validated changes');
    expect(document.querySelectorAll('script,link,iframe').length).toBe(0);
    expect(document.querySelector('image')?.getAttribute('href')).toMatch(
      /^data:image\/webp;base64,/,
    );
    expect(document.querySelector('h1')?.textContent).toBe(f.snapshot.identity.title);
  }

  it(
    '7 offline HTML exposes navigation, measured outline and inline assets without script or remote fetch',
    htmlIsOffline,
  );

  /**
   * In order: a font decoder with no pinned fonts fails with `encoding-failed`; the real PDF
   * encoder with no fonts fails with `encoding-failed`; a PNG encoder that throws gives
   * `encoding-failed`; two differently named callers of the same service get the same digest;
   * a PDF encoder that returns a failure gives `encoding-failed`.
   */
  async function nativeFaultsAreTyped(): Promise<void> {
    // Arrange: a throwing PNG encoder and a font decoder with no fonts.
    const f = await fixture();
    const broken = {
      ...f.bindings.dependencies,
      formats: {
        ...f.bindings.dependencies.formats,
        png: {
          encode: /** Always throws. */ async () => {
            throw new Error('Native failed');
          },
        },
      },
    };
    const api = createExport(broken);
    const missingFonts = createFontDecoder(
      [],
      /** Returns the bytes unchanged. */ async (bytes) => bytes,
    );

    // Check: missing fonts, then the real PDF encoder with no fonts.
    expect(await missingFonts.decode()).toMatchObject({
      ok: false,
      error: { code: 'encoding-failed' },
    });
    const actualPdf = createPdfEncoder(
      { renderer: f.bindings.renderer },
      { decode: /** Returns no fonts. */ async () => succeeded([]) },
      { convert: /** Converts nothing. */ async () => succeeded(new Map()) },
    );
    const nativeFault = createExport({
      ...f.bindings.dependencies,
      formats: { ...f.bindings.dependencies.formats, pdf: actualPdf },
    });
    expect(await nativeFault.exportArtifact(f.request('pdf'))).toMatchObject({
      ok: false,
      error: { code: 'encoding-failed' },
    });

    // Check: the throwing PNG encoder.
    expect(await api.exportArtifact(f.request('png'))).toMatchObject({
      ok: false,
      error: { code: 'encoding-failed' },
    });

    // Check: two callers of the one service interface.
    const http = /** An HTTP-shaped caller. */ async (body: unknown) =>
      f.bindings.service.exportArtifact(body);
    const cli = /** A CLI-shaped caller. */ async (source: unknown) =>
      f.bindings.service.exportArtifact(source);
    expect(value(await http(f.request())).digest).toBe(value(await cli(f.request())).digest);

    // Check: a PDF encoder that returns a failure.
    const invalid = createExport({
      ...f.bindings.dependencies,
      formats: {
        ...f.bindings.dependencies.formats,
        pdf: { encode: /** Always fails. */ async () => failed() },
      },
    });
    expect(await invalid.exportArtifact(f.request('pdf'))).toMatchObject({
      ok: false,
      error: { code: 'encoding-failed' },
    });
  }

  it(
    '12 native faults are typed and headless/service-shaped callers share one interface',
    nativeFaultsAreTyped,
  );
});

/**
 * An independent rendering of the group header "Validation group": resvg draws the first node's
 * first text run with only that run's own pinned font bytes, bypassing Export's font aliasing,
 * into a 180 × 20 area. Returns its greyscale pixels.
 */
async function interHeader(fixture: Fixture): Promise<Buffer> {
  // Arrange: the run and its decompressed font.
  const node = fixture.snapshot.scene.sections[0]?.nodes[0];
  const run = node?.measured.content.primitives.find(
    /** Whether the primitive is text. */ (primitive) => primitive.kind === 'text',
  );
  assert(run);
  expect(run.text).toBe('Validation group');
  const font = fixture.snapshot.resources.find(
    /** Whether this is the run's font. */ (resource) => resource.digest === run.font.digest,
  );
  assert(font);
  const decoded = await decompressFont(font.bytes);

  // Act: render the run directly.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="20" viewBox="12 12 180 20">' +
    '<rect x="12" y="12" width="180" height="20" fill="#ffffff"/>' +
    `<text x="${run.x}" y="${run.y}" font-family="${String(font.metadata.family)}"` +
    ` font-size="${run.size}" fill="${run.fill}" textLength="${run.width}"` +
    ' lengthAdjust="spacingAndGlyphs">Validation group</text></svg>';
  const renderer = new Resvg(svg, { font: { fontBuffers: [decoded] } });
  try {
    return await headerPixels(renderer);
  } finally {
    renderer.free();
  }
}

/**
 * Renders and returns the image's greyscale pixels (not its signature or metadata). The pixels
 * are copied out before the native image is freed.
 */
async function headerPixels(renderer: InstanceType<typeof Resvg>): Promise<Buffer> {
  const image = renderer.render();
  try {
    return await sharp(image.asPng()).removeAlpha().greyscale().raw().toBuffer();
  } finally {
    image.free();
  }
}

/**
 * The footer text PDF.js reads from each page's actual content, in page order. Planned page
 * records or document metadata cannot satisfy this check.
 */
async function paintedFooters(bytes: Uint8Array): Promise<readonly string[]> {
  const loading = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
  });
  const document = await loading.promise;
  try {
    return await Promise.all(
      Array.from(
        { length: document.numPages },
        /** The footer of page `index + 1`. */ (_, index) => readFooter(document, index + 1),
      ),
    );
  } finally {
    await loading.destroy();
  }
}

/**
 * The text drawn in the bottom footer band of one page (baseline at most 45 PDF points from the
 * bottom), joined in content order.
 */
async function readFooter(
  document: Awaited<ReturnType<typeof getDocument>['promise']>,
  number: number,
): Promise<string> {
  const page = await document.getPage(number);
  const content = await page.getTextContent();
  return content.items
    .flatMap(
      /** The item's text when it is a text item in the footer band; otherwise nothing. */
      (item) => {
        if (!('str' in item)) return [];
        const baseline = item.transform[5];
        if (baseline > 45) return [];
        return [item.str];
      },
    )
    .join('');
}
