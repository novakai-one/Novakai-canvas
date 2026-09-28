/*
 * Export's revision lifecycle: an export is pinned to the requested revision, releases every
 * lease it acquires exactly once, exposes no partial artifact on cancellation or provider
 * failure, and keeps section coordinates (negative origins, nested groups) intact.
 */
import { describe, it, expect, assert } from 'vitest';
import { createExport, type Dependencies } from '../contract/index.js';
import { createPdfEncoder } from '../adapters/native/pdf.js';
import { fixture, value, failed, succeeded } from './fixtures.js';

describe('Export revision lifecycle', /** The lifecycle, cancellation and bounds tests. */ () => {
  /**
   * An SVG export of revision 7 is pinned to revision 7, its digest is the hash of its bytes, and
   * its lease is released once. A request for revision 8 fails with `snapshot-mismatch` and still
   * releases its lease. A snapshot with 33 sections fails with `limit-exceeded`.
   */
  async function pinsRevisionAndReleasesLeases(): Promise<void> {
    // Act and check: a matching export, then a mismatched revision.
    const f = await fixture();
    const result = value(await f.bindings.service.exportArtifact(f.request()));
    expect(result.identity.revision).toBe(7);
    expect(result.digest).toBe(f.bindings.dependencies.encoding.hash(result.bytes));
    expect(f.releases()).toBe(1);
    const mismatch = await f.bindings.service.exportArtifact({
      identity: { collectionId: 'engineering', revision: 8 },
      format: 'svg',
    });
    expect(mismatch).toMatchObject({ ok: false, error: { code: 'snapshot-mismatch' } });
    expect(f.releases()).toBe(2);

    // Arrange: a snapshot with 33 copies of the first section.
    const section = f.snapshot.scene.sections[0];
    assert(section);
    const oversized = {
      ...f.snapshot,
      scene: {
        ...f.snapshot.scene,
        sections: Array.from(
          { length: 33 },
          /** A copy of the section with a numbered ID. */
          (_, index) => ({
            ...section,
            id: `section-${index}`,
          }),
        ),
      },
    };
    const dependencies: Dependencies = {
      ...f.bindings.dependencies,
      snapshots: {
        acquire: /** Leases the oversized snapshot; its release always succeeds. */ async () =>
          succeeded({
            snapshot: oversized,
            release: /** Succeeds without doing anything. */ async () => succeeded(undefined),
          }),
      },
    };

    // Check: the oversized scene is over the limit.
    expect(await createExport(dependencies).exportArtifact(f.request())).toMatchObject({
      ok: false,
      error: { code: 'limit-exceeded' },
    });
  }

  it(
    '1 pins revision, rejects mismatches and releases every acquired lease',
    pinsRevisionAndReleasesLeases,
  );

  /**
   * In order:
   * - an export cancelled before it starts fails with `cancelled` and acquires no lease;
   * - a failing SVG encoder gives `encoding-failed` with no `value`, and the lease is released;
   * - a PDF export cancelled while its fonts decode fails with `cancelled` before any media is
   *   converted;
   * - a lease whose release fails gives `cleanup-failed`, and release is called once;
   * - an export cancelled during encoding, whose release also fails, gives `cancelled` with the
   *   `cleanup-failed` failure attached.
   */
  async function exposesNoPartialArtifacts(): Promise<void> {
    // Check: cancelled before starting.
    const f = await fixture();
    expect(await f.bindings.service.exportArtifact(f.request(), { aborted: true })).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    });
    expect(f.releases()).toBe(0);

    // Check: a failing SVG encoder.
    const formats = {
      ...f.bindings.dependencies.formats,
      svg: { encode: /** Always fails. */ async () => failed() },
    };
    const encodedFailure = await createExport({
      ...f.bindings.dependencies,
      formats,
    }).exportArtifact(f.request());
    expect(encodedFailure).toMatchObject({ ok: false, error: { code: 'encoding-failed' } });
    expect(encodedFailure).not.toHaveProperty('value');
    expect(f.releases()).toBe(1);

    // Check: a PDF export cancelled while its fonts decode.
    const duringFonts = { aborted: false };
    let mediaCalls = 0;
    const pdf = createPdfEncoder(
      { renderer: f.bindings.renderer },
      {
        decode: /** Cancels the export, then returns no fonts. */ async () => {
          duringFonts.aborted = true;
          return succeeded([]);
        },
      },
      {
        convert: /** Counts the call and converts nothing. */ async () => {
          mediaCalls += 1;
          return succeeded(new Map());
        },
      },
    );
    const pdfService = createExport({
      ...f.bindings.dependencies,
      formats: { ...f.bindings.dependencies.formats, pdf },
    });
    expect(await pdfService.exportArtifact(f.request('pdf'), duringFonts)).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    });
    expect(mediaCalls).toBe(0);

    // Check: a lease whose release fails.
    const snapshot = f.snapshot;
    let count = 0;
    const deps: Dependencies = {
      ...f.bindings.dependencies,
      snapshots: {
        acquire:
          /** Leases the fixture snapshot; its release counts itself and fails. */ async () =>
            succeeded({
              snapshot,
              release: /** Counts the call and fails with `cleanup-failed`. */ async () => {
                count += 1;
                return failed('cleanup-failed');
              },
            }),
      },
    };
    expect(await createExport(deps).exportArtifact(f.request())).toMatchObject({
      ok: false,
      error: { code: 'cleanup-failed' },
    });
    expect(count).toBe(1);

    // Check: cancelled during encoding, with a failing release.
    const signal = { aborted: false };
    const cancelled = {
      ...formats,
      svg: {
        encode: /** Cancels the export, then returns one byte. */ async () => {
          signal.aborted = true;
          return succeeded({ bytes: new Uint8Array([1]), pages: [], warnings: [] });
        },
      },
    };
    expect(
      await createExport({ ...deps, formats: cancelled }).exportArtifact(f.request(), signal),
    ).toMatchObject({
      ok: false,
      error: { code: 'cancelled', cleanup: { code: 'cleanup-failed' } },
    });
  }

  it(
    '2 cancellation and provider failures expose no partial artifacts and release once',
    exposesNoPartialArtifacts,
  );

  /**
   * Exporting only section `flow` keeps the section's negative origin in the `viewBox`, moves the
   * section by its origin exactly once, and places the nested group's node at (40, 80). A missing
   * section fails with `missing-section`. Exporting everything gives the same bytes, since the
   * fixture has one section, and that section has a node inside a group.
   */
  async function preservesSectionBounds(): Promise<void> {
    // Act: export only section `flow`.
    const f = await fixture();
    const artifact = value(
      await f.bindings.service.exportArtifact({
        ...f.request(),
        scope: { kind: 'section', id: 'flow' },
      }),
    );
    const svg = value(f.bindings.dependencies.encoding.text(artifact.bytes));

    // Check: bounds and transforms.
    expect(svg).toContain('viewBox="-80 120 1000 800"');
    expect(svg.match(/translate\(-80 120\)/g)).toHaveLength(1);
    expect(svg).toContain('translate(40 80)');

    // Check: a missing section, then the whole-collection export.
    const missing = await f.bindings.service.exportArtifact({
      ...f.request(),
      scope: { kind: 'section', id: 'missing' },
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-section' } });
    const all = value(await f.bindings.service.exportArtifact(f.request()));
    expect(all.bytes).toEqual(artifact.bytes);
    assert(
      f.snapshot.scene.sections[0]?.nodes.some(
        /** Whether the node is inside a group. */ (node) => node.parent !== null,
      ),
    );
  }

  it(
    '3 selected bounds preserve negative origins and apply nested section transforms once',
    preservesSectionBounds,
  );
});
