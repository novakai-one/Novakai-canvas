/*
 * The shipped grammar: every construct, its positional values, its attributes and the constructs
 * it may contain. Parsing, lowering, printing and `describe` read it. Plain data, deep-frozen when
 * the module loads, so no caller can change it. Language owns correcting the source; Authoring
 * owns commit recovery.
 */
import type { Construct } from '../../contract/records/syntax.js';
import type {
  ConstructDefinition,
  PositionRule,
  Property,
} from '../../contract/records/vocabulary.js';
import { deepFreeze } from '../validation/ownership.js';
import { properties, layoutProperties, presentationProperties } from './properties.js';
import { nodeKinds } from './defaults.js';

/**
 * What a section's `show` entry accepts: how the object is presented there, how much of it is
 * shown, and how it takes part. A patch's `appearance` target accepts the same properties.
 */
export const showProperties: Readonly<Record<string, Property>> = deepFreeze({
  ...presentationProperties,
  detail: properties.detail,
  participation: properties.participation,
});

/**
 * What a section's `connect` entry accepts: its route shape and the sides it leaves from and
 * arrives at. A patch's `route` target accepts the same properties.
 */
export const connectProperties: Readonly<Record<string, Property>> = deepFreeze({
  route: properties.route,
  'source-side': properties.sourceSide,
  'target-side': properties.targetSide,
});

/**
 * Every construct, in the order `describe` lists them. Each entry names its positional values
 * (`positions`, in written order), its attributes (`properties`, by attribute name) and the
 * constructs it may contain (`children`; `null` for none).
 */
