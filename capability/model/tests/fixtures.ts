import { assert, expect } from 'vitest';
import {
  plan,
  validate,
  type Collection,
  type DiagnosticCode,
  type DiagramObject,
  type Mode,
  type Result,
  type Section,
} from '../contract/index.js';

/**
 * Raw, unvalidated record data. Builders spread overrides last and an override may replace any
 * field with any value (even `null`), so no field type is promised.
 */
export type RawRecord = Readonly<Record<string, unknown>>;

/** Layout intent as {@link layout} builds it (unvalidated). */
export interface RawLayout {
  readonly algorithm: string;
  readonly constraints: readonly unknown[];
}

/** A well-formed content digest (`sha256:` then `a` × 64), for themes and assets. */
export const digest = `sha256:${'a'.repeat(64)}`;

/** The `paper` theme pin every test collection uses, with six role names. */
export const theme = {
  id: 'paper',
  version: '1.0.0',
  digest,
  roles: ['neutral', 'primary', 'supporting', 'decision', 'success', 'warning'],
};

/** Two manual route points, used by the placed fixture and the route-preservation tests. */
export const manual = [
  { x: 10, y: 10 },
  { x: 100, y: 100 },
];

/**
 * Builds layout intent.
 *
 * @param algorithm - The layout algorithm (default `flow`).
 * @param constraints - The layout constraints (default none).
 * @returns `{ algorithm, constraints }`, unvalidated.
 */
export function layout(
  algorithm: string = 'flow',
  constraints: readonly unknown[] = [],
): RawLayout {
  return { algorithm, constraints };
}

/**
 * Builds an object whose label is its ID.
 *
 * @param id - The object ID.
 * @param kind - The object kind (default `step`).
 * @param extra - Fields to add or override, spread last.
 * @returns `{ id, kind, label: id, ...extra }`, unvalidated; `extra` may replace any field.
 */
export function node(
  id: string,
  kind: string = 'step',
  extra: RawRecord = {},
): RawRecord {
  return { id, kind, label: id, ...extra };
}

/**
 * Builds a `field` content block of type `Id` whose label is its ID.
 *
 * @param id - The block ID.
 * @param extra - Fields to add or override, spread last.
 * @returns `{ id, kind: 'field', label: id, type: 'Id', ...extra }`, unvalidated; `extra` may
 * replace any field.
 */
export function field(
  id: string,
  extra: RawRecord = {},
): RawRecord {
  return { id, kind: 'field', label: id, type: 'Id', ...extra };
}

/**
 * Builds a `flow` relationship labelled "continues".
 *
 * @param id - The relationship ID (default `ab`).
 * @param source - The source object (default `a`).
 * @param target - The target object (default `b`).
 * @param extra - Fields to add or override, spread last.
 * @returns `{ id, kind: 'flow', label: 'continues', source: { object: source }, target: { object:
 * target }, ...extra }`, unvalidated; `extra` may replace any field.
 */
export function relation(
  id: string = 'ab',
  source: string = 'a',
  target: string = 'b',
  extra: RawRecord = {},
): RawRecord {
  return {
    id,
    kind: 'flow',
    label: 'continues',
    source: { object: source },
    target: { object: target },
    ...extra,
  };
}

/**
 * Builds a section whose title is its ID and whose layout uses the algorithm the mode allows.
 *
 * @param id - The section ID (default `view`).
 * @param mode - The section mode (default `flow`).
 * @param extra - Fields to add or override, spread last.
 * @returns `{ id, title: id, mode, layout, ...extra }`, unvalidated; `extra` may replace any
 * field.
 */
export function section(
  id: string = 'view',
  mode: Mode = 'flow',
  extra: RawRecord = {},
): RawRecord {
  return { id, title: id, mode, layout: layout(algorithms[mode]), ...extra };
}

/**
 * Builds an empty collection `demo` at revision 0 with the paper theme and a grid arrangement.
 *
 * @param extra - Fields to add or override, spread last (for example `objects`).
 * @returns The collection data, unvalidated; `extra` may replace any field.
 */
export function base(extra: RawRecord = {}): RawRecord {
  return {
    schemaVersion: 1,
    id: 'demo',
    revision: 0,
    title: 'Demo',
    theme,
    arrangement: layout('grid'),
    ...extra,
  };
}

/**
 * Builds the smallest flow diagram: objects `a` and `b`, relationship `ab`, and a `view`
 * section showing both with the wire.
 *
 * @param extra - Collection fields to add or override, spread last.
 * @returns The collection data, unvalidated; `extra` may replace any field.
 */
export function graph(extra: RawRecord = {}): RawRecord {
  return base({
    objects: [node('a'), node('b')],
    relationships: [relation()],
    sections: [
      section('view', 'flow', {
        appearances: [{ object: 'a' }, { object: 'b' }],
        wires: [{ relationship: 'ab' }],
      }),
    ],
    ...extra,
  });
}

