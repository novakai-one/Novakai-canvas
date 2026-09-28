import { assert } from 'vitest';
import { validate } from '@novakai/canvas-model';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composePresentation, resolvedStyle, fontSet } from '../contract/index.js';
import type {
  Result,
  InputCollection,
  FontSet,
  ResolvedStyle,
  Owners,
  ComposedPresentation,
  Projection,
  VisualNode,
  VisualAsset,
} from '../contract/index.js';
export const themeDigest = 'a'.repeat(64);
export const layout = { algorithm: 'grid' };
/** Public-result unwrap fails at fixture setup, never silently fabricates an expected result. */
export function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
/** Resource IO is injectable; actual offline font bytes are the default acceptance input. */
export function fonts(read: (path: URL) => Uint8Array = (path) => readFileSync(path)): FontSet {
  return fontSet.parse(
    [
      { family: 'Inter', file: 'inter-latin-400-normal.woff2' },
      { family: 'JetBrains Mono', file: 'jetbrains-mono-latin-400-normal.woff2' },
      { family: 'Inter Tight', file: 'inter-tight-latin-700-normal.woff2' },
    ].map((font) => {
      const bytes = read(new URL(`../../../resources/fonts/${font.file}`, import.meta.url));
      return {
        family: font.family,
        digest: createHash('sha256').update(bytes).digest('hex'),
        mediaType: 'font/woff2',
        base64: Buffer.from(bytes).toString('base64'),
      };
    }),
  );
}
/** Test-only token values are explicit and are never runtime fallback defaults. */
export function style(pinned: FontSet): ResolvedStyle {
  const body = pinned[0];
  const mono = pinned[1];
  const strong = pinned[2];
  assert(body && mono && strong);
  return resolvedStyle.parse({
    digest: themeDigest,
    bodyFont: { family: body.family, digest: body.digest },
    monoFont: { family: mono.family, digest: mono.digest },
    strongFont: { family: strong.family, digest: strong.digest },
    typography: {
      sectionHeading: {
        font: { family: strong.family, digest: strong.digest },
        size: 24.0,
        lineHeight: 36.0,
      },
      nodeHeading: {
        font: { family: strong.family, digest: strong.digest },
        size: 20.0,
        lineHeight: 30.0,
      },
      body: { font: { family: body.family, digest: body.digest }, size: 16, lineHeight: 24 },
      mono: { font: { family: mono.family, digest: mono.digest }, size: 16, lineHeight: 24 },
      caption: {
        font: { family: body.family, digest: body.digest },
        size: 14.0,
        lineHeight: 21.0,
      },
      annotation: {
        font: { family: body.family, digest: body.digest },
        size: 14.0,
        lineHeight: 21.0,
      },
    },
    padding: 12,
    gap: 8,
    stroke: 1,
    radius: 8,
    connection: {
      paint: { fill: '#ffffff', stroke: '#444444', text: '#222222' },
      width: 2,
      dash: [8, 4],
    },
    contentSizing: {
      widths: {
        small: { preferred: 180, maximum: 240 },
        medium: { preferred: 240, maximum: 320 },
        large: { preferred: 320, maximum: 500 },
      },
      rowMinimum: 32,
      iconBox: { small: 24, medium: 32, large: 48 },
      figureBox: { small: 180, medium: 240, large: 320 },
    },
    roles: { neutral: { fill: '#ffffff', stroke: '#334155', text: '#0f172a' } },
    surface: '#ffffff',
    text: '#0f172a',
    secondary: '#64748b',
    border: '#334155',
  });
}
/** Canonical Model validation is the integration oracle for input vocabulary. */
export function domain(input: unknown): Result<InputCollection> {
  const checked = validate(input);
  if (checked.ok) return checked;
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: '$',
      message: JSON.stringify(checked.error.diagnostics),
      recovery: 'Correct the fixture',
    },
  };
}
/** Explicit resource owners permit focused missing/unsafe-provider scenarios. */
export function owners(
  tokens: ResolvedStyle,
  asset: VisualAsset | null = null,
): Owners {
  return {
    domain: { read: domain },
    themes: { resolve: () => ({ ok: true, value: tokens }) },
    assets: { read: () => assetResult(asset) },
  };
}
/** Missing fixture asset is a typed resource failure, never a blank image. */
function assetResult(asset: VisualAsset | null): Result<VisualAsset> {
  if (asset === null)
    return {
      ok: false,
      error: {
        code: 'missing-resource',
        path: 'asset',
        message: 'Missing fixture asset',
        recovery: 'Supply asset',
      },
    };
  return { ok: true, value: asset };
}
/** Compose real fontkit and shared React components once per acceptance case. */
export async function fixture(): Promise<ComposedPresentation> {
  const pinned = fonts();
  return value(await composePresentation(owners(style(pinned)), pinned));
}
/** Minimal canonical collection fixture; all semantic defaults come from Model. */
export function collection(extra: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    schemaVersion: 1,
    id: 'demo',
    revision: 0,
    title: 'Demo',
    theme: { id: 'paper', version: '1.0.0', digest: `sha256:${themeDigest}`, roles: ['neutral'] },
    arrangement: layout,
    ...extra,
  };
}
/** Structured nodes avoid test-only casts into branded records. */
export function object(
  id: string,
  kind = 'step',
  content: readonly unknown[] = [],
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return { id, kind, label: id, content, ...extra };
}
const algorithms: Readonly<Record<string, string>> = {
  flow: 'flow',
  er: 'layered',
  modules: 'layered',
  tree: 'tree',
  sequence: 'sequence',
  state: 'flow',
  story: 'grid',
  grid: 'grid',
};
/** Section helper keeps the chosen diagram mode and layout explicit at each test. */
export function section(
  mode: string,
  ids: readonly string[],
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id: 'view',
    title: 'View',
    mode,
    layout: { algorithm: algorithms[mode] },
    appearances: ids.map((id) => ({ object: id })),
    ...extra,
  };
}
/** Rendering assertions select visible data through the public projection, not private helpers. */
export function node(
  projection: Projection,
  id: string,
): VisualNode {
  const found = projection.sections
    .flatMap((section) => section.nodes)
    .find((node) => node.objectId === id);
  assert(found, `Missing projected node ${id}`);
  return found;
}
/** Measured runs provide an independent readable content assertion surface. */
export function text(node: VisualNode): string {
  return node.content.primitives
    .filter((item) => item.kind === 'text')
    .map((item) => item.text)
    .join('\n');
}
