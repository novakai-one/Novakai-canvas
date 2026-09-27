/*
 * The build-spec@1 profile descriptor: its commands, the four required slots, the appendix rule,
 * the structural conventions and the notes. Pure data; `profile describe` prints it and lint reads
 * its slots.
 */
import type { ProfileDescriptor } from '../../../contract/records/profiles.js';

/** build-spec@1: five logical documents in one ordinary collection. */
export const buildSpecProfile: ProfileDescriptor = {
  id: 'build-spec@1',
  name: 'Build specification',
  description: 'A five-document convention for readable implementation plans.',
  commands: {
    describe: 'canvas profile describe build-spec@1',
    scaffold:
      'canvas profile scaffold build-spec@1 --id example --title "Example build" --out /tmp/example.canvas',
    lint: 'canvas profile lint FILE --profile build-spec@1',
  },
  slots: [
    {
      id: '@repo',
      order: 1,
      required: true,
      modes: ['tree'],
      description: 'Repo tree with scoped NEW/CHANGE/REUSE labels.',
    },
    {
      id: '@entities',
      order: 2,
      required: true,
      modes: ['er'],
      description: 'Entities with explicit fields and invariant text.',
    },
    {
      id: '@modules',
      order: 3,
      required: true,
      modes: ['modules'],
      description: 'Interfaces and signatures reusing canonical repo objects.',
    },
    {
      id: '@ownership',
      order: 4,
      required: true,
      modes: ['grid'],
      description: 'One Object/Create/Read/Update/Delete table row per entity.',
    },
  ],
  appendix: {
    idPattern: '@(flow|sequence|state)-5N',
    modes: ['flow', 'sequence', 'state'],
    description: 'At least one numbered 5.N flow, sequence or state appendix.',
  },
  conventions: [
    'Required section numeric orders must increase: repo < entities < modules < ownership < every appendix; extra sections may appear anywhere.',
    'Appendix IDs use @flow-5N, @sequence-5N or @state-5N; the prefix must match the native mode and N is positive.',
    'CRUD row IDs are @<entity-id>-row, exactly one five-cell row for each entity shown in @entities.',
    'Extra non-profile sections are preserved and do not satisfy or invalidate a reserved profile slot.',
  ],
  notes: [
    'These are logical documents in one ordinary collection, not five files.',
    'Sequence lifelines reuse canonical modules; interface lifelines use a linked participant proxy.',
    'Lint checks structure only; it does not certify prose, implementation completeness or rendering.',
  ],
};
