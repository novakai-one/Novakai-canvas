/*
 * Library organisation planning: a batch of organisation changes applied to a snapshot without storing
 * anything, and the named-input boundary shared with search.
 * A failing test changes nothing outside the test; correct the code or the test and rerun.
 */
import { describe, expect, test } from 'vitest';
import {
  planMembership,
  planOrganisation,
  queryLibrary,
  type PlanInput,
  type QueryInput,
} from '../contract/index.js';
import { snapshot, ids } from './fixtures.js';
import { valueOf, hasFailure, diagnosticsOf, isDeepFrozen } from './assertions.js';

describe('Library organisation planning', () => {
  /**
   * Changes apply in order, and a change may name a folder a later change creates. The candidate
   * keeps revision 7 and is frozen throughout; the input is not changed. `changed` is the net
   * effect, so a batch that ends where it started is unchanged. Any failed change fails the whole
   * batch with no value.
   */
  function appliesChangesInOrder(): void {
    const base = snapshot();
    const original = JSON.stringify(base);
    // Move `alpha` into folder `new` before `new` is created.
    const changes = [
      {
        op: 'replace-entry',
        value: { collection: ids.alpha, folder: 'new', order: 9, archived: true },
      },
      { op: 'create-folder', value: { id: 'new', title: 'New' } },
    ];
    const result = valueOf(planOrganisation({ snapshot: base, changes }));
    expect(result.candidate.revision).toBe(7);
    expect(result.candidate.entries[0]).toEqual({
      collection: ids.alpha,
      folder: 'new',
      order: 9,
      archived: true,
    });
    expect(result.changed).toBe(true);
    expect(result.versions.collections).toEqual([
      { id: ids.alpha, revision: 3 },
      { id: ids.beta, revision: 4 },
    ]);
    expect(JSON.stringify(base)).toBe(original);
    expect(isDeepFrozen(result)).toBe(true);

    // Replacing an entry with itself, and undoing the batch within the batch: unchanged.
    const same = [{ op: 'replace-entry', value: base.organisation.entries[0] }];
    expect(valueOf(planOrganisation({ snapshot: base, changes: same })).changed).toBe(false);
    const undone = [...changes, ...same, { op: 'remove-folder', id: 'new' }];
    expect(valueOf(planOrganisation({ snapshot: base, changes: undone })).changed).toBe(false);

    // Failures: creating an existing folder; unregistering a missing entry at the end.
    const existing = [{ op: 'create-folder', value: { id: ids.folder, title: 'Duplicate' } }];
    expect(diagnosticsOf(planOrganisation({ snapshot: base, changes: existing }))).toEqual([
      'duplicate-id organisation.folders.engineering',
    ]);
    const absent = [...changes, { op: 'unregister', collection: 'absent' }];
    const failed = planOrganisation({ snapshot: base, changes: absent });
    expect(diagnosticsOf(failed)).toEqual(['unknown-id organisation.entries.absent']);
    expect(failed).not.toHaveProperty('value');
  }

  test(
    'applies changes in order and fails the whole batch on any failed change',
    appliesChangesInOrder,
  );

  /**
   * Registering or unregistering a collection needs the matching inventory from Authoring;
   * Library never adds or deletes a collection itself. Newer collection revisions alone do not
   * change the organisation.
   */
  function registersOnlyWithInventory(): void {
    const base = snapshot();
    const added = {
      id: 'gamma',
      revision: 0,
      title: 'New',
      description: '',
      sections: [],
      objects: [],
    };

    // Register `gamma`: rejected without it in the inventory, accepted with it.
    const register = [{ op: 'register', value: { collection: 'gamma' } }];
    expect(
      hasFailure(
        planOrganisation({ snapshot: base, changes: register }),
        'broken-reference',
        'organisation.entries.gamma',
      ),
    ).toBe(true);
    const withGamma = [...base.collections, added];
    const registered = valueOf(
      planMembership({ snapshot: base, changes: register, inventory: withGamma }),
    );
    expect(registered.candidate.entries.at(-1)?.collection).toBe('gamma');
    expect(registered.versions.collections).toHaveLength(2);

    // Unregister `beta`: rejected while `beta` is still in the inventory, accepted without it.
    const unregister = [{ op: 'unregister', collection: ids.beta }];
    expect(
      hasFailure(
        planOrganisation({ snapshot: base, changes: unregister }),
        'broken-reference',
        'collections.beta',
      ),
    ).toBe(true);
    const remaining = base.collections.filter((collection) => collection.id !== ids.beta);
    const removed = valueOf(
      planMembership({ snapshot: base, changes: unregister, inventory: remaining }),
    );
    expect(removed.candidate.entries.map((entry) => entry.collection)).toEqual([ids.alpha]);

    // Every collection one revision newer, no changes: organisation unchanged. `null` is rejected.
    const projected = base.collections.map((collection) => ({
      ...collection,
      revision: collection.revision + 1,
    }));
    const newer = { snapshot: base, changes: [], inventory: projected };
    expect(valueOf(planMembership(newer)).changed).toBe(false);
    const nulled = { snapshot: base, changes: [], inventory: null };
    expect(diagnosticsOf(planMembership(nulled))).toEqual(['invalid-input ']);
  }

  test(
    'registers or unregisters a collection only with the matching proposed inventory',
    registersOnlyWithInventory,
  );

  /**
   * A folder with contents is removed only under `rehome`, which moves its direct child folders
   * and entries to its parent. No collection is dropped. Deeper folders stay attached to their
   * own parent.
   */
  function removesOnlyUnderRehome(): void {
    const base = snapshot();
    const refused = [{ op: 'remove-folder', id: ids.folder }];
    expect(diagnosticsOf(planOrganisation({ snapshot: base, changes: refused }))).toEqual([
      'folder-not-empty organisation.folders.engineering',
    ]);

    // Remove `engineering`: `backend` moves to the root; entries are unchanged.
    const parent = [{ op: 'remove-folder', id: ids.folder, policy: 'rehome' }];
    const rehomed = valueOf(planOrganisation({ snapshot: base, changes: parent }));
    expect(rehomed.candidate.folders).toEqual([{ id: ids.child, title: 'Backend', order: 0 }]);
    expect(rehomed.candidate.entries).toEqual(base.organisation.entries);

    // Remove `backend`: `alpha` moves up to `engineering`; `beta` keeps its archive flag.
    const child = [{ op: 'remove-folder', id: ids.child, policy: 'rehome' }];
    const ungrouped = valueOf(planOrganisation({ snapshot: base, changes: child }));
    expect(ungrouped.candidate.entries[0]?.folder).toBe(ids.folder);
    expect(ungrouped.candidate.entries[1]?.archived).toBe(true);

    // Add `deep` under `backend`, then remove `engineering`: `deep` stays under `backend`.
    const deep = { id: 'deep', title: 'Deep', parent: ids.child, order: 0 };
    const grandchild = [
      { op: 'create-folder', value: deep },
      { op: 'remove-folder', id: ids.folder, policy: 'rehome' },
    ];
    const kept = valueOf(planOrganisation({ snapshot: base, changes: grandchild }));
    expect(kept.candidate.folders).toEqual([{ id: ids.child, title: 'Backend', order: 0 }, deep]);
  }

  test(
    'removes a folder with contents only under rehome, moving them to its parent',
    removesOnlyUnderRehome,
  );

  /**
   * Plan and search read their named inputs inside the failure boundary: an input whose
   * `snapshot` throws when read gives one `invalid-input` failure at `$`, never a thrown error.
   */
  function reportsThrowingInputs(): void {
    const planInput: PlanInput = {
      /** Throws on every read, like a revoked or hostile input. */
      get snapshot(): unknown {
        throw new Error('unreadable');
      },
      changes: [],
    };
    const queryInput: QueryInput = {
      /** Throws on every read, like a revoked or hostile input. */
      get snapshot(): unknown {
        throw new Error('unreadable');
      },
      request: {},
    };
    expect(diagnosticsOf(planOrganisation(planInput))).toEqual(['invalid-input $']);
    expect(diagnosticsOf(queryLibrary(queryInput))).toEqual(['invalid-input $']);
  }

  test('reports an input that throws when read as a shape failure', reportsThrowingInputs);
});
