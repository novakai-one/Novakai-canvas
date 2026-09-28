/** Public Model scenarios are replayable; Vitest owns assertion reporting and the developer corrects regressions before rerunning. */
import { expect, test } from 'vitest';
import { validate } from '../contract/index.js';
import {
  base,
  graph,
  layout,
  node,
  rejects,
  relation,
  section,
  value,
  type RawRecord,
} from './fixtures.js';

/**
 * A wire needs both endpoints shown in its section; a group may represent a hidden object but
 * not one that also appears; an explicit `undefined` field is not JSON; a group cannot be its own
 * parent; a wire is drawn at most once per section.
 */
test('validate groups and visible wires', () => {
  // Check: the wire's target `b` is not shown.
  const hiddenTarget = graph({
    sections: [
      section('view', 'flow', {
        appearances: [{ object: 'a' }],
        wires: [{ relationship: 'ab' }],
      }),
    ],
  });
  rejects(hiddenTarget, 'reference', 'wires.ab.target');

  // Check: group `g` represents the hidden `a`, so the wire from `a` to `b` is drawn.
  const group = { id: 'g', title: 'Group', represents: 'a', layout: layout() };
  const represented = graph({
    sections: [
      section('view', 'flow', {
        groups: [group],
        appearances: [{ object: 'b', group: 'g' }],
        wires: [{ relationship: 'ab' }],
      }),
    ],
  });
  const representedGroup = value(validate(represented)).sections[0]?.groups[0];
  expect(representedGroup?.represents).toBe('a');

  // Check: `a` cannot appear while a group represents it.
  const representedAndShown = graph({
    sections: [section('view', 'flow', { groups: [group], appearances: [{ object: 'a' }] })],
  });
  rejects(representedAndShown, 'duplicate', 'appearances.a');

  // Check: `represents: undefined` is not a JSON value. The shape check fails first, so the
  // self-parent `parent: 'g'` is never reached.
  const explicitUndefined = base({
    sections: [
      section('view', 'flow', { groups: [{ ...group, represents: undefined, parent: 'g' }] }),
    ],
  });
  rejects(explicitUndefined, 'shape', '$');

  // Check: a group cannot be its own parent.
  const ownParent = base({
    sections: [
      section('view', 'flow', {
        groups: [{ id: 'g', title: 'G', layout: layout(), parent: 'g' }],
      }),
    ],
  });
  rejects(ownParent, 'group', 'groups.g');

  // Check: the same wire twice.
  const duplicateWire = graph({
    sections: [
      section('view', 'flow', {
        appearances: [{ object: 'a' }, { object: 'b' }],
        wires: [{ relationship: 'ab' }, { relationship: 'ab' }],
      }),
    ],
  });
  rejects(duplicateWire, 'duplicate', 'wires.ab');
});

/**
 * A section's layout must suit its mode; arrangement constraints must name sections, not objects;
 * a constraint cannot repeat a target; a locked wire needs a manual route. Section-to-section
 * constraints and grid layouts in ER and modules sections are kept.
 */
test('validate layout intent', () => {
  // Check: an ER section cannot use the flow layout.
  const erWithFlow = base({ sections: [section('data', 'er', { layout: layout('flow') })] });
  rejects(erWithFlow, 'mode', 'sections.data.layout');

  // Check: the collection arrangement names object `a`.
  const objectInArrangement = graph({
    arrangement: layout('grid', [
      {
        kind: 'before',
        targets: [
          { kind: 'object', id: 'a' },
          { kind: 'section', id: 'view' },
        ],
      },
    ]),
  });
  rejects(objectInArrangement, 'reference', 'arrangement.a');

  // Check: a section constraint names `a` twice.
  const repeatedTarget = graph({
    sections: [
      section('view', 'flow', {
        layout: layout('flow', [
          {
            kind: 'before',
            targets: [
              { kind: 'object', id: 'a' },
              { kind: 'object', id: 'a' },
            ],
          },
        ]),
        appearances: [{ object: 'a' }],
      }),
    ],
  });
  rejects(repeatedTarget, 'duplicate', 'layout.constraints');

  // Check: a locked wire without a manual route.
  const lockedWithoutRoute = graph({
    sections: [
      section('view', 'flow', {
        appearances: [{ object: 'a' }, { object: 'b' }],
        wires: [{ relationship: 'ab', locked: true }],
      }),
    ],
  });
  rejects(lockedWithoutRoute, 'layout', 'wires.ab');

  // Check: a section-to-section arrangement constraint is kept.
  const arranged = base({
    sections: [section('first'), section('second')],
    arrangement: layout('grid', [
      {
        kind: 'before',
        targets: [
          { kind: 'section', id: 'first' },
          { kind: 'section', id: 'second' },
        ],
      },
    ]),
  });
  expect(value(validate(arranged)).arrangement.constraints).toHaveLength(1);

  // Check: ER and modules sections accept the grid layout.
  const engineeringGrid = base({
    sections: [
      section('data', 'er', { layout: layout('grid') }),
      section('code', 'modules', { layout: layout('grid') }),
    ],
  });
  const algorithms = value(validate(engineeringGrid)).sections.map(
    /** The section's layout algorithm. */
    (item) => item.layout.algorithm,
  );
  expect(algorithms).toEqual(['grid', 'grid']);
});

