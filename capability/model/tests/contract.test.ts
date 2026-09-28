import { expect, test } from 'vitest';
import { plan, validate, objectId, type ObjectId, type SectionId } from '../contract/index.js';
import { base, graph, node, objectAt, value } from './fixtures.js';

/**
 * Results are detached from the input, frozen (checked: the collection, its objects list and first
 * object, and the plan) and repeatable: validating and planning
 * never change the input, planning twice gives equal plans, changing the change batch afterwards
 * does not reach the plan, and branded IDs are not interchangeable at compile time.
 */
test('return detached immutable replayable results', () => {
  // Arrange: the input and a copy to compare against later.
  const input = graph();
  const before = structuredClone(input);

  // Check: validate returns a frozen, detached copy and leaves the input alone.
  const first = value(validate(input));
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.objects)).toBe(true);
  expect(Object.isFrozen(first.objects[0])).toBe(true);
  expect(first.objects).not.toBe(Reflect.get(input, 'objects'));
  expect(input).toEqual(before);

  // Act: plan the same relabel twice.
  const changes = [
    { op: 'replace', target: 'objects', value: node('a', 'step', { label: 'Edited' }) },
  ];
  const one = plan(input, changes);
  const two = plan(input, changes);

  // Check: equal, frozen plans; the input is unchanged.
  expect(one).toEqual(two);
  expect(input).toEqual(before);
  expect(Object.isFrozen(one)).toBe(true);

  // Check: editing the change afterwards does not reach the plan.
  Reflect.set(changes[0]?.value ?? {}, 'label', 'Later');
  expect(objectAt(value(one).candidate, 'a').label).toBe('Edited');

  // Check: a parsed ObjectId is an ObjectId, and not a SectionId.
  const identity = objectId.parse('same');
  const acceptsObject =
    /** Accepts only an ObjectId. */
    (id: ObjectId) => id;
  expect(acceptsObject(identity)).toBe('same');
  // @ts-expect-error An ObjectId must not be assignable to a SectionId.
  const wrong: SectionId = identity;
  void wrong;
});

/**
 * The editor (optional fields written out) and the language compiler (defaults omitted) create the
 * same object, so they get equal plans with one `added` impact.
 */
test('serve UI and language consumers equally', () => {
  // Arrange: the same step, as the UI writes it and as the language lowers it.
  const snapshot = base();
  const uiIntent = [
    {
      op: 'create',
      target: 'objects',
      value: {
        id: 'step',
        kind: 'step',
        label: 'Explain the concept',
        role: 'neutral',
        size: 'medium',
        ports: [],
        sources: [],
        content: [{ kind: 'text', id: 'detail', text: 'One shared diagram object' }],
      },
    },
  ];
  const loweredLanguageIntent = [
    {
      op: 'create',
      target: 'objects',
      value: {
        id: 'step',
        kind: 'step',
        label: 'Explain the concept',
        content: [{ kind: 'text', id: 'detail', text: 'One shared diagram object' }],
      },
    },
  ];

  // Act
  const ui = value(plan(snapshot, uiIntent));
  const language = value(plan(snapshot, loweredLanguageIntent));

  // Check: equal plans, the created object, and one addition.
  expect(ui).toEqual(language);
  expect(ui.candidate.objects[0]).toMatchObject({
    id: 'step',
    label: 'Explain the concept',
    content: [{ kind: 'text', id: 'detail', text: 'One shared diagram object' }],
  });
  expect(ui.impact).toEqual([{ target: 'objects', id: 'step', action: 'added' }]);
});
