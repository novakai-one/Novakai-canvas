import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { harness } from './harness.js';
import { submission, png, svg, encoded, value, rejects, noReferences } from './fixtures.js';

/** Staging: accepted and rejected media, digests and reuse of stored bytes. */
describe('admission', () => {
  /**
   * A PNG is normalized with its measured size (2 × 3). Its digest is an independently computed
   * SHA-256 of the stored bytes, and `verify` accepts those bytes. Rejected: a PNG declared as
   * JPEG (`unsupported-media`), bytes that are not base64 and missing alt text (`invalid-input`).
   */
  it('decodes and normalizes raster bytes with exact dimensions and MIME checks', async () => {
    // Act: stage the PNG.
    const { assets } = harness();
    const admission = value(await assets.stage(submission()));
    // Check: descriptor facts.
    expect(admission.descriptor).toMatchObject({
      kind: 'image',
      mediaType: 'image/png',
      width: 2,
      height: 3,
      fontFamily: null,
    });
    expect(admission.descriptor.byteLength).toBeGreaterThan(0);
    // Check: the digest is the SHA-256 of the stored bytes, and verify accepts them.
    const resolved = value(assets.resolve(admission.descriptor.digest));
    const expectedHash = createHash('sha256');
    expectedHash.update(Buffer.from(resolved.base64, 'base64'));
    expect(admission.descriptor.digest).toBe(expectedHash.digest('hex'));
    value(await assets.verify(admission.descriptor.digest, resolved.base64));
    // Check: rejections.
    rejects(await assets.stage(submission(png, 'image/jpeg')), 'unsupported-media');
    rejects(await assets.stage(submission('%%%%')), 'invalid-input');
    rejects(await assets.stage({ ...submission(), alt: '' }), 'invalid-input');
  });

  /**
   * A safe SVG is kept as vector markup: 180 × 100 from its viewBox, the local marker reference
   * and the escaped text survive, and `verify` accepts the stored bytes.
   */
  it('retains safe SVG vector shapes, labels and resolved local markers', async () => {
    const { assets } = harness();
    const admission = value(await assets.stage(submission(encoded(svg), 'image/svg+xml')));
    expect(admission.descriptor).toMatchObject({
      kind: 'icon',
      mediaType: 'image/svg+xml',
      width: 180,
      height: 100,
    });
    // Check: the stored markup.
    const resolved = value(assets.resolve(admission.descriptor.digest));
    const xml = Buffer.from(resolved.base64, 'base64').toString();
    expect(xml).toContain('marker-end="url(#arrow)"');
    expect(xml).toContain('Authoring &amp; validation');
    value(await assets.verify(admission.descriptor.digest, resolved.base64));
  });

  /**
   * Every unsafe SVG is `unsafe-media`, and nothing was stored (collection finds no blobs).
   */
  it('rejects active external malformed and oversized SVG before durable admission', async () => {
    const { assets } = harness();
    const rejected = [
      // An escaped `url(` pointing at another file.
      String.raw`<svg width="1" height="1"><rect fill="u\72l(other.svg#paint)"/></svg>`,
      // Output over 1 MiB after escaping `>`.
      '<svg width="1" height="1"><desc>' + '>'.repeat(300000) + '</desc></svg>',

      // A script element.
      '<svg width="1" height="1"><script>alert(1)</script></svg>',
      // A DOCTYPE with an external entity.
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg width="1" height="1">&x;</svg>',
      // An external image.
      '<svg width="1" height="1"><image href="https://example.com/x"/></svg>',
      // A processing instruction.
      '<?xml-stylesheet href="https://example.com/x"?><svg width="1" height="1"/>',
      // An event handler.
      '<svg width="1" height="1" onload="alert(1)"/>',
      // A style attribute.
      '<svg width="1" height="1" style="fill:red"/>',
      // A reference to an ID that does not exist.
      '<svg width="1" height="1"><path fill="url(#missing)"/></svg>',
      // A duplicate ID.
      '<svg width="1" height="1"><g id="x"/><g id="x"/></svg>',
      // Nesting deeper than 64 levels.
      '<svg width="1" height="1">' + '<g>'.repeat(65) + '</g>'.repeat(65) + '</svg>',
      // Input over 1 MiB.
      '<svg width="1" height="1">' + ' '.repeat(1024 * 1024) + '</svg>',
    ];
    await Promise.all(
      // Stages each rejected SVG and checks it is `unsafe-media`.
      rejected.map(async (text) =>
        rejects(await assets.stage(submission(encoded(text), 'image/svg+xml')), 'unsafe-media'),
      ),
    );
    // Check: nothing was stored.
    expect(value(assets.collectUnreferenced(noReferences))).toEqual({
      removed: [],
      retained: [],
    });
  });

  /**
   * The bundled Inter WOFF2 font is admitted without alt text, keeps its exact bytes and reports
   * its family. The same bytes declared as TTF are `unsupported-media`; a broken WOFF2 is
   * `unsafe-media`.
   */
  it('admits a real offline font and rejects malformed or misdeclared formats', async () => {
    const fixture = harness();
    const base64 = fixture.font();
    const admission = value(
      await fixture.assets.stage({ ...submission(base64, 'font/woff2'), alt: '' }),
    );
    expect(admission.descriptor).toMatchObject({
      kind: 'font',
      fontFamily: 'Inter',
      width: null,
      height: null,
      mediaType: 'font/woff2',
    });
    expect(value(fixture.assets.resolve(admission.descriptor.digest)).base64).toBe(base64);
    // Check: rejections.
    rejects(await fixture.assets.stage(submission(base64, 'font/ttf')), 'unsupported-media');
    rejects(
      await fixture.assets.stage(submission(encoded('wOF2broken'), 'font/woff2')),
      'unsafe-media',
    );
  });

  /**
   * Staging the same bytes twice gives the same digest, while each admission keeps its own alt
   * text and provenance. The descriptor is frozen (only the descriptor is checked). With no
   * references and no leases, collection removes the blob.
   */
  it('reuses immutable bytes without overwriting caller-specific alt or provenance', async () => {
    const { assets } = harness();
    const first = value(await assets.stage(submission()));
    const second = value(
      await assets.stage({
        ...submission(),
        alt: 'Another description',
        provenance: { source: 'different-source' },
      }),
    );
    // Check: same bytes, separate metadata.
    expect(second.descriptor.digest).toBe(first.descriptor.digest);
    expect(first.alt).toBe('A blue two by three image');
    expect(second.alt).toBe('Another description');
    expect(second.provenance.source).toBe('different-source');
    expect(Object.isFrozen(first.descriptor)).toBe(true);
    // Check: unreferenced bytes are collected.
    expect(value(assets.collectUnreferenced(noReferences)).removed).toEqual([
      first.descriptor.digest,
    ]);
  });
});
