import type { Section, RenderDocument, Target } from '../../contract/records/owners.js';
import { diagnostic, type Diagnostic } from '../../contract/errors.js';
/** Internal edit rejection becomes a typed plan failure; the host preserves the recoverable Canvas draft. */
export class EditRejected extends Error {
  /** Keep stable correction data while unwinding a multi-target plan atomically. */
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}
/** Missing targets never create replacement records implicitly. Host refreshes and lets the human compare their draft. */
export function missing(target: string): never {
  throw new EditRejected(
    diagnostic(
      'stale-target',
      `This diagram target is no longer available: ${target}`,
      'Keep the draft and compare it with the current collection.',
    ),
  );
}
/** Resolve the section by its explicit canonical identity, never by decoding a generated scene ID. */
export function sectionFor(
  target: Target,
  sections: readonly Section[],
): Section {
  const id = target.kind === 'section' ? target.id : target.section;
  const section = sections.find((item) => item.id === id);
  if (!section) return missing(id);
  return section;
}
/** Presentation retains canonical object/group identities expressly for this boundary. */
export function nodeFor(
  target: Target,
  document: RenderDocument,
): RenderDocument['scene']['sections'][number]['nodes'][number] {
  if (target.kind !== 'node') return missing(target.id);
  const nodes = document.scene.sections.find((item) => item.id === target.section)?.nodes ?? [];
  return presentNode(
    nodes.find((item) => item.id === target.id),
    target.id,
  );
}
/** A successful target lookup always carries its measured owner record. */
function presentNode(
  node: RenderDocument['scene']['sections'][number]['nodes'][number] | undefined,
  id: string,
): RenderDocument['scene']['sections'][number]['nodes'][number] {
  if (!node) return missing(id);
  return node;
}