/**
 * A decision's outgoing wires need distinct labels; a state section keeps transition guards and
 * rejects a transition leaving an end state; a plain graph keeps wires in both directions.
 */
test('validate flow and state', () => {
  // Check: decision `a` has two outgoing wires with the same default label `continues`.
  const objects = [node('a', 'decision'), node('b'), node('c')];
  const relationships = [relation('ab'), relation('ac', 'a', 'c')];
  const repeatedLabelDecision = base({
    objects,
    relationships,
    sections: [
      section('view', 'flow', {
        appearances: objects.map(
          /** Shows the object. */
          (object) => ({ object: object.id }),
        ),
        wires: relationships.map(
          /** Draws the relationship. */
          (wire) => ({ relationship: wire.id }),
        ),
      }),
    ],
  });
  rejects(repeatedLabelDecision, 'duplicate', 'decision.a');

  // Check: a state machine keeps the guard of its second transition.
  const states = [node('start', 'start'), node('state', 'state'), node('end', 'end')];
  const transitions = [
    relation('begin', 'start', 'state', { kind: 'transition', label: 'opened' }),
    relation('finish', 'state', 'end', {
      kind: 'transition',
      label: 'saved',
      guard: 'valid',
      effect: 'close',
    }),
  ];
  const stateMachine = base({
    objects: states,
    relationships: transitions,
    sections: [
      section('states', 'state', {
        appearances: states.map(
          /** Shows the state. */
          (object) => ({ object: object.id }),
        ),
        wires: transitions.map(
          /** Draws the transition. */
          (wire) => ({ relationship: wire.id }),
        ),
      }),
    ],
  });
  const validatedStates = value(validate(stateMachine));
  expect(validatedStates.relationships[1]?.guard).toBe('valid');

  // Check: a transition cannot start at an end state.
  const leavesEnd = base({
    objects: states,
    relationships: [relation('bad', 'end', 'state', { kind: 'transition' })],
  });
  rejects(leavesEnd, 'endpoint', 'relationships.bad.source');

  // Check: wires both ways between `a` and `b`.
  const twoWay = graph({ relationships: [relation(), relation('back', 'b', 'a')] });
  expect(value(validate(twoWay)).relationships).toHaveLength(2);
});

/**
 * Modules can send and receive sequence events directly. Every endpoint must be shown in the
 * section, and a grouped object cannot be an event endpoint.
 */
test('validate canonical modules as direct sequence endpoints', () => {
  // Check: events between two modules and a participant keep their endpoints and object order.
  const input = base({
    objects: [node('api', 'module'), node('worker', 'module'), node('human', 'participant')],
    sections: [
      moduleSequence({
        appearances: [{ object: 'api' }, { object: 'worker' }, { object: 'human' }],
        sequence: [
          apiRequest(),
          {
            id: 'reply',
            kind: 'event',
            source: 'worker',
            target: 'human',
            label: 'Reply',
            message: 'return',
            order: 1,
          },
        ],
      }),
    ],
  });
  const validated = value(validate(input));
  expect(validated.sections[0]?.sequence[0]).toMatchObject({ source: 'api', target: 'worker' });
  const objectIds = validated.objects.map(
    /** The object's ID. */
    (object) => object.id,
  );
  expect(objectIds).toEqual(['api', 'worker', 'human']);

  // Check: the event's target `worker` is not shown.
  const hidden = {
    ...input,
    sections: [
      moduleSequence({
        appearances: [{ object: 'api' }, { object: 'human' }],
        sequence: [apiRequest()],
      }),
    ],
  };
  rejects(hidden, 'sequence', 'sequence.request.worker');

  // Check: the event's source `api` sits in group `g`.
  const grouped = {
    ...input,
    sections: [
      moduleSequence({
        groups: [{ id: 'g', title: 'Group', layout: layout() }],
        appearances: [{ object: 'api', group: 'g' }, { object: 'worker' }, { object: 'human' }],
        sequence: [apiRequest()],
      }),
    ],
  };
  rejects(grouped, 'sequence', 'sequence.request.api');
});

