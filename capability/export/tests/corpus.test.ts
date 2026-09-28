/*
 * Corpus SVG check: every admitted showcase collection is exported as SVG through the real
 * encoder, and the markup is compared with the recorded scene: text, media, rules, markers,
 * frames, wires and sequence content. It checks that content survives, not how good the
 * placement looks.
 */
import { assert, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { MeasuredContent, VisualNode, MarkerKind } from '@novakai/canvas-presentation';
import type { PlacedSection, PlacedNode, Box } from '@novakai/canvas-layout';
import index from '../../../resources/examples/showcase/manifest.json' with { type: 'json' };
import { corpusFixture } from './corpus-fixture.js';

/**
 * The expected number of marker paths and circles for each marker kind, written out
 * independently of the marker drawing code: mandatory ends have bars, optional ends have a
 * circle, and `none` draws nothing.
 */
const markerElements: Readonly<Record<MarkerKind, readonly [number, number]>> = {
  none: [0, 0],
  arrow: [1, 0],
  'open-arrow': [1, 0],
  one: [2, 0],
  'zero-one': [1, 1],
  'one-many': [2, 0],
  'zero-many': [1, 1],
};

/**
 * Exports each of the 24 showcase collections as SVG, one after another, and checks it (see
 * {@link collectionMatches}). It uses the recorded scenes only: no browser, no running server
 * and no hand-written geometry.
 */
async function encodesAllCorpusFamilies(): Promise<void> {
  expect(index.examples).toHaveLength(24);
  for (const entry of index.examples) {
    await collectionMatches(entry.collectionId);
  }
}

it(
  'encodes all corpus families without losing admitted text, notation or media',
  encodesAllCorpusFamilies,
  10000,
);

/**
 * Exports one recorded collection as SVG and checks the title, the section count, and each
 * section's nodes, wires, sequence events and fragments.
 */
async function collectionMatches(id: string): Promise<void> {
  // Act: export the collection as SVG and parse it.
  const { bindings, snapshot } = await corpusFixture(id);
  expect(snapshot.collection.id).toBe(id);
  const result = await bindings.service.exportArtifact({
    identity: {
      collectionId: snapshot.identity.collectionId,
      revision: snapshot.identity.revision,
    },
    format: 'svg',
  });
  assert(result.ok, JSON.stringify(result));
  const document = new JSDOM(new TextDecoder().decode(result.value.bytes), {
    contentType: 'image/svg+xml',
  }).window.document;

  // Check: the title, then every section.
  expect(document.querySelector('svg > title')?.textContent).toBe(snapshot.collection.title);
  expect(document.querySelectorAll('[data-section]')).toHaveLength(snapshot.scene.sections.length);
  for (const section of snapshot.scene.sections) {
    const rendered = document.querySelector(`[data-section="${section.id}"]`);
    assert(rendered, section.id);
    sectionMatches(rendered, section);
    sequenceEventsMatch(rendered, section);
    sequenceFramesMatch(rendered, section);
  }
}

/**
 * Checks a section's nodes and wires against the scene Layout supplied (the encoder's contract),
 * without recomputing any routes. Each node: its content, frame kind, shape and frame. Each
 * wire: its label content, its path, and its source and target markers.
 */
function sectionMatches(
  element: Element,
  section: PlacedSection,
): void {
  expect(element.querySelectorAll('[data-node-id]')).toHaveLength(section.nodes.length);
  for (const node of section.nodes) {
    const rendered = element.querySelector(`[data-node-id="${node.id}"]`);
    assert(rendered, node.id);
    contentMatches(rendered, node.measured.content);
    expect(rendered.getAttribute('data-frame')).toBe(node.measured.frame);
    expect(rendered.getAttribute('data-shape')).toBe(node.measured.shape);
    frameMatches(rendered, node);
  }
  expect(element.querySelectorAll('[data-wire]')).toHaveLength(section.wires.length);
  for (const wire of section.wires) {
    const rendered = element.querySelector(`[data-wire="${wire.id}"]`);
    assert(rendered, wire.id);
    contentMatches(rendered, wire.measuredLabel);
    expect(rendered.querySelector('path')?.getAttribute('d')).toBe(wire.path);
    markersMatch(rendered, [wire.sourceMarker, wire.targetMarker]);
  }
}

/**
 * Checks every measured text run (in order), every rule, and every media reference (in order)
 * appears in the element.
 */
function contentMatches(
  element: Element,
  content: MeasuredContent,
): void {
  const expectedText = content.primitives
    .filter(/** Whether the primitive is text. */ (item) => item.kind === 'text')
    .map(/** The run's text. */ (item) => item.text);
  expect(
    [...element.querySelectorAll('text')].map(
      /** The element's text. */ (item) => item.textContent,
    ),
  ).toEqual(expectedText);
  rulesMatch(element, content);
  const expectedMedia = content.primitives
    .filter(/** Whether the primitive is media. */ (item) => item.kind === 'media')
    .map(/** The media's data URI. */ (item) => item.dataUri);
  expect(
    [...element.querySelectorAll('image')].map(
      /** The image's `href`. */ (item) => item.getAttribute('href'),
    ),
  ).toEqual(expectedMedia);
}

/**
 * Checks every measured rule (a table or content separator) is drawn as a visible line with the
 * same end points, stroke colour and width, not only present as text.
 */
function rulesMatch(
  element: Element,
  content: MeasuredContent,
): void {
  const lines = [...element.querySelectorAll('line')];
  const rendered = lines.map(
    /** The line's end points, stroke colour and stroke width. */
    (line) => [
      ...numericAttributes(line, ['x1', 'y1', 'x2', 'y2']),
      line.getAttribute('stroke'),
      Number(line.getAttribute('stroke-width')),
    ],
  );
  for (const rule of content.primitives.filter(
    /** Whether the primitive is a rule. */ (item) => item.kind === 'rule',
  )) {
    expect(rendered).toContainEqual([rule.x1, rule.y1, rule.x2, rule.y2, rule.stroke, rule.width]);
  }
}

/**
 * Checks the element's marker groups are exactly `kinds`, in order (source before target), and
 * that each one paints its expected shapes (see {@link markerPaintMatches}).
 */
function markersMatch(
  element: Element,
  kinds: readonly MarkerKind[],
): void {
  const expected = kinds;
  expect(
    [...element.querySelectorAll('[data-marker]')].map(
      /** The marker's kind. */ (item) => item.getAttribute('data-marker'),
    ),
  ).toEqual(expected);
  [...element.querySelectorAll('[data-marker]')].forEach(
    /** Checks one marker against the kind at its position. */
    (marker, position) => {
      const kind = kinds[position];
      assert(kind);
      markerPaintMatches(marker, kind);
    },
  );
}

/**
 * Checks a marker paints real geometry, not only metadata: the expected number of paths (each
 * with a move/line pair and a hex stroke) and circles (each with a positive radius and a hex
 * stroke).
 */
function markerPaintMatches(
  element: Element,
  kind: MarkerKind,
): void {
  const [paths, circles] = markerElements[kind];
  expect(element.querySelectorAll('path')).toHaveLength(paths);
  expect(element.querySelectorAll('circle')).toHaveLength(circles);
  for (const path of element.querySelectorAll('path')) {
    expect(path.getAttribute('d')).toMatch(/[ML].*[ML]/u);
    expect(path.getAttribute('stroke')).toMatch(/^#[a-f0-9]{6}$/iu);
  }
  for (const circle of element.querySelectorAll('circle')) {
    expect(Number(circle.getAttribute('r'))).toBeGreaterThan(0);
    expect(circle.getAttribute('stroke')).toMatch(/^#[a-f0-9]{6}$/iu);
  }
}

/**
 * Checks a node's frame: a frame-free node has no frame shape; any other node has exactly one
 * `rect` or `polygon` child in its paint colours, with its measured size (see
 * {@link frameBoundsMatch}) and, where it applies, its header divider.
 */
function frameMatches(
  element: Element,
  placed: PlacedNode,
): void {
  const node = placed.measured;
  const frames = [...element.children].filter(
    /** Whether the child is a frame shape. */ (child) =>
      ['rect', 'polygon'].includes(child.tagName),
  );
  if (node.frame === 'none') {
    expect(frames).toHaveLength(0);
    return;
  }
  expect(frames).toHaveLength(1);
  const frame = frames[0];
  assert(frame);
  expect(frame.getAttribute('fill')).toBe(node.paint.fill);
  expect(frame.getAttribute('stroke')).toBe(node.paint.stroke);
  frameBoundsMatch(frame, placed.box);
  headingDividerMatches(element, node);
}

/**
 * Checks a frame's size: a decision's diamond has four points; every rectangular frame has the
 * node's measured width and height.
 */
function frameBoundsMatch(
  frame: Element,
  box: Box,
): void {
  if (frame.tagName === 'polygon') {
    expect(frame.getAttribute('points')?.trim().split(/\s+/u)).toHaveLength(4);
    return;
  }
  expect(Number(frame.getAttribute('width'))).toBe(box.width);
  expect(Number(frame.getAttribute('height'))).toBe(box.height);
}

/**
 * For a node with a member compartment, checks the first `line` child is the header divider:
 * full width at the header height, in the node's stroke colour. It does not look at field text.
 */
function headingDividerMatches(
  element: Element,
  node: VisualNode,
): void {
  if (!hasMemberCompartment(node)) return;
  const divider = [...element.children].find(
    /** Whether the child is a line. */ (child) => child.tagName === 'line',
  );
  assert(divider);
  expect(numericAttributes(divider, ['x1', 'y1', 'x2', 'y2'])).toEqual([
    0,
    node.headerHeight,
    node.width,
    node.headerHeight,
  ]);
  expect(divider.getAttribute('stroke')).toBe(node.paint.stroke);
}

/**
 * Whether the node has a member compartment below its header: an auto-framed entity, module,
 * interface or function taller than its header.
 */
function hasMemberCompartment(node: VisualNode): boolean {
  return (
    node.frame === 'auto' &&
    ['entity', 'module', 'interface', 'function'].includes(node.shape) &&
    node.height > node.headerHeight
  );
}

/** Checks each sequence event: its message content, its marker and its supplied points. */
function sequenceEventsMatch(
  element: Element,
  section: PlacedSection,
): void {
  expect(element.querySelectorAll('[data-sequence-event]')).toHaveLength(
    section.sequence.events.length,
  );
  for (const event of section.sequence.events) {
    const rendered = element.querySelector(`[data-sequence-event="${event.id}"]`);
    assert(rendered, event.id);
    contentMatches(rendered, event.content);
    markersMatch(rendered, [event.marker]);
    expect(rendered.querySelector('polyline')?.getAttribute('points')).toBe(
      event.points.map(/** One point as `x,y`. */ (point) => `${point.x},${point.y}`).join(' '),
    );
  }
}

/**
 * Checks fragment and branch labels as content, since checking events alone would miss an
 * erased condition or retry boundary: the sequence layer's text is every fragment's text, then
 * its branches' text, then every event's text, in that order; and each fragment's box is drawn
 * as a rectangle.
 */
function sequenceFramesMatch(
  element: Element,
  section: PlacedSection,
): void {
  const layer = element.querySelector('[data-layer="sequence"]');
  assert(layer);
  const geometry = section.sequence;
  const content = [
    ...geometry.fragments.flatMap(
      /** The fragment's content, then each branch's content. */
      (frame) => [
        frame.content,
        ...frame.branches.map(/** The branch's content. */ (branch) => branch.content),
      ],
    ),
    ...geometry.events.map(/** The event's content. */ (event) => event.content),
  ];
  const expected = content.flatMap(
    /** The content's text runs. */
    (item) =>
      item.primitives
        .filter(/** Whether the primitive is text. */ (run) => run.kind === 'text')
        .map(/** The run's text. */ (run) => run.text),
  );
  expect(
    [...layer.querySelectorAll('text')].map(/** The element's text. */ (text) => text.textContent),
  ).toEqual(expected);
  for (const frame of geometry.fragments) {
    const bounds = [frame.box.x, frame.box.y, frame.box.width, frame.box.height];
    const rectangles = [...layer.querySelectorAll('rect')].map(
      /** The rectangle's x, y, width and height as numbers. */
      (rect) => numericAttributes(rect, ['x', 'y', 'width', 'height']),
    );
    expect(rectangles).toContainEqual(bounds);
  }
}

/** The element's `keys` attributes, read in order and converted with `Number`. */
function numericAttributes(
  element: Element,
  keys: readonly string[],
): readonly number[] {
  return keys.map(/** The attribute as a number. */ (key) => Number(element.getAttribute(key)));
}
