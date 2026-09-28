/*
 * The patch vocabulary: which properties `set` and `unset` may change on each target, and the
 * words that start an operation. A patch edits only these plain values; changing a kind, an ID,
 * a group or a section membership needs a `replace` or a membership operation instead. Plain
 * data, deep-frozen when the module loads, so no caller can change it. Language owns correcting
 * the source; Authoring owns commit recovery.
 */
import type { TargetKind } from '../../contract/records/syntax.js';
import type { Property } from '../../contract/records/vocabulary.js';
import { deepFreeze } from '../validation/ownership.js';
import { properties, layoutProperties, presentationProperties } from './properties.js';
import { showProperties, connectProperties } from './constructs.js';

/** A node, wire or block label. `required`: a patch cannot `unset` it. */
const label: Property = deepFreeze({ type: 'string', field: 'label', required: true });

/** A collection or section title. `required`: a patch cannot `unset` it. */
const title: Property = deepFreeze({ type: 'string', field: 'title', required: true });

/**
 * The properties `set` and `unset` accept, by target. The attribute name is the key; `asset`,
 * `source` and `layout` have none. `appearance` and `route` copy the `show` and `connect` entry
 * tables (the same property records, in their own table). Patching also uses these tables to
 * lower values, and printing uses the `appearance` and `route` tables for a section's `show` and
 * `connect` entries.
 */
export const patchProperties: Readonly<Record<TargetKind, Readonly<Record<string, Property>>>> =
  deepFreeze({
    collection: {
      title,
      description: properties.description,
      theme: properties.theme,
      ...layoutProperties,
    },
    node: {
      label,
      ...presentationProperties,
      step: properties.step,
      sources: properties.sources,
    },
    wire: {
      label,
      step: properties.step,
      from: properties.from,
      to: properties.to,
      guard: properties.guard,
      effect: properties.effect,
      style: properties.style,
      sources: properties.sources,
      'from-end': { type: 'endpoint', field: 'source', required: true },
      'to-end': { type: 'endpoint', field: 'target', required: true },
    },
    section: { title, mode: properties.mode, order: properties.order, ...layoutProperties },
    appearance: { ...showProperties },
    route: { ...connectProperties },
    block: {
      label,
      role: properties.textRole,
      text: { type: 'string', field: 'text', required: true },
      items: { type: 'strings', field: 'items', required: true },
      language: properties.language,
      target: properties.target,
      section: properties.section,
      ordered: properties.ordered,
      asset: properties.asset,
      size: properties.size,
      fit: properties.fit,
      level: properties.figureLevel,
      fill: properties.figureFill,
      pass: properties.pass,
      layers: properties.layers,
      agitator: properties.agitator,
      mark: properties.mark,
      debris: properties.debris,
      type: properties.type,
      key: properties.key,
      nullable: properties.nullable,
      references: { type: 'reference-value', field: 'references' },
      parameters: properties.parameters,
      returns: properties.returns,
      visibility: properties.visibility,
    },
    asset: {},
    source: {},
    layout: {},
  });

/**
 * The words that start a patch operation. Reading `unset` property names stops at the first of
 * these, an unknown operation's diagnostic lists them, and `describe` publishes them.
 */
export const operationWords: readonly string[] = deepFreeze([
  'add',
  'set',
  'unset',
  'replace',
  'show',
  'hide',
  'connect',
  'disconnect',
  'remove',
  'move',
  'delete',
  'reset',
]);
