/** Public Model scenarios are replayable; Vitest owns assertion reporting and the developer corrects regressions before rerunning. */
import { expect, test, vi } from 'vitest';
import { validate } from '../contract/index.js';
import {
  base,
  digest,
  er,
  field,
  graph,
  layout,
  node,
  rejects,
  section,
  theme,
  value,
  type RawRecord,
} from './fixtures.js';

/**
 * An empty collection gets empty record lists; a mixed collection (a module with signature and
 * member blocks and a port; a note with text, code, list, image, icon, link and table blocks; an
 * asset and two sections) validates in object order; the ER fixture keeps its
 * cardinalities and member endpoints.
 */
test('accept empty and mixed collection', () => {
  // Check: an empty collection.
  expect(value(validate(base()))).toMatchObject({
    objects: [],
    sections: [],
    relationships: [],
    assets: [],
    sources: [],
  });

  // Check: a module with a signature, member and port, and a note with text, code, list, image,
  // icon, link and table blocks.
  const mixed = base({
    objects: [
      node('m', 'module', {
        content: [
          {
            id: 'signature',
            kind: 'signature',
            label: 'apply',
            parameters: ['input: Change'],
            returns: 'Result',
          },
          { id: 'member', kind: 'member', label: 'planner', type: 'Planner' },
        ],
        ports: [{ id: 'in', direction: 'in', label: 'apply', type: 'Change' }],
      }),
      node('explain', 'note', {
        step: 7,
        content: [
          { kind: 'text', id: 'text', text: '' },
          { kind: 'code', id: 'code', text: 'const x = 1', language: 'ts' },
          { kind: 'list', id: 'list', items: ['One', 'Two'] },
          { kind: 'image', id: 'image', asset: 'diagram' },
          { kind: 'icon', id: 'icon', asset: 'diagram' },
          {
            kind: 'link',
            id: 'link',
            label: 'Source',
            target: { kind: 'uri', uri: 'https://example.com' },
          },
          {
            kind: 'table',
            id: 'table',
            columns: ['Name'],
            rows: [{ id: 'row', cells: ['Model'] }],
          },
        ],
      }),
    ],
    assets: [{ id: 'diagram', digest, mediaType: 'image/svg+xml', alt: 'Model diagram' }],
    sections: [
      section('story', 'story', { appearances: [{ object: 'explain' }] }),
      section('modules', 'modules', { appearances: [{ object: 'm' }] }),
    ],
  });
  const mixedIds = value(validate(mixed)).objects.map(
    /** The object's ID. */
    (object) => object.id,
  );
  expect(mixedIds).toEqual(['m', 'explain']);

  // Check: the ER association.
  expect(value(validate(er())).relationships[0]).toMatchObject({
    from: '1',
    to: '0..many',
    source: { member: 'id' },
    target: { member: 'customer' },
  });
});

/**
 * Malformed input is a `shape` error (wrong version, extra field, bad revision, blank title, bad
 * ID, unsafe integer, non-plain objects, a cycle, an array-like object, a hidden field, an
 * `undefined` field, an unknown object kind). A getter is rejected without being called. Nesting
 * deeper than 64 levels and more than 100,000 values are `limit` errors. An invalid arrangement
 * direction and an infinite coordinate are `shape` errors.
 */
test('reject malformed and excessive inputs', () => {
  // Check: each malformed input.
  const arrayLike: unknown = Object.assign(Object.create(Array.prototype), base());
  const malformedInputs = [
    base({ schemaVersion: 2 }),
    base({ unexpected: 1 }),
    base({ revision: -1 }),
    base({ title: '  ' }),
    base({ id: 'not an id' }),
    base({ revision: Number.MAX_SAFE_INTEGER + 1 }),
    new Date(),
    cyclic(),
    arrayLike,
    Object.defineProperty(base(), 'unsupported', { value: 'must not disappear' }),
    base({ title: undefined }),
    base({ objects: [node('a', 'alien')] }),
  ];
  malformedInputs.forEach(
    /** Checks one input. An empty path text matches any path. */
    (input) => rejects(input, 'shape', ''),
  );

  // Check: a getter is never run.
  const getter = vi.fn(
    /** Returns an ID; must never be called. */
    () => 'demo',
  );
  rejects(Object.defineProperty({}, 'id', { get: getter }), 'shape', '$');
  expect(getter).not.toHaveBeenCalled();

  // Check: the depth and value limits.
  rejects(excessiveDepth(), 'limit', '$');
  const tooManyValues = Array.from(
    { length: 100001 },
    /** One value. */
    () => 1,
  );
  rejects(tooManyValues, 'limit', '$');

  // Check: an invalid arrangement direction, and an infinite coordinate.
  rejects(base({ arrangement: { ...layout(), direction: 'sideways' } }), 'shape', 'arrangement');
  const infinitePlacement = section('view', 'flow', { placement: { x: Infinity, y: 0 } });
  rejects(graph({ sections: [infinitePlacement] }), 'shape', 'sections');
});

