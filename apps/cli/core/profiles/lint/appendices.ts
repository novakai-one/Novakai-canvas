/*
 * Appendix-content rules of the build-spec profile: sequence appendices hold native events or
 * fragments; flow and state appendices show their native nodes and connect their native wires.
 * Pure; the findings are returned.
 */
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import { collectAppendices, type Appendix } from './appendix-ids.js';
import {
  connected,
  id,
  isConnectedWire,
  shown,
  text,
  type Declaration,
  type DeclarationIndex,
} from './declarations.js';
import { findingAt } from './findings.js';

/**
 * What a non-sequence appendix must show and connect, read once from the section's mode field.
 * `mode` is the field as written (absent included); the messages print it.
 */
interface NativeContent {
  readonly mode: string | undefined;
  readonly nodeKinds: ReadonlySet<string>;
  readonly wireKind: string | undefined;
}

/** The content findings of every appendix section, in document order. */
export function lintAppendices(indexed: DeclarationIndex): readonly ProfileFinding[] {
  return collectAppendices(indexed.sections).flatMap((appendix) =>
    appendixContentFindings(appendix, indexed),
  );
}

/** Sequence appendices and node appendices are checked differently. */
function appendixContentFindings(
  appendix: Appendix,
  indexed: DeclarationIndex,
): readonly ProfileFinding[] {
  const mode = text(appendix.section, 'mode');
  return mode === 'sequence'
    ? sequenceAppendixFinding(appendix)
    : nodeAppendixFindings(appendix, nativeContent(mode), indexed);
}

/** A sequence appendix must contain native event or fragment declarations. */
function sequenceAppendixFinding(appendix: Appendix): readonly ProfileFinding[] {
  return appendix.section.children.some(
    (child) => child.kind === 'event' || child.kind === 'fragment',
  )
    ? []
    : [
        findingAt(appendix.section, {
          code: 'appendix-sequence-content',
          path: `section @${appendix.id}`,
          message: 'Sequence appendix must contain native event or fragment declarations.',
        }),
      ];
}

/**
 * Flow: the flow node kinds and `flow` wires. Anything else is held to state nodes, with
 * `transition` wires for state and wires of the written mode otherwise.
 */
function nativeContent(mode: string | undefined): NativeContent {
  if (mode === 'flow') return { mode, nodeKinds: flowNodeKinds, wireKind: 'flow' };
  return { mode, nodeKinds: stateNodeKinds, wireKind: mode === 'state' ? 'transition' : mode };
}

/** The native node kinds of a flow appendix. */
const flowNodeKinds: ReadonlySet<string> = new Set([
  'start',
  'step',
  'decision',
  'end',
  'fork',
  'join',
]);

/** The native node kind of a state appendix. */
const stateNodeKinds: ReadonlySet<string> = new Set(['state']);

/** A flow or state appendix must show its native nodes and connect its native wires. */
function nodeAppendixFindings(
  appendix: Appendix,
  content: NativeContent,
  indexed: DeclarationIndex,
): readonly ProfileFinding[] {
  return [
    ...nativeNodesFinding(appendix, content, shownNodesOf(appendix.section, indexed.nodes)),
    ...nativeWireFinding(appendix, content, indexed.wires),
  ];
}

/** The node declarations the section shows, in show order. */
function shownNodesOf(
  section: Declaration,
  nodes: readonly Declaration[],
): readonly Declaration[] {
  return shown(section).flatMap((objectId) => {
    const node = nodes.find((candidate) => id(candidate) === objectId);
    return node === undefined ? [] : [node];
  });
}

/** At least one shown node must be a native node of the appendix's mode. */
function nativeNodesFinding(
  appendix: Appendix,
  content: NativeContent,
  nodes: readonly Declaration[],
): readonly ProfileFinding[] {
  return nodes.some((node) => hasKindIn(node, content.nodeKinds))
    ? []
    : [
        findingAt(appendix.section, {
          code: 'appendix-native-nodes',
          path: `section @${appendix.id}`,
          message: `${content.mode} appendix must show native ${content.mode} objects.`,
        }),
      ];
}

/** The node's kind field is one of `kinds`. */
function hasKindIn(
  node: Declaration,
  kinds: ReadonlySet<string>,
): boolean {
  const kind = text(node, 'kind');
  return kind !== undefined && kinds.has(kind);
}

/** At least one connected wire must be of the appendix mode's native kind. */
function nativeWireFinding(
  appendix: Appendix,
  content: NativeContent,
  wires: readonly Declaration[],
): readonly ProfileFinding[] {
  const connectedIds = new Set(connected(appendix.section));
  return wires.some(
    (wire) => isConnectedWire(wire, connectedIds) && text(wire, 'kind') === content.wireKind,
  )
    ? []
    : [
        findingAt(appendix.section, {
          code: 'appendix-native-wires',
          path: `section @${appendix.id}`,
          message: `${content.mode} appendix must connect native ${content.mode} wires.`,
        }),
      ];
}
