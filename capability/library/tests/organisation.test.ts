/*
 * Library snapshot validation: a snapshot's shape and the rules across its records, and the public
 * ID schema factories.
 * A failing test changes nothing outside the test; correct the code or the test and rerun.
 */
import { describe, expect, test } from 'vitest';
import {
  validateLibrarySnapshot,
  organisationIdSchema,
  collectionIdSchema,
  folderIdSchema,
  objectIdSchema,
  sectionIdSchema,
} from '../contract/index.js';
import { snapshot, ids } from './fixtures.js';
import { valueOf, diagnosticsOf, issueCodes } from './assertions.js';

describe('Library snapshot validation', () => {
  /**
   * A valid snapshot comes back parsed. Organisation entries and collections must match one to one:
   * a duplicate entry, an entry without a collection and a collection without an entry are each
   * reported at their path. An unknown schema version or an unknown top-level key is rejected.
   */
  function requiresOneEntryPerCollection(): void {
    const base = snapshot();
    const valid = valueOf(validateLibrarySnapshot(base));
    expect(valid.organisation.revision).toBe(7);
    expect(valid.organisation.entries).toHaveLength(2);

    // `alpha` listed twice.
    const duplicate = {
      ...base,
      organisation: {
        ...base.organisation,
        entries: [...base.organisation.entries, base.organisation.entries[0]],
      },
    };
    expect(diagnosticsOf(validateLibrarySnapshot(duplicate))).toEqual([
      'duplicate-id organisation.entries.alpha',
    ]);

    // Entries without collections (their visits too), then collections without entries.
    expect(diagnosticsOf(validateLibrarySnapshot({ ...base, collections: [] }))).toEqual([
      'broken-reference organisation.entries.alpha',
      'broken-reference organisation.entries.beta',
      'broken-reference recent.alpha',
      'broken-reference recent.beta',
    ]);
    const unlisted = { ...base, organisation: { ...base.organisation, entries: [] } };
    expect(diagnosticsOf(validateLibrarySnapshot(unlisted))).toEqual([
      'broken-reference collections.alpha',
      'broken-reference collections.beta',
    ]);

    // Shape: unknown schema version; unknown key (reported at the root, path '').
    const future = { ...base, organisation: { ...base.organisation, schemaVersion: 99 } };
    expect(diagnosticsOf(validateLibrarySnapshot(future))).toEqual([
      'invalid-input organisation.schemaVersion',
    ]);
    expect(diagnosticsOf(validateLibrarySnapshot({ ...base, extra: true }))).toEqual([
      'invalid-input ',
    ]);
  }

  test(
    'accepts a valid snapshot and requires one organisation entry per collection',
    requiresOneEntryPerCollection,
  );

  /**
   * Each folder in a parent cycle is reported. An object's visible section, and a recent visit's
   * collection, must exist. A negative visit time and duplicate collections are rejected.
   */
  function rejectsBrokenReferences(): void {
    const base = snapshot();

    // engineering → backend → engineering.
    const folders = [
      { id: ids.folder, title: 'Engineering', parent: ids.child, order: 0 },
      { id: ids.child, title: 'Backend', parent: ids.folder, order: 0 },
    ];
    expect(
      diagnosticsOf(
        validateLibrarySnapshot({ ...base, organisation: { ...base.organisation, folders } }),
      ),
    ).toEqual([
      'folder-cycle organisation.folders.engineering.parent',
      'folder-cycle organisation.folders.backend.parent',
    ]);

    // An object visible in a section that does not exist.
    const collections = base.collections.map((collection) => ({
      ...collection,
      objects: [{ id: ids.object, label: 'Invoice', description: '', visibleIn: ['missing'] }],
    }));
    expect(diagnosticsOf(validateLibrarySnapshot({ ...base, collections }))).toEqual([
      'broken-reference collections.alpha.objects.invoice.visibleIn.missing',
      'broken-reference collections.beta.objects.invoice.visibleIn.missing',
    ]);

    // Visits: to a missing collection, with a negative time; then duplicate collections.
    const missingVisit = { ...base, recent: [{ collection: 'missing', openedAt: 1 }] };
    expect(diagnosticsOf(validateLibrarySnapshot(missingVisit))).toEqual([
      'broken-reference recent.missing',
    ]);
    const negativeVisit = { ...base, recent: [{ collection: ids.alpha, openedAt: -1 }] };
    expect(diagnosticsOf(validateLibrarySnapshot(negativeVisit))).toEqual([
      'invalid-input recent.0.openedAt',
    ]);
    const twice = { ...base, collections: [...base.collections, ...base.collections] };
    expect(diagnosticsOf(validateLibrarySnapshot(twice))).toEqual([
      'duplicate-id collections.alpha',
      'duplicate-id collections.beta',
    ]);
  }

  test(
    'rejects folder cycles, missing sections or visited collections, and bad visits',
    rejectsBrokenReferences,
  );

  /**
   * Each ID schema factory returns a new schema object per call, so no consumer can change a
   * schema another consumer uses. Each accepts a plain ID and rejects empty text or a space. The
   * fixture IDs are frozen.
   */
  function buildsFreshIdSchemas(): void {
    const factories = [
      organisationIdSchema,
      folderIdSchema,
      collectionIdSchema,
      objectIdSchema,
      sectionIdSchema,
    ];
    expect(Object.isFrozen(ids)).toBe(true);
    for (const factory of factories) {
      expect(factory()).not.toBe(factory());
      expect(factory().safeParse('alpha')).toMatchObject({ success: true, data: 'alpha' });
      expect(issueCodes(factory().safeParse(''))).toEqual(['invalid_format']);
      expect(issueCodes(factory().safeParse('a b'))).toEqual(['invalid_format']);
    }
  }

  test(
    'builds a fresh ID schema per call that accepts IDs and rejects empty text',
    buildsFreshIdSchemas,
  );
});
