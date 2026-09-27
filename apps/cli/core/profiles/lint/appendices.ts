/*
 * Appendix-content rules of the build-spec profile: sequence appendices hold native events or
 * fragments; flow and state appendices show their native nodes and connect their native wires.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../contract/records/profiles.js';
import {
  collectAppendices,
  findingAt,
  id,
  ids,
  shown,
  text,
  type Appendix,
  type Declaration,
} from './declarations.js';

/** The content findings of every appendix section, in document order. */
export function lintAppendices(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  return collectAppendices(indexed.sections).flatMap((appendix) =>
    appendixContentFindings(appendix, indexed),
  );
}

/** Sequence appendices and node appendices are checked differently. */
function appendixContentFindings(
  appendix: Appendix,
  indexed: ProfileDeclarationIndex,
): ProfileFinding[] {
  const mode = text(appendix.section, 'mode');
  return mode === 'sequence'
    ? sequenceAppendixFinding(appendix)
    : nodeAppendixFindings(appendix, mode, indexed);
}

/** A sequence appendix must contain native event or fragment declarations. */
function sequenceAppendixFinding(appendix: Appendix): ProfileFinding[] {
  return appendix.section.children.some(
    (child) => child.kind === 'event' || child.kind === 'fragment',
  )
    ? []
    : [
        findingAt(
          appendix.section,
          `section @${appendix.id}`,
          'Sequence appendix must contain native event or fragment declarations.',
        ),
      ];
}

/** A flow or state appendix must show its native nodes and connect its native wires. */
function nodeAppendixFindings(
  appendix: Appendix,
  mode: string | undefined,
  indexed: ProfileDeclarationIndex,
): ProfileFinding[] {
  return [
    ...nativeNodesFinding(appendix, mode, shownNodesOf(appendix.section, indexed.nodes)),
    ...nativeWireFinding(appendix, mode, indexed.wires),
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

/** At least one shown node must be a native node of the appendix's declared mode. */
function nativeNodesFinding(
  appendix: Appendix,
  mode: string | undefined,
  nodes: readonly Declaration[],
): ProfileFinding[] {
  return nodes.some((node) => allowedKinds(mode).has(text(node, 'kind') ?? ''))
    ? []
    : [
        findingAt(
          appendix.section,
          `section @${appendix.id}`,
          `${mode} appendix must show native ${mode} objects.`,
        ),
      ];
}

/** The native node kinds of a mode; anything that is not flow is held to the state kinds. */
function allowedKinds(mode: string | undefined): ReadonlySet<string> {
  return mode === 'flow'
    ? new Set(['start', 'step', 'decision', 'end', 'fork', 'join'])
    : new Set(['state']);
}

/** At least one connected wire must be of the appendix mode's native kind. */
function nativeWireFinding(
  appendix: Appendix,
  mode: string | undefined,
  wires: readonly Declaration[],
): ProfileFinding[] {
  const connected = appendix.section.children
    .filter((child) => child.kind === 'connect')
    .flatMap((child) => ids(child, 'ids'));
  return wires.some((wire) => nativeConnected(wire, connected, requiredKind(mode)))
    ? []
    : [
        findingAt(
          appendix.section,
          `section @${appendix.id}`,
          `${mode} appendix must connect native ${mode} wires.`,
        ),
      ];
}

/** The wire is connected by the section and of the required kind. */
function nativeConnected(
  wire: Declaration,
  connected: readonly string[],
  kind: string | undefined,
): boolean {
  return connected.includes(id(wire) ?? '') && text(wire, 'kind') === kind;
}

/** The native wire kind of a mode: transitions for state, the mode itself otherwise. */
function requiredKind(mode: string | undefined): string | undefined {
  return mode === 'state' ? 'transition' : mode;
}
