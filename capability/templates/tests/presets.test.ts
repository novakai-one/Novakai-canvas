import { describe, it, expect } from 'vitest';
import { chainedThemes } from './fixtures.js';
import { createTemplates, digest, presetId } from '../contract/index.js';
import type { Preset, ThemePayload } from '../contract/index.js';
import { createIdentity } from '../adapters/identity.js';
import {
  service,
  input,
  themeInput,
  value,
  rejects,
  dependencies,
  themeCodec,
  themePayload,
  failed,
  font,
} from './fixtures.js';

describe('presets', () => {
  /**
   * The pin's digest is an independently computed SHA-256 of the canonical record. The admitted
   * record is frozen; the caller's input is not frozen. Source whitespace that the codec trims
   * gives the same pin.
   */
  it('pins canonical content with a known SHA-256 and freezes the admitted record', () => {
    // Act: plan the first admission.
    const templates = service();
    const submitted = input();
    const result = value(templates.planAdmission([], submitted));
    // Check: known digest, one new frozen record, caller input not frozen.
    expect(result.pin.digest).toBe(
      '7ded66daaa94db5699077cbdc91639c129df7e687e3ba4d846f7f61a0ea2a2ae',
    );
    expect(result.changed).toBe(true);
    expect(result.candidate).toHaveLength(1);
    expect(Object.isFrozen(result.candidate[0])).toBe(true);
    expect(Object.isFrozen(submitted)).toBe(false);
    // Check: padded source canonicalizes to the same pin.
    expect(value(templates.planAdmission([], input('1.0.0', '  fixture:hello  '))).pin).toEqual(
      result.pin,
    );
  });

  /**
   * The same version with the same content is a no-op; with different content it is
   * `version-exists`. A new version is added beside the old one, which stays readable.
   */
  it('replays an identical version, refuses an overwrite and keeps old versions', () => {
    const templates = service();
    const first = value(templates.planAdmission([], input()));
    // Replay and overwrite.
    expect(value(templates.planAdmission(first.candidate, input())).changed).toBe(false);
    rejects(
      templates.planAdmission(first.candidate, input('1.0.0', 'different')),
      'version-exists',
    );
    // Upgrade.
    const second = value(templates.planAdmission(first.candidate, input('2.0.0', 'new')));
    expect(second.candidate).toHaveLength(2);
    expect(value(templates.read(second.candidate, first.pin))).toEqual(first.candidate[0]);
  });

  /**
   * Catalog checks: a duplicate record (`duplicate-preset`), an edited record
   * (`digest-mismatch`), a base pin to an absent theme (`missing-preset`) and two themes based on
   * each other (`dependency-cycle`). A chain of 1000 themes is valid.
   */
  it('rejects duplicate, altered, missing and cyclic records and accepts a 1000-theme chain', () => {
    const templates = service();
    const first = value(templates.planAdmission([], input()));
    expect(first.candidate[0]).toBeDefined();
    // Duplicate and altered records.
    rejects(templates.list([...first.candidate, ...first.candidate], {}), 'duplicate-preset');
    rejects(
      templates.list(
        first.candidate.map((item) => ({ ...item, title: 'Tampered' })),
        {},
      ),
      'digest-mismatch',
    );
    // Base pin to an absent theme.
    const missing = {
      kind: 'theme',
      id: presetId.parse('absent'),
      version: first.pin.version,
      digest: first.pin.digest,
    } as const;
    const missingService = createTemplates(
      dependencies({
        theme: themeCodec({ ...themePayload(), base: missing }),
      }),
    );
    rejects(missingService.planAdmission([], themeInput()), 'missing-preset');
    // Themes a and b based on each other (a constant hash makes both digests valid).
    const constant = digest.parse('c'.repeat(64));
    const cyclic = createTemplates(
      dependencies({ identity: { hash: () => ({ ok: true, value: constant }) } }),
    );
    const a: Preset = {
      schemaVersion: 1,
      kind: 'theme',
      id: presetId.parse('a'),
      version: first.pin.version,
      title: 'A',
      description: '',
      digest: constant,
      payload: {
        ...themePayload(),
        base: {
          kind: 'theme',
          id: presetId.parse('b'),
          version: first.pin.version,
          digest: constant,
        },
      },
    };
    const b: Preset = {
      ...a,
      id: presetId.parse('b'),
      payload: {
        ...themePayload(),
        base: { kind: 'theme', id: a.id, version: a.version, digest: constant },
      },
    };
    rejects(cyclic.list([a, b], {}), 'dependency-cycle');
    // Long valid chain.
    expect(value(templates.list(chainedThemes(1000, dependencies().identity), {}))).toHaveLength(
      1000,
    );
  });

  /**
   * `read` without a version returns the numerically latest (2.10.0 after 2.9.0). `list` search
   * ignores case and orders versions numerically; listing only themes gives an empty list. A wrong
   * digest is `digest-mismatch`; a digest without a version is `invalid-input`.
   */
  it('reads the numerically latest version and lists matches in version order', () => {
    const templates = service();
    const first = value(templates.planAdmission([], input('2.9.0')));
    const second = value(templates.planAdmission(first.candidate, input('2.10.0')));
    // Latest and search.
    expect(value(templates.read(second.candidate, { kind: 'recipe', id: 'demo' })).version).toBe(
      '2.10.0',
    );
    expect(
      value(templates.list(second.candidate, { search: 'ER' })).map((entry) => entry.pin.version),
    ).toEqual(['2.9.0', '2.10.0']);
    expect(value(templates.list(second.candidate, { kind: 'theme' }))).toEqual([]);
    // Digest checks.
    rejects(
      templates.read(second.candidate, {
        kind: 'recipe',
        id: 'demo',
        version: '2.9.0',
        digest: 'd'.repeat(64),
      }),
      'digest-mismatch',
    );
    rejects(
      templates.read(second.candidate, { kind: 'recipe', id: 'demo', digest: 'd'.repeat(64) }),
      'invalid-input',
    );
  });

  /**
   * An admitted theme keeps its resolved font digests. Rejected as `invalid-input`: a font
   * manifest that does not match the tokens, a version with a leading zero, an unknown field, and
   * a color token that is not hex.
   */
  it('pins theme fonts and rejects bad theme output and bad versions', () => {
    const templates = service();
    const first = value(templates.planAdmission([], themeInput()));
    expect(first.candidate[0]).toMatchObject({
      kind: 'theme',
      payload: { fonts: [font], tokens: { 'font.body': { digest: font } } },
    });
    // Font manifest that does not match.
    const bad: ThemePayload = { ...themePayload(), fonts: [] };
    const invalid = createTemplates(dependencies({ theme: themeCodec(bad) }));
    rejects(invalid.planAdmission([], themeInput()), 'invalid-input');
    // Bad version and unknown field.
    rejects(templates.planAdmission([], { ...themeInput(), version: '01.0.0' }), 'invalid-input');
    rejects(templates.planAdmission([], { ...themeInput(), surprise: true }), 'invalid-input');
    // Color token that is not hex.
    const unsafe = createTemplates(
      dependencies({
        theme: themeCodec({
          ...themePayload(),
          tokens: { bad: { type: 'color', value: 'url(secret)' } },
        }),
      }),
    );
    rejects(unsafe.planAdmission([], themeInput()), 'invalid-input');
  });

  /**
   * A throwing codec and a failing hasher are `provider-failed`. Source over 1 MiB, schema
   * version 2 and a function in the input are `invalid-input`.
   */
  it('reports provider faults and rejects oversized, unsupported or non-JSON input', () => {
    // Throwing codec.
    const templates = createTemplates(
      dependencies({
        recipe: {
          ...dependencies().recipe,
          inspect: () => {
            throw new Error('Parser unavailable');
          },
        },
      }),
    );
    rejects(templates.planAdmission([], input()), 'provider-failed');
    // Failing hasher.
    const hashFailure = createTemplates(dependencies({ identity: { hash: failed } }));
    rejects(hashFailure.planAdmission([], input()), 'provider-failed');
    // Bad input.
    rejects(
      service().planAdmission([], { ...input(), source: 'a'.repeat(1024 * 1024 + 1) }),
      'invalid-input',
    );
    rejects(service().planAdmission([], { ...input(), schemaVersion: 2 }), 'invalid-input');
    rejects(service().planAdmission([], { ...input(), extra: () => 0 }), 'invalid-input');
  });
});

describe('identity adapter', () => {
  /**
   * The identity adapter's injected `compute`: a throw, or output that is not a lowercase 64-char
   * hex digest, is `provider-failed` at path `digest`; valid output is returned as the digest.
   */
  it('turns a throwing or invalid injected hash into provider-failed', () => {
    // Throwing compute.
    const throwing = createIdentity(() => {
      throw new Error('hash unavailable');
    });
    expect(throwing.hash('{}')).toMatchObject({
      ok: false,
      error: { code: 'provider-failed', path: 'digest' },
    });
    // Output that is not a digest.
    const invalid = createIdentity(() => 'NOT-HEX');
    expect(invalid.hash('{}')).toMatchObject({
      ok: false,
      error: { code: 'provider-failed', path: 'digest' },
    });
    // Valid output.
    const fixed = createIdentity(() => 'e'.repeat(64));
    expect(fixed.hash('{}')).toEqual({ ok: true, value: 'e'.repeat(64) });
  });
});