/**
 * IDs are unique per scope: objects, sections, and descendants within one object (a port and a
 * table row, or two fields). An object and a source may share an ID.
 */
test('enforce scoped identities', () => {
  // Check: two objects `a`.
  rejects(graph({ objects: [node('a'), node('a')] }), 'duplicate', 'objects.a');

  // Check: a port and a table row both `row`.
  const portAndRow = node('a', 'note', {
    ports: [{ id: 'row', direction: 'in', label: 'In', type: 'T' }],
    content: [{ id: 'table', kind: 'table', columns: ['A'], rows: [{ id: 'row', cells: ['B'] }] }],
  });
  rejects(base({ objects: [portAndRow] }), 'duplicate', 'descendants.row');

  // Check: an object and a source may both be `same`.
  const sharedId = base({
    objects: [node('same')],
    sources: [{ id: 'same', uri: 'spec.md', status: 'asserted' }],
  });
  expect(value(validate(sharedId)).objects[0]?.id).toBe('same');

  // Check: two sections `view`, then two fields `id`.
  rejects(base({ sections: [section(), section()] }), 'duplicate', 'sections.view');
  const twoFields = node('a', 'entity', { content: [field('id'), field('id')] });
  rejects(base({ objects: [twoFields] }), 'duplicate', 'descendants.id');
});

/**
 * References resolve: an unknown role, a repeated theme role, a missing source, a missing asset,
 * and a link to a missing section are rejected; a repeated source on one object is a duplicate;
 * a known source keeps its revision.
 */
test('resolve references and roles', () => {
  // Check: roles.
  rejects(noteCollection({ role: 'unknown' }), 'reference', 'objects.a.role');
  rejects(base({ theme: { ...theme, roles: ['neutral', 'neutral'] } }), 'duplicate', 'theme.roles');

  // Check: a missing source, a missing asset, a link to a missing section.
  rejects(noteCollection({ sources: ['missing'] }), 'reference', 'objects.a.sources');
  const missingAsset = node('a', 'note', {
    content: [{ kind: 'image', id: 'pic', asset: 'missing' }],
  });
  rejects(base({ objects: [missingAsset] }), 'reference', 'objects.a.content.pic');
  const linkToMissingSection = node('a', 'note', {
    content: [
      {
        kind: 'link',
        id: 'link',
        label: 'A',
        target: { kind: 'object', id: 'a', section: 'missing' },
      },
    ],
  });
  rejects(base({ objects: [linkToMissingSection] }), 'reference', 'objects.a.content.link.section');

  // Check: a repeated source, then a valid one.
  const sources = [{ id: 'spec', uri: 'spec.md', status: 'source-backed', revision: 'v1' }];
  const repeatedSource = noteCollection({ sources: ['spec', 'spec'] }, { sources });
  rejects(repeatedSource, 'duplicate', 'objects.a.sources');
  const sourced = value(validate(noteCollection({ sources: ['spec'] }, { sources })));
  expect(sourced.sources[0]?.revision).toBe('v1');
});

/**
 * Builds a number nested in 66 arrays (deeper than the 64-level limit).
 *
 * @returns The nested value.
 */
function excessiveDepth(): unknown {
  return Array.from({ length: 66 }).reduce<unknown>(
    /** Wraps the value in one more array. */
    (value) => [value],
    0,
  );
}

/**
 * Builds an object that contains itself.
 *
 * @returns The cyclic object.
 */
function cyclic() {
  const object: { self?: unknown } = {};
  object.self = object;
  return object;
}

/**
 * Builds a collection whose only object is note `a`.
 *
 * @param noteFields - Fields to add to or override on the note.
 * @param collectionFields - Collection fields placed before `objects` (for example `sources`).
 * @returns The collection data (unvalidated).
 */
function noteCollection(
  noteFields: RawRecord,
  collectionFields: RawRecord = {},
): RawRecord {
  return base({ ...collectionFields, objects: [node('a', 'note', noteFields)] });
}
