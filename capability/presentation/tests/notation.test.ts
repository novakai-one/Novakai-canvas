import { it, expect, assert } from 'vitest';
import { fixture, collection, object, section, value, domain } from './fixtures.js';
/** Symbol assertions use independently specified ER notation, not production lookup values. */
it('5 retains independently chosen crow-foot endpoints and required wire labels', async (): Promise<void> => {
  const app = (await fixture()).presentation;
  const source = collection({
    objects: [
      keyedEntity('Customer', ['Campus code', 'Student number']),
      keyedEntity('Order', ['Loan branch', 'Loan number']),
      keyedEntity('tenant-id', ['Archive code', 'Archive number']),
    ],
    relationships: [
      {
        id: 'places',
        kind: 'association',
        label: 'places',
        source: { object: 'Customer', member: 'tenant-id' },
        target: { object: 'Order', member: 'local-id' },
        from: '1',
        to: '0..many',
      },
    ],
    sections: [
      section('er', ['Customer', 'Order', 'tenant-id'], { wires: [{ relationship: 'places' }] }),
      section('er', [], { id: 'compact', appearances: [{ object: 'Order', detail: 'summary' }] }),
    ],
  });
  const canonical = value(domain(source));
  const before = JSON.stringify(canonical);
  const projection = value(app.project(canonical));
  const wire = projection.sections[0]?.wires[0];
  expect(JSON.stringify(canonical)).toBe(before);
  expect(value(app.project(canonical)).inputKey).toBe(projection.inputKey);
  [
    ['Customer', 'Campus code', 'Student number'],
    ['Order', 'Loan branch', 'Loan number'],
    ['tenant-id', 'Archive code', 'Archive number'],
  ].forEach(([id, first, second]): void => {
    const node = projection.sections[0]?.nodes.find((node): boolean => node.objectId === id);
    assert(node);
    const captions = [`PK (${second}, ${first})`, `FK (${second}, ${first})`];
    captions.forEach((caption): void => {
      expect(node.content.outline).toContain(caption);
      expect(projection.outline).toContain(caption);
    });
    const rendered = value(app.renderContent(node));
    expect(rendered).toContain(`PK (${second}, ${first})`);
    expect(rendered).toContain(`FK (${second}, ${first})`);
    expect(rendered).toContain('NamespaceCode');
    expect(rendered).toContain('RecordNumber');
    expect(node.content.anchors.map((anchor): string => anchor.member)).toEqual([
      'tenant-id',
      'local-id',
    ]);
    expect(node.content.outline.join(' ')).not.toContain('PK (local-id');
  });
  const compact = projection.sections[1]?.nodes[0];
  assert(compact);
  expect(compact.content.outline).toContain('FK (Loan number, Loan branch)');
  expect(value(app.renderContent(compact))).toContain('PK (Loan number, Loan branch)');
  expect(compact.content.anchors.map((anchor): string => anchor.member)).toEqual([
    'tenant-id',
    'local-id',
  ]);
  expect(compact.content.anchors.every((anchor): boolean => anchor.collapsed)).toBe(true);
  expect(wire?.source.member).toBe('tenant-id');
  expect(wire?.target.member).toBe('local-id');
  expect(wire).toMatchObject({
    sourceMarker: 'one',
    targetMarker: 'zero-many',
    kind: 'association',
  });
  expect(wire?.label.outline).toEqual(['places']);
  const paint = { fill: '#ffffff', stroke: '#000000', text: '#000000' };
  const one = value(app.marker('one', paint));
  expect(one.match(/<path/g) ?? []).toHaveLength(2);
  expect(one).not.toContain('<circle');
  const optional = value(app.marker('zero-one', paint));
  expect(optional.match(/<path/g) ?? []).toHaveLength(1);
  expect(optional.match(/<circle/g) ?? []).toHaveLength(1);
  const many = value(app.marker('one-many', paint));
  expect(many).toContain('M 0 -6 L -12 0 L 0 6 M -12 0 L 0 0');
  expect(many.match(/<path/g) ?? []).toHaveLength(2);
  const zeroMany = value(app.marker('zero-many', paint));
  expect(zeroMany).toContain('<circle');
  expect(zeroMany).toContain('M 0 -6');
  expect(app.marker('invented', paint)).toMatchObject({ ok: false });
});

/** Repeated descendant IDs and an object/field namespace collision must resolve through the canonical owner. */
function keyedEntity(
  id: string,
  labels: readonly [string, string],
): unknown {
  return object(id, 'entity', [
    { kind: 'keygroup', id: 'pk', key: 'primary', fields: ['local-id', 'tenant-id'] },
    { kind: 'field', id: 'tenant-id', label: labels[0], type: 'NamespaceCode' },
    { kind: 'field', id: 'local-id', label: labels[1], type: 'RecordNumber' },
    {
      kind: 'keygroup',
      id: 'fk',
      key: 'foreign',
      fields: ['local-id', 'tenant-id'],
      references: [
        { object: 'Customer', member: 'local-id' },
        { object: 'Customer', member: 'tenant-id' },
      ],
    },
  ]);
}
