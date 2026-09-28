/*
 * Portable bundle export and inspection: a bundle is deterministic and keeps resource bytes and
 * hashes, and inspection rejects the corruption cases listed in the tests (schema version,
 * source digest, duplicates, base64, resource digests, size limit, UTF-8, owner rejection)
 * instead of repairing them.
 */
import { describe, it, expect } from 'vitest';
import { createExport } from '../contract/index.js';
import { fixture, value, bundle, manifestBytes, encoding, failed } from './fixtures.js';

describe('Portable bundle integrity', /** The bundle determinism and corruption tests. */ () => {
  /**
   * Two bundle exports of the same snapshot are byte-identical; the manifest holds `canvas 1`
   * DSL with its own digest; inspection returns all 5 resources with the same digests as the
   * snapshot, and the stored placement of `alpha` (31, 42, locked).
   */
  async function preservesBundleBytesAndHashes(): Promise<void> {
    // Act: export the bundle twice.
    const f = await fixture();
    const first = value(await f.bindings.service.exportArtifact(f.request('bundle')));
    const second = value(await f.bindings.service.exportArtifact(f.request('bundle')));

    // Check: same bytes; DSL source and its digest.
    expect(first.bytes).toEqual(second.bytes);
    const manifest = bundle(first.bytes);
    expect(manifest.source).toMatch(/^canvas 1/);
    expect(manifest.sourceDigest).toBe(encoding.hash(encoding.utf8(manifest.source)));

    // Check: inspection keeps every resource and the manual placement.
    const inspection = value(await f.bindings.service.inspectBundle(first.bytes));
    expect(inspection.resources.length).toBe(5);
    expect(inspection.manual.sections[0]?.appearances[0]?.placement).toMatchObject({
      x: 31,
      y: 42,
      locked: true,
    });
    expect(
      inspection.resources.map(/** The resource's digest. */ (resource) => resource.digest).sort(),
    ).toEqual(
      f.snapshot.resources.map(/** The resource's digest. */ (resource) => resource.digest).sort(),
    );
  }

  it(
    '8 deterministic bundle preserves resource bytes and independent source/manual hashes',
    preservesBundleBytesAndHashes,
  );

  /**
   * Inspection rejects: an unknown schema version, source that no longer matches its digest,
   * duplicate resources, malformed base64, wrong resource digests, bytes over 128 MiB
   * (`limit-exceeded`), malformed UTF-8 (`invalid-bundle`), and a resource owner that rejects the
   * resources (`resource-rejected`).
   */
  async function rejectsCorruptBundles(): Promise<void> {
    // Arrange: a valid bundle and five corrupted copies of its manifest.
    const f = await fixture();
    const original = value(await f.bindings.service.exportArtifact(f.request('bundle')));
    const manifest = bundle(original.bytes);
    const resource = manifest.resources[0];
    expect(resource).toBeDefined();
    const corruptions = [
      { ...manifest, schemaVersion: 2 },
      { ...manifest, source: manifest.source + ' ' },
      { ...manifest, resources: [...manifest.resources, ...manifest.resources] },
      {
        ...manifest,
        resources: manifest.resources.map(
          /** The resource with malformed base64. */
          (item) => ({ ...item, base64: '!!!!' }),
        ),
      },
      {
        ...manifest,
        resources: manifest.resources.map(
          /** The resource with a wrong digest. */
          (item) => ({ ...item, digest: '0'.repeat(64) }),
        ),
      },
    ];

    // Check: every corrupted manifest is rejected.
    const results = await Promise.all(
      corruptions.map(
        /** Inspects one corrupted manifest. */
        (item) => f.bindings.service.inspectBundle(encoding.utf8(JSON.stringify(item))),
      ),
    );
    expect(results.every(/** Whether it was rejected. */ (result) => !result.ok)).toBe(true);

    // Check: oversized bytes and malformed UTF-8.
    expect(
      await f.bindings.service.inspectBundle(new Uint8Array(128 * 1024 * 1024 + 1)),
    ).toMatchObject({ ok: false, error: { code: 'limit-exceeded' } });
    expect(await f.bindings.service.inspectBundle(new Uint8Array([255]))).toMatchObject({
      ok: false,
      error: { code: 'invalid-bundle' },
    });

    // Check: a resource owner that rejects the resources.
    const rejecting = createExport({
      ...f.bindings.dependencies,
      resources: {
        inspect: /** Always rejects. */ async () => failed('resource-rejected'),
      },
    });
    expect(await rejecting.inspectBundle(manifestBytes(manifest))).toMatchObject({
      ok: false,
      error: { code: 'resource-rejected' },
    });
  }

  it(
    '9 corrupt versions, text, base64, hashes, duplicates and rejected owner validation fail closed',
    rejectsCorruptBundles,
  );
});
