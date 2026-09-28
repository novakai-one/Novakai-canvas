/*
 * Library test data: frozen fixture IDs and a fresh valid snapshot per call. Data only; the
 * result assertions live in `assertions.ts`. A fixture that fails to build fails the test run;
 * correct the fixture and rerun the tests.
 */
import {
  organisationIdSchema,
  collectionIdSchema,
  folderIdSchema,
  sectionIdSchema,
  objectIdSchema,
  type LibrarySnapshot,
  type OrganisationId,
  type FolderId,
  type CollectionId,
  type SectionId,
  type ObjectId,
} from '../contract/index.js';

/** The fixture IDs. The object is frozen, so no test can change an ID another test reads. */
export interface FixtureIds {
  readonly organisation: OrganisationId;
  /** Folder `engineering`. */
  readonly folder: FolderId;
  /** Folder `backend`, a child of `engineering`. */
  readonly child: FolderId;
  readonly alpha: CollectionId;
  readonly beta: CollectionId;
  readonly section: SectionId;
  readonly object: ObjectId;
}

/** Fixture IDs, checked with the public ID schemas (no private code is used). */
export const ids: FixtureIds = Object.freeze(checkedIds());

/**
 * A valid snapshot: organisation `organisation` (revision 7) with folder `engineering` and its child
 * `backend`; collection `alpha` ("Billing", revision 3) in `backend` with section `er` and the
 * unplaced object `invoice`; archived collection `beta` ("Architecture", revision 4) at the root;
 * `alpha` opened at 100 and `beta` at 200.
 *
 * Every field is given explicitly, so schema defaults never produce an expected value. A fresh
 * object is returned on every call.
 */
export function snapshot(): LibrarySnapshot {
  return {
    organisation: {
      schemaVersion: 1,
      id: ids.organisation,
      revision: 7,
      folders: [
        { id: ids.folder, title: 'Engineering', order: 0 },
        { id: ids.child, title: 'Backend', parent: ids.folder, order: 0 },
      ],
      entries: [
        { collection: ids.alpha, folder: ids.child, order: 0, archived: false },
        { collection: ids.beta, order: 1, archived: true },
      ],
    },
    collections: [
      {
        id: ids.alpha,
        revision: 3,
        title: 'Billing',
        description: 'Payments overview',
        sections: [{ id: ids.section, title: 'Database' }],
        objects: [
          {
            id: ids.object,
            label: 'Invoice',
            description: 'Unplaced financial record',
            visibleIn: [],
          },
        ],
      },
      {
        id: ids.beta,
        revision: 4,
        title: 'Architecture',
        description: 'Service topology',
        sections: [],
        objects: [],
      },
    ],
    recent: [
      { collection: ids.alpha, openedAt: 100 },
      { collection: ids.beta, openedAt: 200 },
    ],
  };
}

/** Checks each fixture ID with a schema of its kind; the folder schema is used for both folders. */
function checkedIds(): FixtureIds {
  const organisationIds = organisationIdSchema();
  const folderIds = folderIdSchema();
  const collectionIds = collectionIdSchema();
  const sectionIds = sectionIdSchema();
  const objectIds = objectIdSchema();
  return {
    organisation: organisationIds.parse('organisation'),
    folder: folderIds.parse('engineering'),
    child: folderIds.parse('backend'),
    alpha: collectionIds.parse('alpha'),
    beta: collectionIds.parse('beta'),
    section: sectionIds.parse('er'),
    object: objectIds.parse('invoice'),
  };
}
