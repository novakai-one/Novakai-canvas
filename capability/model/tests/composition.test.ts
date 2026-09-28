import { expect, it } from 'vitest';
import { validate } from '../contract/index.js';
import { base, node, section, digest, value, rejects } from './fixtures.js';

/**
 * Media-led composition: a media-top `actor` object may show at `label` detail only when the view
 * overrides its composition to `stack`; an unknown frame is a shape error; media-led composition
 * without media is a content error; a plain object defaults to frame `auto` and composition
 * `stack`.
 */
it('admits composition intent and rejects hidden or missing required media', () => {
  // Check: the figure input keeps its object and group intent.
  const original = value(validate(figureInput()));
  expect(original.objects[0]).toMatchObject({ frame: 'none', composition: 'media-top' });
  expect(original.sections[0]?.groups[0]).toMatchObject({ frame: 'panel', role: 'supporting' });

  // Check: label detail hides the required media, unless the view also asks for `stack`.
  rejects(figureInput({ detail: 'label' }), 'content', 'appearances.actor.composition');
  const labelView = value(validate(figureInput({ detail: 'label', composition: 'stack' })));
  expect(labelView.sections[0]?.appearances[0]).toMatchObject({
    detail: 'label',
    composition: 'stack',
  });

  // Check: an unknown frame, and media-led composition without media.
  rejects(figureInput({ frame: 'mystery' }), 'shape', 'frame');
  const withoutMedia = base({ objects: [node('empty', 'concept', { composition: 'media-left' })] });
  rejects(withoutMedia, 'content', 'objects.empty.composition');

  // Check: the defaults for a plain object.
  const plain = value(validate(base({ objects: [node('plain')] })));
  expect(plain.objects[0]).toMatchObject({ frame: 'auto', composition: 'stack' });
});

/**
 * Parametric figures count as composition media without any asset. Defaults are filled in
 * (`mark: 'none'`, `size: 'medium'`); an unknown form, a parameter another form owns (`mark` on
 * a screen) and a parameter the form lacks (`level` on a stack) are shape errors.
 */
it('admits parametric figures as composition media and rejects unknown forms or parameters', () => {
  // Check: a vessel and a window figure admit media-top composition; defaults are filled in.
  const basin = node('basin', 'concept', {
    composition: 'media-top',
    content: [
      { kind: 'figure', id: 'art', form: 'vessel', level: 'half', agitator: true },
      { kind: 'figure', id: 'frame', form: 'window', fill: 'full' },
      { kind: 'text', id: 'caption', text: 'Settle first', role: 'caption' },
    ],
  });
  const admitted = value(validate(base({ objects: [basin] })));
  expect(admitted.objects[0]?.content[0]).toMatchObject({
    kind: 'figure',
    form: 'vessel',
    mark: 'none',
    size: 'medium',
  });

  // Check: an unknown form.
  const unknownForm = node('bad', 'concept', {
    content: [{ kind: 'figure', id: 'art', form: 'mystery' }],
  });
  rejects(base({ objects: [unknownForm] }), 'shape', 'content.0');

  // Check: a mark on a screen figure.
  const strayMark = node('stray', 'concept', {
    content: [{ kind: 'figure', id: 'art', form: 'screen', mark: 'check' }],
  });
  rejects(base({ objects: [strayMark] }), 'shape', 'content');

  // Check: a level on a stack figure.
  const mixedParameters = node('mixed', 'concept', {
    content: [{ kind: 'figure', id: 'art', form: 'stack', level: 'full' }],
  });
  rejects(base({ objects: [mixedParameters] }), 'shape', 'content');
});

/**
 * Builds a story collection with one `actor` object (frame `none`, media-top, an image and a
 * caption) shown inside panel group `region`. The asset `figure` is declared.
 *
 * @param view - Fields added to the actor's appearance (for example `detail` or `composition`).
 * @returns The collection data (unvalidated).
 */
function figureInput(view: Readonly<Record<string, unknown>> = {}): unknown {
  return base({
    assets: [{ id: 'figure', digest, mediaType: 'image/svg+xml', alt: 'A diagram figure' }],
    objects: [
      node('actor', 'system', {
        frame: 'none',
        composition: 'media-top',
        content: [
          { kind: 'image', id: 'figure', asset: 'figure' },
          { kind: 'text', id: 'caption', text: 'An explanatory caption', role: 'caption' },
        ],
      }),
    ],
    sections: [
      section('view', 'story', {
        groups: [
          {
            id: 'region',
            title: 'Boundary',
            frame: 'panel',
            role: 'supporting',
            layout: { algorithm: 'grid' },
          },
        ],
        appearances: [{ object: 'actor', group: 'region', ...view }],
      }),
    ],
  });
}
