import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { composeDesignSystem, type Result, type PortableTheme } from '../contract/index.js';
/** Test-owned fixture source; Vitest owns filesystem/assertion failure and rerun recovery. */
export function jsonFile(relative: string): unknown {
  const value: unknown = JSON.parse(
    readFileSync(new URL('../' + relative, import.meta.url), 'utf8'),
  );
  return value;
}
/** Fail at the test boundary rather than cast arbitrary fixture JSON. */
export function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object') throw new TypeError('Fixture must be an object');
  return Object.fromEntries(Object.entries(value));
}
/** Source literals are read from their single authority; expectations remain independently specified in each case. */
export function sources(): {
  readonly schemaVersion: 1;
  readonly definitionVersion: string;
  readonly definitions: unknown;
  readonly semantics: unknown;
  readonly preferences: unknown;
  readonly themes: readonly unknown[];
} {
  return {
    schemaVersion: 1,
    definitionVersion: '1.1.0',
    definitions: jsonFile('tokens/definitions.tokens.json'),
    semantics: jsonFile('tokens/semantics.tokens.json'),
    preferences: jsonFile('tokens/preferences.tokens.json'),
    themes: [jsonFile('tokens/themes/paper.theme.json'), jsonFile('tokens/themes/ink.theme.json')],
  };
}
export const system = composeDesignSystem();
export const preferences = {
  schemaVersion: 1,
  theme: { mode: 'system' },
  textSize: 14,
  density: 'comfortable',
  motion: 'system',
};
export const environment = {
  scheme: 'light',
  pointer: 'fine',
  reducedMotion: false,
  forcedColors: false,
};
export const fonts = {
  body: { family: 'Inter', digest: 'a'.repeat(64), approved: true },
  mono: { family: 'JetBrains Mono', digest: 'b'.repeat(64), approved: true },
  strong: { family: 'Inter Tight', digest: 'd'.repeat(64), approved: true },
};
export const diagramPin = { kind: 'theme', id: 'paper', version: '1.1.0', digest: 'c'.repeat(64) };
/** Result assertions preserve diagnostics and narrow the success branch without a type assertion. */
export function must<T>(result: Result<T>): T {
  expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
  if (!result.ok) throw new TypeError(JSON.stringify(result.error));
  return result.value;
}
/** A failed public outcome must identify its category without a thrown native exception. */
export function rejected(
  result: Result<unknown>,
  code?: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  if (code) expect(result.error.code).toBe(code);
  expect(result.error.recovery).toContain('scope');
}
/** Resolve default paper without introducing host I/O or a UI process. */
export function ui(
  overrides: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof system.resolve> {
  return system.resolve({
    scope: 'ui',
    sources: sources(),
    preferences,
    environment,
    ...overrides,
  });
}
/** Exact selected UI pin is admission input; no recipe inspect/expand call is needed. */
export function themeRequest(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  const pin = must(ui()).provenance.ui;
  return { sources: sources(), theme: { base: { kind: 'ui', pin }, fonts, overrides } };
}
/** Produce complete portable data via the public token owner, never handwritten derived values. */
export function portable(overrides: Readonly<Record<string, unknown>> = {}): PortableTheme {
  return must(system.resolveTheme(themeRequest(overrides)));
}
/** Diagram request is independent from the preferences fixture and uses exact admitted metadata. */
export function diagram(
  scope: 'diagram' | 'export' = 'diagram',
  theme: PortableTheme = portable(),
): ReturnType<typeof system.resolve> {
  return system.resolve({
    scope,
    sources: sources(),
    theme,
    fonts: Object.values(fonts),
    pin: diagramPin,
  });
}
/** Replace a fixture token through detached path copies; Vitest owns malformed-fixture recovery. */
export function replacePath(
  input: unknown,
  path: readonly string[],
  value: unknown,
): unknown {
  const [head, ...tail] = path;
  if (!head) return value;
  const data = input === undefined ? {} : object(input);
  return { ...data, [head]: replacePath(data[head], tail, value) };
}
/** DTCG component input uses fractions deliberately, checking canonical byte rounding. */
export function color(
  red: number,
  green: number,
  blue: number,
  alpha = 1,
): unknown {
  return { colorSpace: 'srgb', components: [red, green, blue], alpha };
}