export const constructs: readonly ConstructDefinition[] = deepFreeze([
  {
    kind: 'type',
    positions: [idPosition(), labelPosition()],
    properties: { expression: { type: 'string', field: 'expression', required: true } },
    children: null,
  },
  {
    kind: 'collection',
    positions: [idPosition(), titlePosition()],
    properties: {
      theme: properties.theme,
      description: properties.description,
      ...layoutProperties,
    },
    children: [
      'type',
      'asset',
      'source',
      'node',
      'wire',
      'section',
      'rank',
      'align',
      'before',
      'below',
    ],
  },
  {
    kind: 'asset',
    positions: [idPosition(), { name: 'kind', type: 'word', values: ['image', 'icon', 'font'] }],
    properties: {
      source: properties.source,
      alt: properties.alt,
      license: properties.license,
      attribution: properties.attribution,
    },
    children: null,
  },
  {
    kind: 'source',
    positions: [idPosition(), { name: 'uri', type: 'string' }],
    properties: {
      revision: properties.revision,
      location: properties.location,
      description: properties.description,
      status: properties.status,
    },
    children: null,
  },
  {
    kind: 'node',
    positions: [idPosition(), { name: 'kind', type: 'word', values: nodeKinds }, labelPosition()],
    properties: {
      ...presentationProperties,
      step: properties.step,
      sources: properties.sources,
    },
    children: [
      'text',
      'code',
      'link',
      'list',
      'image',
      'icon',
      'figure',
      'field',
      'keygroup',
      'signature',
      'member',
      'table',
      'port',
    ],
  },
  {
    kind: 'wire',
    positions: [
      idPosition(),
      { name: 'source', type: 'endpoint' },
      { name: 'arrow', type: 'word', literal: '->' },
      { name: 'target', type: 'endpoint' },
      labelPosition(),
    ],
    properties: {
      kind: properties.wireKind,
      step: properties.step,
      from: properties.from,
      to: properties.to,
      guard: properties.guard,
      effect: properties.effect,
      style: properties.style,
      sources: properties.sources,
    },
    children: null,
  },
  {
    kind: 'section',
    positions: [idPosition(), titlePosition()],
    properties: { mode: properties.mode, order: properties.order, ...layoutProperties },
    children: [
      'show',
      'connect',
      'group',
      'rank',
      'align',
      'before',
      'below',
      'root',
      'event',
      'fragment',
    ],
  },
  {
    kind: 'group',
    positions: [idPosition(), titlePosition()],
    properties: {
      represents: properties.represents,
      frame: properties.containerFrame,
      role: properties.role,
      ...layoutProperties,
    },
    children: ['show', 'group', 'rank', 'align', 'before', 'below'],
  },
  {
    kind: 'text',
    positions: [idPosition(), { name: 'text', type: 'string' }],
    properties: { role: properties.textRole },
    children: null,
  },
  {
    kind: 'code',
    positions: [idPosition(), { name: 'text', type: 'string' }],
    properties: { language: properties.language },
    children: null,
  },
  {
    kind: 'link',
    positions: [idPosition(), labelPosition()],
    properties: { target: properties.target, section: properties.section },
    children: null,
  },
  {
    kind: 'list',
    positions: [idPosition(), { name: 'items', type: 'strings' }],
    properties: { ordered: properties.ordered },
    children: null,
  },
  {
    kind: 'image',
    positions: [idPosition()],
    properties: { asset: properties.asset, size: properties.size, fit: properties.fit },
    children: null,
  },
  {
    kind: 'icon',
    positions: [idPosition()],
    properties: { asset: properties.asset, size: properties.size, fit: properties.fit },
    children: null,
  },
  {
    kind: 'figure',
    positions: [
      idPosition(),
      {
        name: 'form',
        type: 'word',
        values: [
          'vessel',
          'layered-bed',
          'screen',
          'gauge',
          'window',
          'gate',
          'stack',
          'store',
          'queue',
          'cloud',
        ],
      },
    ],
    properties: {
      level: properties.figureLevel,
      fill: properties.figureFill,
      pass: properties.pass,
      layers: properties.layers,
      agitator: properties.agitator,
      mark: properties.mark,
      debris: properties.debris,
      size: properties.size,
    },
    children: null,
  },
  {
    kind: 'field',
    positions: [idPosition(), labelPosition()],
    properties: {
      type: properties.type,
      key: properties.key,
      nullable: properties.nullable,
      references: properties.references,
    },
    children: null,
  },
  {
    kind: 'keygroup',
    positions: [idPosition()],
    properties: {
      kind: properties.keyKind,
      fields: properties.fields,
      references: properties.referenceList,
    },
    children: null,
  },
  {
    kind: 'signature',
    positions: [idPosition(), labelPosition()],
    properties: { parameters: properties.parameters, returns: properties.returns },
    children: null,
  },
  {
    kind: 'member',
    positions: [idPosition(), labelPosition()],
    properties: { type: properties.type, visibility: properties.visibility },
    children: null,
  },
  {
    kind: 'table',
    positions: [idPosition()],
    properties: { columns: properties.columns },
    children: ['row'],
  },
  {
    kind: 'row',
    positions: [idPosition()],
    properties: { cells: properties.cells },
    children: null,
  },
  {
    kind: 'port',
    positions: [
      idPosition(),
      { name: 'direction', type: 'word', values: ['in', 'out', 'inout'] },
      labelPosition(),
    ],
    properties: { type: properties.type },
    children: null,
  },
  {
    kind: 'show',
    positions: [{ name: 'ids', type: 'references' }],
    properties: showProperties,
    children: null,
  },
  {
    kind: 'connect',
    positions: [{ name: 'ids', type: 'references' }],
    properties: connectProperties,
    children: null,
  },
  { kind: 'root', positions: [idPosition()], properties: {}, children: null },
  {
    kind: 'event',
    positions: [
      idPosition(),
      { name: 'source', type: 'id' },
      { name: 'arrow', type: 'word', literal: '->' },
      { name: 'target', type: 'id' },
      labelPosition(),
    ],
    properties: {
      kind: properties.message,
      activate: properties.activate,
      operation: properties.operation,
    },
    children: null,
  },
  {
    kind: 'fragment',
    positions: [
      idPosition(),
      { name: 'operator', type: 'word', values: ['alt', 'opt', 'loop'] },
      labelPosition(),
    ],
    properties: {},
    children: ['branch', 'event', 'fragment'],
  },
  {
    kind: 'branch',
    positions: [{ name: 'id', type: 'id', optional: true }, labelPosition()],
    properties: {},
    children: ['event', 'fragment'],
  },
  constraint('rank'),
  constraint('align'),
  constraint('before'),
  constraint('below'),
]);

/** A layout constraint (`rank`, `align`, `before`, `below`): only its targets, no braces. */
function constraint(kind: Construct): ConstructDefinition {
  return {
    kind,
    positions: [{ name: 'targets', type: 'targets' }],
    properties: {},
    children: null,
  };
}

/** A construct's own ID, written first. A new record per call. */
function idPosition(): PositionRule {
  return { name: 'id', type: 'id' };
}

/** A display label, written as a string. A new record per call. */
function labelPosition(): PositionRule {
  return { name: 'label', type: 'string' };
}

/** A collection, section or group title, written after its ID. A new record per call. */
function titlePosition(): PositionRule {
  return { name: 'title', type: 'string' };
}
