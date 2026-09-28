import { describe, it, expect } from 'vitest';
import { createTemplates } from '../contract/index.js';
import {
  dependencies,
  recipe,
  input,
  themeInput,
  value,
  rejects,
  themeCodec,
  themePayload,
  font,
  media,
} from './fixtures.js';

describe('instantiate', () => {
  /**
   * Instances in different namespaces get their own node IDs, the same namespace gives an equal
   * result, media include the reachable theme's fonts, `themes` lists the reachable theme's pin,
   * and a newer theme version does not change an expansion pinned to the old one.
   */
  it('expands per namespace, repeats exactly, collects theme fonts and keeps old pins', () => {
    // Arrange: a theme, then a recipe that pins it and one media asset.
    const base = createTemplates(dependencies());
    const paper = value(base.planAdmission([], themeInput()));
    const templates = createTemplates(dependencies({ recipe: recipe([paper.pin], [media]) }));
    const catalog = value(templates.planAdmission(paper.candidate, input()));
    // Act: expand twice into different namespaces.
    const first = value(
      templates.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'first' }),
    );
    const second = value(
      templates.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'second' }),
    );
    // Check: namespaced IDs, a repeatable result, fonts plus media, frozen and separate intents.
    expect(first.intent.nodes.map((node) => node.id)).toEqual(['first_start']);
    expect(second.intent.nodes.map((node) => node.id)).toEqual(['second_start']);
    expect(
      value(templates.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'first' })),
    ).toEqual(first);
    expect(first.assets).toEqual([font, media]);
    expect(first.themes).toEqual([paper.pin]);
    expect(Object.isFrozen(first.intent.nodes)).toBe(true);
    expect(first.intent).not.toBe(second.intent);
    // Act: admit theme 2.0.0 with different roles, then expand the old pin again.
    const altered = createTemplates(
      dependencies({
        theme: themeCodec({ ...themePayload(), roles: ['neutral', 'primary', 'warning'] }),
      }),
    );
    const upgraded = value(altered.planAdmission(catalog.candidate, themeInput('paper', '2.0.0')));
    // Check: the pinned expansion is unchanged.
    expect(
      value(templates.instantiate(upgraded.candidate, { pin: catalog.pin, namespace: 'first' })),
    ).toEqual(first);
  });

  /**
   * Failures: a theme pin (`invalid-input`), a changed digest (`digest-mismatch`), a namespace
   * that is not a valid ID (`invalid-input`), intent that is not JSON data (`invalid-input`), and
   * a codec whose re-inspection differs from the stored payload (`digest-mismatch`).
   */
  it('rejects a theme pin, a changed digest, a bad namespace, non-JSON intent and codec drift', () => {
    // Theme pin.
    const templates = createTemplates(dependencies());
    const paper = value(templates.planAdmission([], themeInput()));
    rejects(
      templates.instantiate(paper.candidate, { pin: paper.pin, namespace: 'one' }),
      'invalid-input',
    );
    // Changed digest.
    const catalog = value(templates.planAdmission(paper.candidate, input()));
    rejects(
      templates.instantiate(catalog.candidate, {
        pin: { ...catalog.pin, digest: 'f'.repeat(64) },
        namespace: 'one',
      }),
      'digest-mismatch',
    );
    // Namespace with a space.
    rejects(
      templates.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'bad namespace' }),
      'invalid-input',
    );
    // Codec returns a function as intent.
    const unsafe = createTemplates({
      ...dependencies(),
      recipe: { inspect: recipe().inspect, expand: () => ({ ok: true, value: () => 0 }) },
    });
    rejects(
      unsafe.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'one' }),
      'invalid-input',
    );
    // Codec now reports an extra asset on re-inspection.
    const drift = createTemplates(dependencies({ recipe: recipe([], [media]) }));
    rejects(
      drift.instantiate(catalog.candidate, { pin: catalog.pin, namespace: 'one' }),
      'digest-mismatch',
    );
  });
});