/**
 * A tree section keeps its root. It rejects: `child` as the root, a child without its parent
 * wire, a note taking part in the tree, a parent wire to an annotation, and a parent cycle. A
 * tree showing only a note has no root.
 */
test('validate tree topology', () => {
  // Check: the valid tree keeps root `root`.
  expect(value(validate(tree())).sections[0]?.root).toBe('root');

  // Check: `child` as the root.
  rejects(tree({ root: 'child' }), 'tree', 'appearances');

  // Check: no parent wire is drawn.
  rejects(tree({ wires: [] }), 'tree', 'appearances.child');

  // Check: the note takes part in the tree.
  const noteInTree = tree({
    appearances: [
      { object: 'root' },
      { object: 'child' },
      { object: 'note', participation: 'tree' },
    ],
  });
  rejects(noteInTree, 'tree', 'appearances.note');

  // Check: the parent wire points at an annotation.
  const annotatedChild = tree({
    appearances: [{ object: 'root' }, { object: 'child', participation: 'annotation' }],
  });
  rejects(annotatedChild, 'tree', 'wires.parent');

  // Check: `a` and `b` are each other's parent.
  const cycle = base({
    objects: [node('a'), node('b')],
    relationships: [
      relation('ab', 'a', 'b', { kind: 'parent' }),
      relation('ba', 'b', 'a', { kind: 'parent' }),
    ],
    sections: [
      section('tree', 'tree', {
        root: 'a',
        appearances: [{ object: 'a' }, { object: 'b' }],
        wires: [{ relationship: 'ab' }, { relationship: 'ba' }],
      }),
    ],
  });
  rejects(cycle, 'tree', 'appearances');

  // Check: a tree showing only a note has no root.
  const rootless = base({
    objects: [node('note', 'note')],
    sections: [section('tree', 'tree', { appearances: [{ object: 'note' }] })],
  });
  expect(value(validate(rootless)).sections[0]?.root).toBeUndefined();
});

/**
 * An event may sit in a fragment branch. The sequence rejects: a fragment parent without a
 * branch, a missing parent or target, two items at the same order, a fragment with one branch, a
 * fragment inside itself, and two branches with the same label.
 */
test('validate sequence topology', () => {
  // Check: the event sits in branch `yes` of fragment `choice`.
  const branched = sequence([
    choiceFragment(),
    { ...requestEvent(), parent: 'choice', branch: 'yes' },
  ]);
  expect(value(validate(branched)).sections[0]?.sequence).toHaveLength(2);

  // Check: a fragment parent without a branch.
  rejects(
    sequence([choiceFragment(), { ...requestEvent(), parent: 'choice' }]),
    'sequence',
    'request',
  );

  // Check: a parent that does not exist.
  rejects(sequence([{ ...requestEvent(), parent: 'missing' }]), 'sequence', 'request');

  // Check: a target that does not exist.
  rejects(sequence([{ ...requestEvent(), target: 'missing' }]), 'sequence', 'request.missing');

  // Check: two events at order 0.
  rejects(
    sequence([requestEvent(), { ...requestEvent(), id: 'second' }]),
    'duplicate',
    'sequence.order',
  );

  // Check: a fragment with one branch.
  const oneBranch = sequence([{ ...choiceFragment(), branches: [{ id: 'yes', label: 'Yes' }] }]);
  rejects(oneBranch, 'sequence', 'choice');

  // Check: a fragment inside its own branch.
  rejects(
    sequence([{ ...choiceFragment(), parent: 'choice', branch: 'yes' }]),
    'sequence',
    'choice',
  );

  // Check: two branches labelled `Same`.
  const sameLabels = sequence([
    {
      ...choiceFragment(),
      branches: [
        { id: 'yes', label: 'Same' },
        { id: 'no', label: 'Same' },
      ],
    },
  ]);
  rejects(sameLabels, 'duplicate', 'branches');
});

