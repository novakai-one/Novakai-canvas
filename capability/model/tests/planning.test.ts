/** Public Model scenarios are replayable; Vitest owns assertion reporting and the developer corrects regressions before rerunning. */
import { expect, test } from 'vitest';
import { plan, validate, type Section } from '../contract/index.js';
import {
  base,
  er,
  graph,
  layout,
  manual,
  node,
  objectAt,
  placed,
  rejectsPlan,
  relation,
  section,
  sectionAt,
  value,
} from './fixtures.js';

/**
 * Changes apply in order and may break references for a while: a relationship created before
 * its objects is fine once they exist. Impact is reported by record list, not by change order.
 * A batch whose final candidate is invalid is rejected and leaves the input unchanged; an invalid
 * snapshot is rejected.
 */
test('plan ordered atomic changes', () => {
  // Act: create the relationship first, then its two objects.
  const changes = [
    { op: 'create', target: 'relationships', value: relation() },
    { op: 'create', target: 'objects', value: node('a') },
    { op: 'create', target: 'objects', value: node('b') },
  ];
  const result = value(plan(base(), changes));

  // Check: both objects exist; objects are reported before relationships.
  const objectIds = result.candidate.objects.map(
    /** The object's ID. */
    (object) => object.id,
  );
  expect(objectIds).toEqual(['a', 'b']);
  expect(result.impact).toEqual([
    { target: 'objects', id: 'a', action: 'added' },
    { target: 'objects', id: 'b', action: 'added' },
    { target: 'relationships', id: 'ab', action: 'added' },
  ]);

  // Check: removing `b` leaves relationship `ab` dangling, so the plan fails; input unchanged.
  const before = graph();
  const copy = structuredClone(before);
  const danglingBatch = [
    { op: 'replace', target: 'objects', value: node('a', 'step', { label: 'Changed' }) },
    { op: 'remove', target: 'objects', id: 'b' },
  ];
  // An empty path text matches any path.
  rejectsPlan(before, danglingBatch, 'reference', '');
  expect(before).toEqual(copy);

  // Check: an invalid snapshot.
  rejectsPlan(base({ schemaVersion: 2 }), [], 'shape', 'schemaVersion');
});

/**
 * Record identity rules: create needs a new ID, replace and remove need an existing one,
 * replace-document keeps the collection ID and revision, unknown operations and more than 1,000
 * changes are shape errors. A valid replace keeps revision 0 and reports one update.
 */
test('enforce operation identity', () => {
  // Check: each identity failure.
  const createExisting = [{ op: 'create', target: 'objects', value: node('a') }];
  rejectsPlan(graph(), createExisting, 'already-exists', 'objects.a');
  const replaceMissing = [{ op: 'replace', target: 'objects', value: node('missing') }];
  rejectsPlan(graph(), replaceMissing, 'not-found', 'objects.missing');
  const removeMissing = [{ op: 'remove', target: 'sources', id: 'missing' }];
  rejectsPlan(graph(), removeMissing, 'not-found', 'sources.missing');
  const otherId = [{ op: 'replace-document', value: graph({ id: 'other' }) }];
  rejectsPlan(graph(), otherId, 'identity', 'collection');
  const otherRevision = [{ op: 'replace-document', value: graph({ revision: 1 }) }];
  rejectsPlan(graph(), otherRevision, 'identity', 'collection');

  // Check: an unknown operation, then 1,001 changes (an empty path text matches any path).
  rejectsPlan(graph(), [{ op: 'whatever' }], 'shape', '');
  const tooMany = Array.from(
    { length: 1001 },
    /** One replace-document change. */
    () => ({ op: 'replace-document', value: base() }),
  );
  rejectsPlan(base(), tooMany, 'shape', '');

  // Check: a valid relabel.
  const relabel = [
    { op: 'replace', target: 'objects', value: node('a', 'step', { label: 'Edited' }) },
  ];
  const result = value(plan(graph(), relabel));
  expect(result.candidate.revision).toBe(0);
  expect(objectAt(result.candidate, 'a').label).toBe('Edited');
  expect(result.impact).toEqual([{ target: 'objects', id: 'a', action: 'updated' }]);
});

/**
 * Hand-made geometry survives a semantic section replace (section, appearance and group
 * placements, the locked manual route). `reset-layout` clears it all, and a replace after the
 * reset does not bring it back; an explicit placement in the replacement wins. `reset-route`
 * clears one route only. replace-document keeps routes. A group that newly represents an object
 * inherits that object's placement.
 */
