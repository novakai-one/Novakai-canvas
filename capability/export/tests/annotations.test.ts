/*
 * SVG export of wire annotations: the exported wire keeps Layout's route and the wire's own
 * appearance, and draws the measured step badge and label where Presentation measured them.
 */
import { assert, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { fixture, value } from './fixtures.js';

/**
 * Exports the numbered fixture (step 12) as SVG and reads the `apply` wire back from the markup:
 * - its path is the routed path, in the wire's own stroke colour, width and dash pattern;
 * - the step badge is at the measured badge box, filled with the wire's stroke colour;
 * - the text reads "12validated changes", and the badge number is white;
 * - the label group is moved to the wire's label box.
 */
async function retainsNumberedAnnotations(): Promise<void> {
  // Arrange: export the numbered fixture as SVG and parse the markup.
  const numbered = true;
  const setup = await fixture('stack', numbered);
  const artifact = value(await setup.bindings.service.exportArtifact(setup.request('svg')));
  const svg = value(setup.bindings.dependencies.encoding.text(artifact.bytes));
  const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const wire = setup.snapshot.scene.sections[0]?.wires[0];
  assert(wire);
  const rendered = document.querySelector('[data-wire="apply"]');
  assert(rendered);

  // Check: the route and the wire's own appearance.
  const path = rendered.querySelector('path');
  assert(path);
  expect(path.getAttribute('d')).toBe('M240 160L500 160');
  expect(path.getAttribute('stroke')).toBe('#444444');
  expect(path.getAttribute('stroke-width')).toBe('2');
  expect(path.getAttribute('stroke-dasharray')).toBe('8 4');

  // Check: the badge sits at the measured badge box, in the wire's colour.
  const badge = rendered.querySelector('[data-badge="true"]');
  const measured = wire.measuredLabel.primitives.find(
    /** Whether the primitive is the step badge. */
    (item) => item.kind === 'badge',
  );
  assert(badge && measured?.kind === 'badge');
  expect(Number(badge.getAttribute('x'))).toBe(measured.x);
  expect(Number(badge.getAttribute('y'))).toBe(measured.y);
  expect(Number(badge.getAttribute('width'))).toBe(measured.width);
  expect(Number(badge.getAttribute('height'))).toBe(measured.height);
  expect(badge.getAttribute('fill')).toBe('#444444');

  // Check: the label text, the white badge number, and the label position.
  const text = [...rendered.querySelectorAll('text')];
  expect(text.map(/** The run's text. */ (run) => run.textContent).join('')).toBe(
    '12validated changes',
  );
  expect(text[0]?.getAttribute('fill')).toBe('#ffffff');
  const viewport = badge.closest('g[transform]');
  assert(viewport);
  expect(viewport.getAttribute('transform')).toBe(
    `translate(${wire.labelBox.x} ${wire.labelBox.y})`,
  );
}

it(
  'retains numbered annotations and connection styling in the exported SVG',
  retainsNumberedAnnotations,
);