/**
 * Returns a successful result's value; fails the test (showing the result) otherwise. The result
 * is serialized with `JSON.stringify` BEFORE the check, on every call, even when it succeeded.
 *
 * @param result - A public Model result.
 * @returns Its value.
 * @throws AssertionError when the result is a failure; the message is the result as JSON.
 * @throws Whatever `JSON.stringify` throws for the result, before the check: a `TypeError` for a
 * cyclic or BigInt value, or any error thrown by a `toJSON` method.
 */
export function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

/**
 * Checks that a result was rejected, has no value, and has a diagnostic with `code` whose path
 * contains `path`.
 *
 * @param result - A public Model result.
 * @param code - The expected diagnostic code.
 * @param path - Text the diagnostic's path must contain.
 * @returns Nothing; the checks are the point.
 * @throws AssertionError when the result succeeded, has a value, or has no matching diagnostic.
 */
export function invalid(
  result: Result<unknown>,
  code: DiagnosticCode,
  path: string,
): void {
  assert(!result.ok, 'Expected rejected public result');
  expect(result).not.toHaveProperty('value');
  const expectedDiagnostic = expect.objectContaining({ code, path: expect.stringContaining(path) });
  expect(result.error.diagnostics).toEqual(expect.arrayContaining([expectedDiagnostic]));
}

/**
 * Checks that `validate` rejects the input (see {@link invalid}).
 *
 * @param input - Collection data.
 * @param code - The expected diagnostic code.
 * @param path - Text the diagnostic's path must contain.
 * @returns Nothing; the checks are the point.
 * @throws AssertionError as {@link invalid} does.
 */
export function rejects(
  input: unknown,
  code: DiagnosticCode,
  path: string,
): void {
  invalid(validate(input), code, path);
}

/**
 * Checks that `plan` rejects the changes (see {@link invalid}).
 *
 * @param input - The snapshot data.
 * @param changes - The change batch.
 * @param code - The expected diagnostic code.
 * @param path - Text the diagnostic's path must contain.
 * @returns Nothing; the checks are the point.
 * @throws AssertionError as {@link invalid} does.
 */
export function rejectsPlan(
  input: unknown,
  changes: unknown,
  code: DiagnosticCode,
  path: string,
): void {
  invalid(plan(input, changes), code, path);
}

/**
 * Returns the object with this ID; fails the test when there is none.
 *
 * @param collection - A validated collection.
 * @param id - The object ID.
 * @returns The object.
 * @throws AssertionError when no object has this ID.
 */
export function objectAt(
  collection: Collection,
  id: string,
): DiagramObject {
  const result = collection.objects.find(
    /** Tells whether this is the object. */
    (object) => object.id === id,
  );
  assert(result);
  return result;
}

/**
 * Returns the section with this ID; fails the test when there is none.
 *
 * @param collection - A validated collection.
 * @param id - The section ID (default `view`).
 * @returns The section.
 * @throws AssertionError when no section has this ID.
 */
export function sectionAt(
  collection: Collection,
  id: string = 'view',
): Section {
  const result = collection.sections.find(
    /** Tells whether this is the section. */
    (section) => section.id === id,
  );
  assert(result);
  return result;
}

/**
 * Builds an ER diagram: `customer` with primary key `id`, `order` with foreign key `customer`
 * referencing it, a one-to-many association `places` between those fields, and a `data` section.
 *
 * @returns The collection data (unvalidated).
 */
export function er(): RawRecord {
  const customerKey = field('id', { key: 'primary' });
  const orderKey = field('customer', {
    key: 'foreign',
    references: { object: 'customer', member: 'id' },
  });
  return base({
    objects: [
      node('customer', 'entity', { content: [customerKey] }),
      node('order', 'entity', { content: [orderKey] }),
    ],
    relationships: [
      relation('places', 'customer', 'order', {
        kind: 'association',
        from: '1',
        to: '0..many',
        source: { object: 'customer', member: 'id' },
        target: { object: 'order', member: 'customer' },
      }),
    ],
    sections: [
      section('data', 'er', {
        appearances: [{ object: 'customer' }, { object: 'order' }],
        wires: [{ relationship: 'places' }],
      }),
    ],
  });
}

/**
 * Builds {@link graph} with hand-made geometry in `view`: a locked section placement, a
 * placement on `a` (none on `b`), a placed group `g`, and a locked manual route on `ab`.
 *
 * @returns The collection data (unvalidated).
 */
export function placed(): RawRecord {
  return graph({
    sections: [
      section('view', 'flow', {
        placement: { x: 5, y: 7, locked: true },
        appearances: [{ object: 'a', placement: { x: 10, y: 20 } }, { object: 'b' }],
        groups: [{ id: 'g', title: 'G', layout: layout(), placement: { x: 0, y: 0 } }],
        wires: [{ relationship: 'ab', manual, locked: true }],
      }),
    ],
  });
}

/** The layout algorithm each mode's test section uses. */
const algorithms: Readonly<Record<Mode, string>> = {
  flow: 'flow',
  er: 'layered',
  modules: 'layered',
  tree: 'tree',
  sequence: 'sequence',
  state: 'flow',
  story: 'grid',
  grid: 'grid',
};
