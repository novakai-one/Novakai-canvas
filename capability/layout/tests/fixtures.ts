import { assert } from 'vitest';
import { validate } from '@novakai/canvas-model';
import { createPresentation, resolvedStyle, content } from '@novakai/canvas-presentation';
import type {
  Result as PresentationResult,
  InputCollection,
  MeasuredContent,
  Projection,
} from '@novakai/canvas-presentation';
import { createLayout, options } from '../contract/index.js';
import type {
  Result,
  Layout,
  Dependencies,
  SupplementalMeasurements,
  Scene,
  LayoutRequest,
} from '../contract/index.js';
import { createPlacement } from '../adapters/elk.js';
import { createSolver } from '../adapters/kiwi.js';
import { createRouting } from '../adapters/libavoid.js';
import { wasmLoader } from '../adapters/wasm-loader.js';
export const settings = options.parse({
  gap: { compact: 24, normal: 64, roomy: 96 },
  padding: 24,
  routeClearance: 12,
  labelGap: 8,
  sequenceGap: 48,
  activationWidth: 12,
  gridColumns: 4,
  maxBranches: 4096,
});
const digest = 'a'.repeat(64);
const tokens = resolvedStyle.parse({
  digest,
  bodyFont: { family: 'fixture', digest },
  monoFont: { family: 'fixture', digest },
  strongFont: { family: 'fixture', digest },
  typography: {
    sectionHeading: { font: { family: 'fixture', digest }, size: 18.0, lineHeight: 24.0 },
    nodeHeading: { font: { family: 'fixture', digest }, size: 15.0, lineHeight: 20.0 },
    body: { font: { family: 'fixture', digest }, size: 12, lineHeight: 16 },
    mono: { font: { family: 'fixture', digest }, size: 12, lineHeight: 16 },
    caption: { font: { family: 'fixture', digest }, size: 10.5, lineHeight: 14.0 },
    annotation: { font: { family: 'fixture', digest }, size: 10.5, lineHeight: 14.0 },
  },
  padding: 8,
  gap: 4,
  stroke: 1,
  radius: 4,
  connection: {
    paint: { fill: '#ffffff', stroke: '#444444', text: '#222222' },
    width: 2,
    dash: [8, 4],
  },
  contentSizing: {
    widths: {
      small: { preferred: 100, maximum: 120 },
      medium: { preferred: 120, maximum: 160 },
      large: { preferred: 160, maximum: 260 },
    },
    rowMinimum: 24,
    iconBox: { small: 24, medium: 32, large: 48 },
    figureBox: { small: 180, medium: 240, large: 320 },
  },
  roles: { neutral: { fill: '#ffffff', stroke: '#222222', text: '#222222' } },
  surface: '#ffffff',
  text: '#222222',
  secondary: '#444444',
  border: '#222222',
});
/** Checked result extraction makes fixture or native failures explicit at the caller's assertion. */
export function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
/** The semantic owner validates all graph fixture data before Presentation measures it. */
function domain(input: unknown): PresentationResult<InputCollection> {
  const result = validate(input);
  assert(result.ok, JSON.stringify(result));
  return { ok: true, value: result.value };
}
/** Unused resource/render providers fail loudly so tests cannot accidentally rely on fake renderer output. */
function unavailable<T>(): PresentationResult<T> {
  return {
    ok: false,
    error: {
      code: 'provider-failed',
      path: 'fixture',
      message: 'This test supplies measurement only',
      recovery: 'Use a rendering fixture',
    },
  };
}
/** Fixed exact fixture metrics isolate Layout from typography; native placement/solver/router remain real. */
const presentation = createPresentation({
  domain: { read: domain },
  themes: { resolve: () => ({ ok: true, value: tokens }) },
  assets: { read: unavailable },
  measurement: {
    version: 'fixture-monospace-8',
    measure: (text) => ({
      ok: true,
      value: { width: [...text].length * 8, ascent: 10, descent: 2 },
    }),
  },
  renderer: { version: 'not-used', render: unavailable, marker: unavailable },
});
/** Minimal canonical collection; semantic defaults are assigned by Model rather than fixture casts. */
export function collection(extra: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    schemaVersion: 1,
    id: 'layout-demo',
    revision: 0,
    title: 'Layout acceptance',
    theme: { id: 'paper', version: '1', digest: `sha256:${digest}`, roles: ['neutral'] },
    arrangement: { algorithm: 'grid' },
    ...extra,
  };
}
/** Canonical objects retain explicit kind/content at call sites. */
export function object(
  id: string,
  kind = 'step',
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return { id, kind, label: id, ...extra };
}
/** Labelled relationship fixture supplies canonical endpoints, never route coordinates to an agent interface. */
export function edge(
  id: string,
  source: string,
  target: string,
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id,
    kind: 'flow',
    label: id,
    source: { object: source },
    target: { object: target },
    ...extra,
  };
}
/** One section has explicit mode, algorithm and visible object identities. */
export function section(
  id: string,
  ids: readonly string[],
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id,
    title: id,
    mode: 'flow',
    layout: { algorithm: 'flow' },
    appearances: ids.map((object) => ({ object })),
    ...extra,
  };
}
/** Project validated semantics through the public Presentation API. */
export function project(input: unknown): Projection {
  return value(presentation.project(input));
}
/** Supplemental measured headings use the same fixture typography as event labels. */
function measured(text: string): MeasuredContent {
  return value(
    presentation.measureText({
      text,
      width: 500,
      font: tokens.bodyFont,
      size: 12,
      lineHeight: 16,
      fill: '#222222',
    }),
  );
}
/** Exact fixture marker extents deliberately differ between kinds to catch source/target confusion. */
export function metrics(projection: Projection): SupplementalMeasurements {
  return {
    version: 'fixture-markers-1',
    branchHeadings: projection.sections.flatMap((section) =>
      section.sequence.flatMap((input) => {
        if (input.item.kind === 'event') return [];
        return input.item.branches.map((branch) => ({
          section: section.id,
          fragment: input.item.id,
          branch: branch.id,
          content: measured(branch.label),
        }));
      }),
    ),
    markers: {
      none: { advance: 0, halfHeight: 0 },
      arrow: { advance: 10, halfHeight: 4 },
      'open-arrow': { advance: 12, halfHeight: 5 },
      one: { advance: 7, halfHeight: 6 },
      'zero-one': { advance: 17, halfHeight: 6 },
      'one-many': { advance: 18, halfHeight: 7 },
      'zero-many': { advance: 22, halfHeight: 7 },
    },
  };
}
/** An unknown projection must match an owner-produced fixture exactly; this reader never casts input into trusted data. */
function projectionReader(projections: readonly Projection[]): Dependencies['projection'] {
  return {
    read(input): Result<Projection> {
      const found = projections.find((source) => JSON.stringify(source) === JSON.stringify(input));
      if (!found) return rejected('Unknown owner projection');
      return { ok: true, value: found };
    },
    content(input): Result<MeasuredContent> {
      const result = content.safeParse(input);
      if (!result.success) return rejected('Invalid measured content');
      return { ok: true, value: result.data };
    },
  };
}
/** Test-only boundary rejection retains the production diagnostic shape. */
export function rejected<T>(message: string): Result<T> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'fixture',
      targets: [],
      message,
      recovery: 'Correct fixture input',
    },
  };
}
/** Real version-pinned engines are default; adversarial tests replace only the targeted dependency. */
export async function dependencies(
  projections: readonly Projection[],
  overrides: Partial<Dependencies> = {},
): Promise<Dependencies> {
  const resource = new URL('../../../resources/vendor/layout/libavoid.wasm', import.meta.url)
    .pathname;
  const routing = value(await createRouting(wasmLoader(resource)));
  return {
    projection: projectionReader(projections),
    placement: createPlacement(),
    solver: createSolver(),
    routing,
    jobs: { checkpoint: async () => ({ ok: true, value: undefined }) },
    ...overrides,
  };
}
/** Host-style creation supplies the entire accepted fixture set to the consumer-owned reader. */
export async function harness(
  projections: readonly Projection[],
  overrides: Partial<Dependencies> = {},
): Promise<Layout> {
  return createLayout(await dependencies(projections, overrides));
}
/** Host obtains a full key before marking a job current; no security authority is inferred from the key. */
export function request(
  layout: Layout,
  projection: Projection,
  previous: Scene | null = null,
): LayoutRequest {
  const input = { projection, measurements: metrics(projection), options: settings, previous };
  return { ...input, job: { id: 'test-job', inputKey: value(layout.key(input)) } };
}
/** Simple two-node flow appears repeatedly without relying on production default data. */
export function flow(extra: Readonly<Record<string, unknown>> = {}): Projection {
  return project(
    collection({
      objects: [object('alpha'), object('beta')],
      relationships: [edge('connects', 'alpha', 'beta')],
      sections: [section('flow', ['alpha', 'beta'], { wires: [{ relationship: 'connects' }] })],
      ...extra,
    }),
  );
}
/** Public scene access selects by canonical object identity rather than generated ID syntax. */
export function node(
  scene: Scene,
  id: string,
): Scene['sections'][number]['nodes'][number] {
  const found = scene.sections
    .flatMap((section) => section.nodes)
    .find((node) => node.measured.objectId === id);
  assert(found, `Missing node ${id}`);
  return found;
}