test('preserve and reset manual overrides', () => {
  // Check: a replace without geometry keeps the old geometry.
  const replacement = { op: 'replace', target: 'sections', value: semanticSection() };
  const retained = plannedPlacedView([replacement]);
  expect(retained.placement).toEqual({ x: 5, y: 7, locked: true });
  expect(retained.appearances[0]?.placement).toEqual({ x: 10, y: 20, locked: false });
  expect(retained.groups[0]?.placement).toEqual({ x: 0, y: 0, locked: false });
  expect(retained.wires[0]).toMatchObject({ manual, locked: true });

  // Check: reset then replace — nothing comes back.
  const reset = { op: 'reset-layout', section: 'view' };
  const resetThenReplace = plannedPlacedView([reset, replacement]);
  expect(resetThenReplace.placement).toBeUndefined();
  expectNestedOverridesCleared(resetThenReplace);

  // Check: reset then an explicit placement — the explicit one wins.
  const explicit = { ...replacement, value: { ...semanticSection(), placement: { x: 70, y: 80 } } };
  const resetThenExplicit = plannedPlacedView([reset, explicit]);
  expect(resetThenExplicit.placement).toMatchObject({
    x: 70,
    y: 80,
  });
  expectNestedOverridesCleared(resetThenExplicit);

  // Check: an explicit placement then reset — the reset wins.
  const explicitThenReset = plannedPlacedView([explicit, reset]);
  expect(explicitThenReset.placement).toBeUndefined();
  expectNestedOverridesCleared(explicitThenReset);

  // Check: reset-route clears only the route.
  const resetRoute = [{ op: 'reset-route', section: 'view', relationship: 'ab' }];
  const route = plannedPlacedView(resetRoute);
  expect(route.wires[0]).not.toHaveProperty('manual');
  expect(route.wires[0]?.locked).toBe(false);
  expect(route.placement).toMatchObject({ x: 5, y: 7 });

  // Check: replace-document keeps the route.
  const replacedDocument = value(plan(placed(), [{ op: 'replace-document', value: graph() }]));
  expect(sectionAt(replacedDocument.candidate).wires[0]).toMatchObject({ manual, locked: true });

  // Check: group `container` newly represents `a` and inherits a's placement.
  const represented = section('view', 'flow', {
    groups: [{ id: 'container', title: 'Container', represents: 'a', layout: layout() }],
    appearances: [{ object: 'b' }],
    wires: [{ relationship: 'ab' }],
  });
  const representedPlan = value(
    plan(placed(), [{ op: 'replace', target: 'sections', value: represented }]),
  );
  expect(sectionAt(representedPlan.candidate).groups[0]?.placement).toMatchObject({ x: 10, y: 20 });
});

/**
 * delete-object needs `cascade` when something depends on the object; with it, the relationship
 * and wire go too and impact lists each list's change. `hide` removes only the appearance and its
 * wires. Deleting a referenced ER entity turns the foreign key into an ordinary field, and the
 * result is valid. Hiding in a missing section is `not-found`.
 */
test('delete and hide with explicit impact', () => {
  // Check: delete without cascade, then with it.
  rejectsPlan(graph(), [{ op: 'delete-object', id: 'a' }], 'delete-referenced', 'objects.a');
  const deleted = value(plan(graph(), [{ op: 'delete-object', id: 'a', cascade: true }]));
  const remainingIds = deleted.candidate.objects.map(
    /** The object's ID. */
    (object) => object.id,
  );
  expect(remainingIds).toEqual(['b']);
  expect(deleted.candidate.relationships).toEqual([]);
  expect(sectionAt(deleted.candidate).wires).toEqual([]);
  expect(deleted.impact).toEqual([
    { target: 'objects', id: 'a', action: 'removed' },
    { target: 'relationships', id: 'ab', action: 'removed' },
    { target: 'sections', id: 'view', action: 'updated' },
  ]);

  // Check: hide keeps the object and relationship, drops the appearance and wire.
  const hidden = value(plan(graph(), [{ op: 'hide', section: 'view', object: 'a' }]));
  expect(hidden.candidate.objects).toHaveLength(2);
  expect(hidden.candidate.relationships).toHaveLength(1);
  const shownObjects = sectionAt(hidden.candidate).appearances.map(
    /** The appearance's object. */
    (appearance) => appearance.object,
  );
  expect(shownObjects).toEqual(['b']);
  expect(sectionAt(hidden.candidate).wires).toEqual([]);

  // Check: deleting `customer` clears order's foreign key; the result validates.
  const foreign = value(plan(er(), [{ op: 'delete-object', id: 'customer', cascade: true }]));
  expect(objectAt(foreign.candidate, 'order').content).toEqual([
    { id: 'customer', kind: 'field', label: 'customer', type: 'Id', nullable: false },
  ]);
  expect(value(validate(foreign.candidate)).objects).toHaveLength(1);

  // Check: a missing section.
  rejectsPlan(
    base(),
    [{ op: 'hide', section: 'missing', object: 'a' }],
    'not-found',
    'sections.missing',
  );
});

/**
 * Builds section `view` with `a`, `b`, group `g` and wire `ab`, and no geometry at all.
 *
 * @returns The section data.
 */
function semanticSection() {
  return section('view', 'flow', {
    appearances: [{ object: 'a' }, { object: 'b' }],
    groups: [{ id: 'g', title: 'G', layout: layout() }],
    wires: [{ relationship: 'ab' }],
  });
}

/**
 * Checks that no appearance or group has a placement and every wire has no manual route and is
 * unlocked.
 *
 * @param view - A planned section.
 */
function expectNestedOverridesCleared(view: Section) {
  view.appearances.forEach(
    /** Checks one appearance. */
    (appearance) => expect(appearance).not.toHaveProperty('placement'),
  );
  view.groups.forEach(
    /** Checks one group. */
    (group) => expect(group).not.toHaveProperty('placement'),
  );
  view.wires.forEach(
    /** Checks one wire. */
    (wire) => {
      expect(wire).not.toHaveProperty('manual');
      expect(wire.locked).toBe(false);
    },
  );
}

/**
 * Plans the changes against {@link placed} and returns the candidate's `view` section.
 *
 * @param changes - The change batch.
 * @returns The planned `view` section.
 * @throws AssertionError when the plan fails or has no `view` section.
 */
function plannedPlacedView(changes: readonly unknown[]): Section {
  return sectionAt(value(plan(placed(), changes)).candidate);
}
