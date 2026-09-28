import { expect, test } from 'vitest';
import { validate, type ContentBlock } from '../contract/index.js';
import { base, er, field, graph, node, rejects, relation, value } from './fixtures.js';

/**
 * Relationship endpoints: a missing target object (`reference`), a missing source member, a
 * cardinality on a flow, and `calls` to a non-callable target (`endpoint`) are rejected; a module
 * member may implement an interface; a note's text block is not a valid member endpoint.
 */
test('validate endpoint types', () => {
  // Check: a target object that does not exist.
  const missingTarget = relation('ab', 'a', 'missing');
  rejects(graph({ relationships: [missingTarget] }), 'reference', 'relationships.ab.target');

  // Check: a source member that does not exist.
  const missingMember = relation('ab', 'a', 'b', { source: { object: 'a', member: 'missing' } });
  rejects(graph({ relationships: [missingMember] }), 'endpoint', 'source.member');

  // Check: a flow with a cardinality.
  const flowWithCardinality = relation('ab', 'a', 'b', { from: '1' });
  rejects(graph({ relationships: [flowWithCardinality] }), 'endpoint', 'relationships.ab');

  // Check: `calls` to a step.
  const callsStep = relation('ab', 'a', 'b', { kind: 'calls' });
  rejects(graph({ relationships: [callsStep] }), 'endpoint', 'target');

  // Check: a module member may implement an interface.
  const objects = [
    node('module', 'module', {
      content: [{ kind: 'member', id: 'member', label: 'plan', type: 'Planner' }],
    }),
    node('interface', 'interface'),
  ];
  const implementsInterface = relation('impl', 'module', 'interface', {
    kind: 'implements',
    source: { object: 'module', member: 'member' },
  });
  const implemented = value(validate(base({ objects, relationships: [implementsInterface] })));
  expect(implemented.relationships[0]?.kind).toBe('implements');

  // Check: a note's text block is not a member endpoint.
  const noteText = base({
    objects: [
      node('a', 'note', { content: [{ kind: 'text', id: 'text', text: 'Hi' }] }),
      node('b'),
    ],
    relationships: [relation('ab', 'a', 'b', { source: { object: 'a', member: 'text' } })],
  });
  rejects(noteText, 'endpoint', 'source.member');
});

/**
 * ER keys: a composite foreign key must reference the parent's primary key fields in order and
 * in full, with no repeated field and no missing object; a single foreign key needs a reference;
 * a primary keygroup takes no references; an entity has one primary key; and a foreign key whose
 * type differs from the referenced key is rejected.
 */
test('validate ER keys', () => {
  // Check: the composite key is valid as built.
  expect(value(validate(composite())).objects).toHaveLength(2);

  // Check: references in the wrong order, or too few.
  const reversed = [
    { object: 'parent', member: 'id' },
    { object: 'parent', member: 'tenant' },
  ];
  rejects(composite({ references: reversed }), 'key', 'objects.child.content.fk');
  const partial = [{ object: 'parent', member: 'tenant' }];
  rejects(composite({ references: partial }), 'key', 'objects.child.content.fk');

  // Check: a repeated field, then a reference to a missing object.
  rejects(composite({ fields: ['tenant', 'tenant'] }), 'duplicate', 'objects.child.content.fk');
  const missingObject = [
    { object: 'parent', member: 'tenant' },
    { object: 'missing', member: 'id' },
  ];
  rejects(composite({ references: missingObject }), 'reference', 'objects.child.content.fk');

  // Check: a foreign field without a reference.
  const unreferenced = node('a', 'entity', { content: [field('id', { key: 'foreign' })] });
  rejects(base({ objects: [unreferenced] }), 'key', 'objects.a.content.id');

  // Check: a primary keygroup with references.
  const primaryWithReferences = node('a', 'entity', {
    content: [
      field('id'),
      { kind: 'keygroup', id: 'pk', key: 'primary', fields: ['id'], references: [] },
    ],
  });
  rejects(base({ objects: [primaryWithReferences] }), 'key', 'objects.a.content.pk');

  // Check: two primary keys on one entity.
  const twoPrimaryKeys = node('a', 'entity', {
    content: [field('id', { key: 'primary' }), field('other', { key: 'primary' })],
  });
  rejects(base({ objects: [twoPrimaryKeys] }), 'key', 'objects.a.content');

  // Check: the foreign key's type no longer matches the referenced key.
  const valid = value(validate(er()));
  const retyped = {
    ...valid,
    objects: valid.objects.map(
      /** Changes the type of the object's `customer` field. */
      (object) => ({
        ...object,
        content: object.content.map(
          /** Changes the block's type if it is the `customer` field. */
          (block) => alteredType(block),
        ),
      }),
    ),
  };
  rejects(retyped, 'key', 'objects.order');
});

/**
 * Content payloads: a field on a note, a table row with the wrong number of cells, and a member
 * on a note are `content` errors; step number 0 is a shape error; two steps may share a number.
 */
test('validate content payloads', () => {
  // Check: a field on a note.
  rejects(
    base({ objects: [node('a', 'note', { content: [field('id')] })] }),
    'content',
    'objects.a.content.id',
  );

  // Check: a row with one cell in a two-column table.
  const shortRow = {
    kind: 'table',
    id: 'table',
    columns: ['A', 'B'],
    rows: [{ id: 'row', cells: ['one'] }],
  };
  rejects(
    base({ objects: [node('a', 'note', { content: [shortRow] })] }),
    'content',
    'objects.a.content.table.row',
  );

  // Check: a member on a note.
  const member = { kind: 'member', id: 'member', label: 'x', type: 'string' };
  rejects(
    base({ objects: [node('a', 'note', { content: [member] })] }),
    'content',
    'objects.a.content.member',
  );

  // Check: step 0, then two steps numbered 1.
  rejects(base({ objects: [node('a', 'step', { step: 0 })] }), 'shape', 'objects');
  const sameStep = base({
    objects: [node('a', 'step', { step: 1 }), node('b', 'step', { step: 1 })],
  });
  const steps = value(validate(sameStep)).objects.map(
    /** The object's step number. */
    (object) => object.step,
  );
  expect(steps).toEqual([1, 1]);
});

/**
 * Builds two entities: `parent` with primary keygroup `pk` over `tenant` and `id`, and `child`
 * with foreign keygroup `fk` over `tenant` and `parent` referencing them in order.
 *
 * @param extra - Fields added to or overriding the `fk` keygroup.
 * @returns The collection data (unvalidated).
 */
function composite(extra: Readonly<Record<string, unknown>> = {}) {
  return base({
    objects: [
      node('parent', 'entity', {
        content: [
          field('tenant'),
          field('id'),
          { kind: 'keygroup', id: 'pk', key: 'primary', fields: ['tenant', 'id'] },
        ],
      }),
      node('child', 'entity', {
        content: [
          field('tenant'),
          field('parent'),
          {
            kind: 'keygroup',
            id: 'fk',
            key: 'foreign',
            fields: ['tenant', 'parent'],
            references: [
              { object: 'parent', member: 'tenant' },
              { object: 'parent', member: 'id' },
            ],
            ...extra,
          },
        ],
      }),
    ],
  });
}

/**
 * Returns a copy of the `customer` block with type `Different`; any other block as it is.
 *
 * @param block - A content block.
 * @returns The block, retyped if it is `customer`.
 */
function alteredType(block: ContentBlock) {
  if ('id' in block && block.id === 'customer') {
    return { ...block, type: 'Different' };
  }
  return block;
}
