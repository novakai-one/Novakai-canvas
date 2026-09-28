/*
 * Library search over one snapshot: filters, paging with cursors, sorting, and equal frozen
 * results for every consumer.
 * A failing test changes nothing outside the test; correct the code or the test and rerun.
 */
import { describe, expect, test } from 'vitest';
import { queryLibrary, type SearchHit } from '../contract/index.js';
import { snapshot, ids } from './fixtures.js';
import { valueOf, diagnosticsOf, isDeepFrozen } from './assertions.js';

describe('Library search', () => {
  /**
   * Text search ignores case and extra spaces and matches labels and descriptions, including
   * objects in no section. Folder, archive and kind filters narrow the results; a missing folder
   * is `unknown-id`.
   */
  function findsWithinFilters(): void {
    const base = snapshot();
    const found = valueOf(
      queryLibrary({ snapshot: base, request: { text: '  INVOICE financial ' } }),
    );
    expect(found.hits).toEqual([
      {
        kind: 'object',
        collection: ids.alpha,
        id: ids.object,
        label: 'Invoice',
        description: 'Unplaced financial record',
        visibleIn: [],
      },
    ]);
    const payments = valueOf(queryLibrary({ snapshot: base, request: { text: 'payments' } }));
    expect(payments.hits[0]?.description).toBe('Payments overview');

    // `alpha` is in `backend`, a child of `engineering`: found only with descendants.
    const direct = { folder: ids.folder };
    expect(valueOf(queryLibrary({ snapshot: base, request: direct })).total).toBe(0);
    const nested = { folder: ids.folder, descendants: true };
    expect(valueOf(queryLibrary({ snapshot: base, request: nested })).total).toBe(3);

    // Archived only: `beta`. Sections only: `er`, visible in itself.
    const archived = valueOf(queryLibrary({ snapshot: base, request: { archived: 'only' } }));
    expect(archived.hits.map((hit) => hit.collection)).toEqual([ids.beta]);
    const sections = { text: 'database', kinds: ['section'] };
    expect(valueOf(queryLibrary({ snapshot: base, request: sections })).hits[0]?.visibleIn).toEqual(
      [ids.section],
    );
    const missing = queryLibrary({ snapshot: base, request: { folder: 'missing' } });
    expect(diagnosticsOf(missing)).toEqual(['unknown-id query.folder']);
  }

  test(
    'finds labels and descriptions, including unplaced objects, within folder and archive filters',
    findsWithinFilters,
  );

  /**
   * Pages follow a stable order (collection, section, object); the last page has no `nextCursor`
   * key. A cursor fails with `invalid-cursor` after a source revision changes, with another page
   * size, or when it is not JSON. When the next cursor would exceed the size budget, the query
   * fails with `cursor-too-long` instead of returning it.
   */
  function pagesWithCursors(): void {
    const base = snapshot();
    const first = valueOf(queryLibrary({ snapshot: base, request: { limit: 1 } }));
    expect(first.hits.map(hitKind)).toEqual(['collection']);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBeTypeOf('string');
    const secondRequest = { limit: 1, cursor: first.nextCursor };
    const second = valueOf(queryLibrary({ snapshot: base, request: secondRequest }));
    expect(second.hits.map(hitKind)).toEqual(['section']);
    const thirdRequest = { limit: 1, cursor: second.nextCursor };
    const third = valueOf(queryLibrary({ snapshot: base, request: thirdRequest }));
    expect(third.hits.map(hitKind)).toEqual(['object']);
    expect(third).not.toHaveProperty('nextCursor');

    // Stale: the organisation revision changed; the page size changed; not JSON. A zero page size.
    const revised = { ...base, organisation: { ...base.organisation, revision: 8 } };
    expect(diagnosticsOf(queryLibrary({ snapshot: revised, request: secondRequest }))).toEqual([
      'invalid-cursor query.cursor',
    ]);
    const resized = { limit: 2, cursor: first.nextCursor };
    expect(diagnosticsOf(queryLibrary({ snapshot: base, request: resized }))).toEqual([
      'invalid-cursor query.cursor',
    ]);
    expect(
      diagnosticsOf(queryLibrary({ snapshot: base, request: { cursor: 'not-json' } })),
    ).toEqual(['invalid-cursor query.cursor']);
    expect(diagnosticsOf(queryLibrary({ snapshot: base, request: { limit: 0 } }))).toEqual([
      'invalid-input limit',
    ]);

    // An organisation ID over 1,000,000 characters makes the next cursor too long.
    const longId = 'x'.repeat(1_000_001);
    const huge = {
      organisation: {
        schemaVersion: 1,
        id: longId,
        revision: 0,
        folders: [],
        entries: [{ collection: 'c', order: 0, archived: false }],
      },
      collections: [
        { id: 'c', revision: 0, title: 'C', sections: [{ id: 's', title: 'S' }], objects: [] },
      ],
      recent: [],
    };
    expect(diagnosticsOf(queryLibrary({ snapshot: huge, request: { limit: 1 } }))).toEqual([
      'cursor-too-long query.cursor',
    ]);
  }

  test(
    'pages in a stable order, rejects stale cursors and refuses an oversized next cursor',
    pagesWithCursors,
  );

  /**
   * Two consumers (one passing the snapshot object, one a JSON copy) get equal results with no
   * clock or locale involved. `recent` sorts the latest visit first; `title` sorts by label.
   * Results are frozen throughout and are new objects, not the input's.
   */
  function sortsForEveryConsumer(): void {
    const base = snapshot();
    const request = { kinds: ['collection'], archived: 'include', sort: 'recent' };
    const browser = queryLibrary({ snapshot: base, request });
    const cli = queryLibrary({ snapshot: JSON.parse(JSON.stringify(base)), request });

    // `beta` (opened at 200) before `alpha` (100); the same result from both consumers.
    const recent = valueOf(browser);
    expect(recent.hits.map((hit) => hit.collection)).toEqual([ids.beta, ids.alpha]);
    expect(cli).toEqual(browser);
    const titled = valueOf(
      queryLibrary({ snapshot: base, request: { ...request, sort: 'title' } }),
    );
    expect(titled.hits.map((hit) => hit.label)).toEqual(['Architecture', 'Billing']);

    // Frozen throughout, and not the input's collection object.
    expect(isDeepFrozen(recent)).toBe(true);
    expect(recent.hits[0]).not.toBe(base.collections[1]);
  }

  test(
    'sorts by recent visit or title and gives every consumer the same frozen result',
    sortsForEveryConsumer,
  );
});

/** A hit's kind. */
function hitKind(hit: SearchHit): string {
  return hit.kind;
}