/** Public validation rejects malformed intent without mutation; callers correct and retry. */
test('grid columns validate independently in collection, section and nested group scopes', () => {
  // Check: each invalid column count, in the arrangement and in a section.
  const invalidColumns: readonly unknown[] = [0, 13, -1, 1.5, '2', null, NaN, Infinity];
  invalidColumns.forEach(
    /** Rejects the column count in both scopes. */
    (columns) => {
      rejects(base({ arrangement: { algorithm: 'grid', columns } }), 'shape', 'columns');
      const gridSection = section('grid', 'grid', { layout: { algorithm: 'grid', columns } });
      rejects(base({ sections: [gridSection] }), 'shape', 'columns');
    },
  );

  // Check: only the grid layout takes columns.
  ['flow', 'layered', 'tree', 'sequence'].forEach(
    /** Rejects columns on this layout. */
    (algorithm) => {
      rejects(base({ arrangement: { algorithm, columns: 2 } }), 'layout', 'columns');
    },
  );

  // Check: valid counts are kept in every scope, and the input is not changed.
  [1, 2, 12].forEach(
    /** Validates the column count in the arrangement, a section and a nested group. */
    (columns) => {
      const input = base({
        arrangement: { algorithm: 'grid', columns },
        sections: [
          section('grid', 'grid', {
            layout: { algorithm: 'grid', columns },
            groups: [
              { id: 'outer', title: 'Outer', layout: { algorithm: 'grid', columns: 1 } },
              {
                id: 'inner',
                title: 'Inner',
                parent: 'outer',
                layout: { algorithm: 'grid', columns },
              },
            ],
          }),
        ],
      });
      const checked = value(validate(input));
      expect(checked.arrangement.columns).toBe(columns);
      expect(checked.sections[0]?.groups[1]?.layout.columns).toBe(columns);
      expect(input.arrangement).toEqual({ algorithm: 'grid', columns });
    },
  );

  // Check: a flow-layout group cannot take columns.
  const flowGroupColumns = base({
    sections: [
      section('grid', 'grid', {
        groups: [{ id: 'g', title: 'G', layout: { algorithm: 'flow', columns: 2 } }],
      }),
    ],
  });
  rejects(flowGroupColumns, 'layout', 'groups.g.layout.columns');
});

/**
 * Builds a tree section: `root` is the parent of `child`, and a `note` is shown beside them.
 *
 * @param extra - Section fields to add or override, spread last.
 * @returns The collection data (unvalidated).
 */
function tree(extra: Readonly<Record<string, unknown>> = {}): ReturnType<typeof base> {
  return base({
    objects: [node('root', 'concept'), node('child', 'concept'), node('note', 'note')],
    relationships: [relation('parent', 'root', 'child', { kind: 'parent' })],
    sections: [
      section('tree', 'tree', {
        root: 'root',
        appearances: [{ object: 'root' }, { object: 'child' }, { object: 'note' }],
        wires: [{ relationship: 'parent' }],
        ...extra,
      }),
    ],
  });
}

/**
 * Builds a sequence section between participants `user` and `agent`.
 *
 * @param items - The section's sequence items.
 * @returns The collection data (unvalidated).
 */
function sequence(items: readonly unknown[]): ReturnType<typeof base> {
  return base({
    objects: [node('user', 'participant'), node('agent', 'participant')],
    sections: [
      section('sequence', 'sequence', {
        appearances: [{ object: 'user' }, { object: 'agent' }],
        sequence: items,
      }),
    ],
  });
}

/**
 * Builds an activating `request` event from `user` to `agent` at order 0 (a new object each call).
 *
 * @returns The sequence item (unvalidated).
 */
function requestEvent() {
  return {
    kind: 'event',
    id: 'request',
    order: 0,
    source: 'user',
    target: 'agent',
    label: 'Request',
    message: 'call',
    activate: true,
  };
}

/**
 * Builds an `alt` fragment `choice` at order 0 with branches `yes` and `no` (a new object each
 * call).
 *
 * @returns The sequence item (unvalidated).
 */
function choiceFragment() {
  return {
    kind: 'fragment',
    id: 'choice',
    order: 0,
    operator: 'alt',
    label: 'Outcome',
    branches: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  };
}

/**
 * Builds the `request` event from module `api` to module `worker` at order 0.
 *
 * @returns The sequence item (unvalidated).
 */
function apiRequest() {
  return {
    id: 'request',
    kind: 'event',
    source: 'api',
    target: 'worker',
    label: 'Request',
    message: 'call',
    order: 0,
  };
}

/**
 * Builds section `sequence` in sequence mode with the sequence layout.
 *
 * @param fields - Section fields spread after the layout (appearances, groups, sequence).
 * @returns The section record (unvalidated).
 */
function moduleSequence(fields: RawRecord): RawRecord {
  return section('sequence', 'sequence', { layout: layout('sequence'), ...fields });
}
