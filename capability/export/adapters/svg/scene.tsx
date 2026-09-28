/*
 * The shared SVG scene renderer. SVG, PNG, PDF and HTML export all draw through it. It
 * serializes Presentation's React drawing to static markup: React escapes authored text and
 * attributes, and nothing in the diagram is executed.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ComponentType } from 'react';
import { hiddenLabelBoxes } from '@novakai/canvas-layout';
import type {
  DrawingSlots,
  SceneRenderer,
  PlacedSection,
  Paint,
} from '../../contract/render-types.js';
import type { RenderInput } from '../../contract/ports/formats.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';

/**
 * Creates the scene renderer.
 *
 * `render` draws the selection as one SVG document:
 * - the root `<svg>` is the selection's bounds (`viewBox` `x y width height`, so negative
 *   origins work), with `role="img"` and the collection title as its label;
 * - `<title>`, `<desc>` ("Collection <id>, revision <n>") and `<metadata>` (the identity as
 *   JSON);
 * - the font definitions, then a background rectangle over the bounds;
 * - each section: its frame rectangle, then, moved by the section origin, its title, nodes,
 *   wires and sequence geometry.
 *
 * Every `font-family="canvas-<digest>"` in the result must name one of `fontDigests`, so text
 * never falls back to a system font.
 *
 * @param slots - The node, wire, sequence and label drawing slots.
 * @param FontDefinitions - Presentation's font-definition component, drawn once per document.
 * @param fontDigests - Digests of the pinned fonts.
 * @param allLabels - When `true`, wire labels the diagram hides are drawn too: each at the spot
 * Layout picks beside its wire (clear of other labels when possible). A label Layout finds no
 * spot for stays hidden.
 * @returns The renderer. `render` never throws: a throw while drawing becomes
 * `encoding-failed` at `svg`, and an unpinned font becomes `encoding-failed` at `fonts`. It
 * keeps no state; the caller owns the snapshot lease.
 * @throws Never.
 */
export function createSceneRenderer(
  slots: DrawingSlots,
  FontDefinitions: ComponentType,
  fontDigests: readonly string[],
  allLabels = false,
): SceneRenderer {
  /** Draws the selection and checks its fonts; see {@link createSceneRenderer}. */
  function render(input: RenderInput): Result<string> {
    try {
      return checkFonts(serialize(input), fontDigests);
    } catch {
      return failure('encoding-failed', 'svg', 'Shared presentation could not render this scene');
    }
  }

  /** Serializes the whole document: root element, title, metadata, fonts, background, sections. */
  function serialize(input: RenderInput): string {
    const box = input.selection.bounds;
    const identity = input.snapshot.identity;
    return renderToStaticMarkup(
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        role="img"
        aria-label={identity.title}
      >
        <title>{identity.title}</title>
        <desc>{`Collection ${identity.collectionId}, revision ${identity.revision}`}</desc>
        <metadata>{JSON.stringify(identity)}</metadata>
        <FontDefinitions />
        <rect {...box} fill={input.snapshot.paint.fill} />
        {input.selection.sections.map(
          /** Draws one section. */ (item) => section(item, input.snapshot.paint),
        )}
      </svg>,
    );
  }

  /**
   * Draws one section: its frame, then its title, nodes, wires and sequence geometry moved by the
   * section origin once. Nodes inside groups already include their groups' offsets.
   */
  function section(
    item: PlacedSection,
    paint: Paint,
  ): ReactElement {
    return (
      <g key={item.id} data-section={item.id}>
        <rect {...item.box} fill={paint.fill} stroke={paint.stroke} />
        <g transform={`translate(${item.origin.x} ${item.origin.y})`}>
          {slots.label(item.title.content, item.title.box)}
          {item.nodes.map(slots.node)}
          {wires(item).map(
            /** Draws one wire in the section's colours. */ (wire) => slots.wire(wire, paint),
          )}
          {slots.sequence(item.sequence, paint)}
        </g>
      </g>
    );
  }

  /**
   * The section's wires. In all-labels mode, each hidden label is drawn at the spot Layout picks
   * beside its wire (clear of other labels when possible): the wire gets `labelVisible: true` and
   * that box. A label Layout finds no spot for stays hidden; other wires are unchanged.
   */
  function wires(item: PlacedSection): PlacedSection['wires'] {
    if (!allLabels) return item.wires;
    const boxes = hiddenLabelBoxes(item.wires, item.nodes);
    return item.wires.map(
      /** The wire, with its hidden label shown at Layout's spot when Layout found one. */
      (wire) => {
        const box = boxes.get(wire.id);
        return box === undefined ? wire : { ...wire, labelVisible: true, labelBox: box };
      },
    );
  }

  return { render };
}

/**
 * Checks every font alias in the SVG (`font-family="canvas-<64 hex digits>"`) names a pinned
 * font, so no text silently falls back to a browser or system font.
 */
function checkFonts(
  svg: string,
  fontDigests: readonly string[],
): Result<string> {
  const aliases = Array.from(
    svg.matchAll(/font-family="canvas-([a-f0-9]{64})"/g),
    /** The digest part of one font alias. */ (match) => match[1],
  );
  if (
    !aliases.every(
      /** Whether the digest is one of the pinned fonts. */ (digest) =>
        fontDigests.includes(digest ?? ''),
    )
  )
    return failure(
      'encoding-failed',
      'fonts',
      'Scene text has no matching embedded font definition',
    );
  return success(svg);
}
