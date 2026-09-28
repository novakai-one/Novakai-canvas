/*
 * Shared test fixture for Export: one small real collection (two objects, one wire, a WebP
 * image, three pinned WOFF2 fonts) composed with the real Model, Language, Presentation and
 * native encoders. The fixture itself supplies the snapshot lease, the resource owner, the
 * scene geometry, and Presentation's theme resolver and asset reader.
 */
import { layoutInputKey } from '../../layout/contract/index.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assert } from 'vitest';
import sharp from 'sharp';
import { validate, plan, stage, type Collection } from '@novakai/canvas-model';
import { createLanguage } from '@novakai/canvas-language';
import {
  composePresentation,
  fontSet,
  resolvedStyle,
  type FontSet,
  type MeasuredContent,
  type Projection,
} from '@novakai/canvas-presentation';
import type { Scene, PlacedSection } from '@novakai/canvas-layout';
import {
  composeExport,
  initializeRaster,
  type Result,
  type Snapshot,
  type Resource,
  type Documents,
  type ExportBindings,
  type ExportRequest,
  type Bundle,
  type Encoding,
} from '../contract/index.js';
import { createEncoding } from '../adapters/native/encoding.js';

/** The native encoding, shared by the fixture and the tests. */
export const encoding: Encoding = createEncoding();

/** The real Language, built on Model's reader, planner and stage. */
const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });

/** The bytes the theme digest is computed from. */
const themeBytes = encoding.utf8('Export fixture theme');

/** The theme pin the fixture collection uses. */
const theme = {
  id: 'paper',
  version: '1.0.0',
  digest: `sha256:${encoding.hash(themeBytes)}`,
  roles: ['neutral'],
};

/** One pinned font of the fixture's font set. */
type PinnedFont = FontSet[number];

/**
 * The value of a successful result. Fixture setup fails loudly instead of inventing a valid
 * record.
 *
 * @param result - Any `{ ok, value }` / `{ ok: false }` result.
 * @returns The result's value.
 * @throws An `AssertionError` whose message is the whole result as JSON, when `result.ok` is
 * false. The result is turned into JSON before the check, even when it succeeds, so a value
 * JSON cannot hold (a cycle or a `BigInt`) throws a `TypeError`, and a throwing `toJSON` or
 * getter throws its own error.
 */
export function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

/**
 * A typed failure for injecting resource and codec faults.
 *
 * @param code - The failure code; defaults to `encoding-failed`.
 * @returns A new `{ ok: false }` result at path `fixture` ("Injected failure").
 * @throws Never.
 */
export function failed(
  code: 'encoding-failed' | 'resource-rejected' | 'cleanup-failed' = 'encoding-failed',
): Result<never> {
  return {
    ok: false,
    error: {
      code,
      path: 'fixture',
      message: 'Injected failure',
      recovery: 'Retry with repaired fixture',
    },
  };
}

/**
 * A typed success for injecting provider and codec results.
 *
 * @param value - The successful value; it is not copied.
 * @returns A new `{ ok: true, value }` result.
 * @throws Never.
 */
export function succeeded<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Initializes the resvg runtime, as a host does at startup. It does not guard against repeat
 * or concurrent calls: every call resolves, reads and compiles the runtime file and initializes
 * again, so callers invoke it once per test run.
 *
 * @returns A promise that settles once the runtime is ready.
 * @throws Rejects with an `AssertionError` when initialization fails, or with the file-system or
 * WebAssembly error when the runtime file cannot be found, read or compiled.
 */
export async function startRaster(): Promise<void> {
  const require = createRequire(import.meta.url);
  const file = require.resolve('@resvg/resvg-wasm/index_bg.wasm');
  value(await initializeRaster(await WebAssembly.compile(readFileSync(file))));
}

/** A composed Export plus the snapshot it serves. */
export interface Fixture {
  /** The composed Export service and its dependencies. */
  readonly bindings: ExportBindings;

  /** The snapshot every lease returns. */
  readonly snapshot: Snapshot;

  /** How many times a lease has been released so far. */
  readonly releases: () => number;

  /** An export request for the fixture collection at revision 7, in `format` (default `svg`). */
  readonly request: (
    format?: ExportRequest['format'],
  ) => Pick<ExportRequest, 'identity' | 'format'>;
}

/**
 * Composes Export over the fixture collection with the real renderer and encoders.
 *
 * The collection (`engineering`, revision 7) has an image object `alpha` in group `gate`, an
 * end object `beta`, and a dashed `apply` wire between them with stored placements and bend
 * points. The scene geometry is supplied, not laid out: the section origin is (−80, 120) and
 * the group is nested, so offsets are tested. The lease always returns the same snapshot and
 * counts releases; the resource owner accepts every resource unchanged.
 *
 * @param composition - The image object's composition; `stack` also gives it a frame.
 * @param numbered - Whether the wire carries step number 12.
 * @returns The fixture.
 * @throws Rejects with an `AssertionError` when any real collaborator rejects fixture data,
 * with a file-system error when a font or the reader stylesheet cannot be read, with sharp's
 * error when the WebP image cannot be made, and with a schema error when Presentation's
 * `fontSet` or `resolvedStyle` parse rejects the fixture data.
 */
export async function fixture(
  composition: 'stack' | 'media-top' | 'media-left' = 'stack',
  numbered = false,
): Promise<Fixture> {
  const bytes = await webpBytes();
  const image = webpResource(bytes);
  const original = collection(image, composition, numbered);
  const fonts = pinnedFonts();
  const first = fonts.at(0);
  const mono = fonts.at(1);
  const strong = fonts.at(2);
  assert(first && mono && strong);
  const paint = { fill: '#ffffff', stroke: '#334155', text: '#0f172a' };
  const style = fixtureStyle(first, mono, strong, paint);
  const presentation = value(await fixturePresentation(style, image, fonts));
  const projection = value(presentation.presentation.project(original));
  const projectedWire = projection.sections[0]?.wires[0];
  assert(projectedWire);
  const label = projectedWire.label;
  const section = placed(projection, label);
  const scene = fixtureScene(original, projection, section);
  const resources = fixtureResources(image, fonts);
  const snapshot = fixtureSnapshot(original, projection, scene, resources, paint);
  let releaseCount = 0;
  const bindings = composeExport({
    presentation: presentation.react,
    snapshots: {
      acquire:
        /** Leases the fixture snapshot; its release counts itself and succeeds. */
        async () => ({
          ok: true,
          value: {
            snapshot,
            release: /** Counts one release. */ async () => {
              releaseCount += 1;
              return { ok: true, value: undefined };
            },
          },
        }),
    },
    documents: documents(original),
    resources: {
      inspect: /** Accepts every resource unchanged. */ async (items) => ({
        ok: true,
        value: items,
      }),
    },
    readerCss: readFileSync(new URL('../adapters/html/reader.css', import.meta.url), 'utf8'),
  });
  return {
    bindings,
    snapshot,
    releases: /** The release count so far. */ () => releaseCount,
    request: /** An export request for the fixture collection. */ (format = 'svg') => ({
      identity: { collectionId: original.id, revision: 7 },
      format,
    }),
  };
}

/**
 * Reads bundle bytes as a manifest, for building corruption cases. Tests check real bundles
 * through the public inspection result instead.
 *
 * @param bytes - Bundle bytes.
 * @returns The parsed manifest (not validated).
 * @throws An `AssertionError` for malformed UTF-8, or a `SyntaxError` for invalid JSON.
 */
export function bundle(bytes: Uint8Array): Bundle {
  return JSON.parse(value(encoding.text(bytes)));
}

/**
 * Encodes an edited manifest as bundle bytes, for semantic corruption cases. Digest faults edit
 * the raw fields instead.
 *
 * @param value - The manifest.
 * @returns Its JSON as UTF-8 bytes.
 * @throws A `TypeError` when the manifest cannot be turned into JSON.
 */
export function manifestBytes(value: Bundle): Uint8Array {
  return encoding.utf8(JSON.stringify(value));
}

/** A 20 × 20 blue lossless WebP image. */
function webpBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 4, background: '#1265dd' },
  })
    .webp({ lossless: true })
    .toBuffer();
}

/** The WebP image as an `asset` resource with its digest and alt text. */
function webpResource(bytes: Buffer): Resource {
  return {
    kind: 'asset',
    digest: encoding.hash(bytes),
    mediaType: 'image/webp',
    bytes,
    metadata: { alt: 'Blue status square' },
  };
}

/** The real static font files Presentation uses: Inter, JetBrains Mono and Inter Tight. */
function pinnedFonts(): FontSet {
  return fontSet.parse(
    [
      { family: 'Inter', file: 'inter-latin-400-normal.woff2' },
      { family: 'JetBrains Mono', file: 'jetbrains-mono-latin-400-normal.woff2' },
      { family: 'Inter Tight', file: 'inter-tight-latin-700-normal.woff2' },
    ].map(
      /** Reads one font file and describes it as a pinned WOFF2 font. */
      (font) => {
        const bytes = readFileSync(
          new URL(`../../../resources/fonts/${font.file}`, import.meta.url),
        );
        return {
          family: font.family,
          digest: encoding.hash(bytes),
          mediaType: 'font/woff2',
          base64: encoding.base64(bytes),
        };
      },
    ),
  );
}

/**
 * The fixture collection, validated by Model. Labels are readable text (one holds an HTML
 * script tag, to test escaping), and the stored placements and bend points must survive export.
 */
function collection(
  resource: Resource,
  composition: 'stack' | 'media-top' | 'media-left',
  numbered: boolean,
): Collection {
  return value(
    validate({
      schemaVersion: 1,
      id: 'engineering',
      revision: 7,
      title: 'Engineering <script>alert(1)</script>',
      theme,
      arrangement: { algorithm: 'grid' },
      assets: [
        {
          id: 'picture',
          digest: `sha256:${resource.digest}`,
          mediaType: resource.mediaType,
          alt: 'Blue status square',
        },
      ],
      objects: [
        {
          id: 'alpha',
          kind: 'step',
          label: 'Agent & human',
          composition,
          frame: composition === 'stack' ? 'auto' : 'none',
          content: [{ id: 'icon', kind: 'image', asset: 'picture' }],
        },
        { id: 'beta', kind: 'end', label: 'Admitted revision' },
      ],
      relationships: [
        {
          id: 'apply',
          kind: 'flow',
          label: 'validated changes',
          ...numberedStep(numbered),
          source: { object: 'alpha' },
          target: { object: 'beta' },
        },
      ],
      sections: [
        {
          id: 'flow',
          title: 'Authoring',
          mode: 'flow',
          layout: { algorithm: 'flow' },
          groups: [
            {
              id: 'gate',
              title: 'Validation group',
              layout: { algorithm: 'flow' },
              placement: { x: 20, y: 30, locked: true },
            },
          ],
          appearances: [
            { object: 'alpha', group: 'gate', placement: { x: 31, y: 42, locked: true } },
            { object: 'beta' },
          ],
          wires: [
            {
              relationship: 'apply',
              manual: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
              ],
              locked: true,
              sourceSide: 'right',
              targetSide: 'left',
            },
          ],
          placement: { x: -80, y: 120, locked: true },
        },
      ],
    }),
  );
}

/** The wire's step number field: `{ step: 12 }` when `numbered`, otherwise no field at all. */
function numberedStep(numbered: boolean): { readonly step?: number } {
  return numbered ? { step: 12 } : {};
}

/**
 * The resolved theme style: the three pinned fonts, fixed type sizes, spacing, the dashed
 * connection appearance and the content sizing Presentation measures with.
 */
function fixtureStyle(
  first: PinnedFont,
  mono: PinnedFont,
  strong: PinnedFont,
  paint: { fill: string; stroke: string; text: string },
): ReturnType<typeof resolvedStyle.parse> {
  return resolvedStyle.parse({
    digest: encoding.hash(themeBytes),
    bodyFont: fontReference(first),
    monoFont: fontReference(mono),
    strongFont: fontReference(strong),
    typography: {
      sectionHeading: {
        font: fontReference(strong),
        size: 24.0,
        lineHeight: 36.0,
      },
      nodeHeading: {
        font: fontReference(strong),
        size: 20.0,
        lineHeight: 30.0,
      },
      body: { font: fontReference(first), size: 16, lineHeight: 24 },
      mono: { font: fontReference(mono), size: 16, lineHeight: 24 },
      caption: {
        font: fontReference(first),
        size: 14.0,
        lineHeight: 21.0,
      },
      annotation: {
        font: fontReference(first),
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
    roles: { neutral: paint },
    surface: '#ffffff',
    text: '#0f172a',
    secondary: '#64748b',
    border: '#334155',
  });
}

/** A new font reference: the pinned font's family, then its digest. */
function fontReference(font: PinnedFont): Pick<PinnedFont, 'family' | 'digest'> {
  return { family: font.family, digest: font.digest };
}

/**
 * Composes the real Presentation. Its domain reader is Model's `validate` (a rejection becomes
 * `invalid-input` carrying the whole result as JSON), its theme resolver always returns `style`,
 * and its asset reader always returns the WebP image.
 */
function fixturePresentation(
  style: ReturnType<typeof resolvedStyle.parse>,
  image: Resource,
  fonts: FontSet,
): ReturnType<typeof composePresentation> {
  return composePresentation(
    {
      domain: {
        read:
          /** Validates through Model, keeping the whole rejection in the message. */
          (input) => {
            const result = validate(input);
            if (result.ok) return result;
            return {
              ok: false,
              error: {
                code: 'invalid-input',
                path: '$',
                message: JSON.stringify(result),
                recovery: 'Repair fixture',
              },
            };
          },
      },
      themes: {
        resolve: /** Always the fixture style. */ () => ({ ok: true, value: style }),
      },
      assets: {
        read: /** Always the fixture WebP image, 20 × 20. */ () => ({
          ok: true,
          value: {
            digest: image.digest,
            mediaType: 'image/webp',
            base64: encoding.base64(image.bytes),
            width: 20,
            height: 20,
          },
        }),
      },
    },
    fonts,
  );
}

/**
 * The documents provider, built on the real Model and Language: `read` validates, `print` prints
 * the whole collection as DSL, `parse` lowers DSL with the collection's own theme and assets
 * pinned. Every rejection becomes the fixture's `encoding-failed` failure.
 */
function documents(original: Collection): Documents {
  const resources = {
    themes: { paper: original.theme },
    assets: Object.fromEntries(
      original.assets.map(/** One asset under its ID. */ (asset) => [asset.id, asset]),
    ),
  };
  return {
    read: /** Validates the input through Model. */ (input) => translate(validate(input)),
    print: /** Prints the whole collection as DSL source. */ (collection) => {
      const printed = language.print({ collection, scope: { kind: 'all' } });
      if (!printed.ok) return failed();
      return { ok: true, value: printed.value.source };
    },
    parse: /** Lowers DSL source into a new collection. */ (source) => {
      const parsed = language.lower({ source, mode: 'create', snapshot: null, resources });
      if (!parsed.ok) return failed();
      return { ok: true, value: parsed.value.collection };
    },
  };
}

/**
 * Passes a success through as it is; replaces any other capability's failure with the fixture's
 * `encoding-failed` failure, without importing that capability's error types.
 */
function translate(
  result: { readonly ok: true; readonly value: Collection } | { readonly ok: false },
): Result<Collection> {
  if (result.ok) return result;
  return failed();
}

/**
 * Supplied geometry for the projection's first section: section origin and box at (−80, 120),
 * nodes in a row 260 apart, the `apply` wire between the first and last node, and one sequence
 * message with an activation. Every label uses `label`'s measured size.
 */
function placed(
  projection: Projection,
  label: MeasuredContent,
): PlacedSection {
  const section = projection.sections.at(0);
  assert(section);
  const nodes = section.nodes.map(
    /** Places one node in the row. */
    (node, index) => ({
      id: node.id,
      parent: node.parent,
      sectionId: section.id,
      box: { x: 40 + index * 260, y: 80, width: node.width, height: node.height },
      measured: node,
    }),
  );
  const first = nodes.at(0);
  const last = nodes.at(-1);
  assert(first && last);
  return {
    id: section.id,
    origin: { x: -80, y: 120 },
    box: { x: -80, y: 120, width: 1000, height: 800 },
    title: {
      content: section.title,
      box: { x: 10, y: 10, width: section.title.width, height: section.title.height },
    },
    inputKey: layoutInputKey.parse(projection.inputKey),
    nodes,
    wires: [
      {
        id: 'apply',
        source: { node: first.id, member: null, point: { x: 240, y: 160 }, side: 'right' },
        target: { node: last.id, member: null, point: { x: 500, y: 160 }, side: 'left' },
        points: [
          { x: 240, y: 160 },
          { x: 500, y: 160 },
        ],
        path: 'M240 160L500 160',
        labelBox: { x: 300, y: 130, width: label.width, height: label.height },
        measuredLabel: label,
        appearance: {
          paint: { fill: '#ffffff', stroke: '#444444', text: '#222222' },
          width: 2,
          dash: [8, 4],
        },
        sourceMarker: 'one',
        targetMarker: 'zero-many',
        style: 'dashed',
      },
    ],
    sequence: {
      lifelines: [{ participant: first.id, from: { x: 100, y: 300 }, to: { x: 100, y: 600 } }],
      events: [
        {
          id: 'message',
          source: first.id,
          target: last.id,
          points: [
            { x: 100, y: 400 },
            { x: 500, y: 400 },
          ],
          labelBox: { x: 200, y: 370, width: label.width, height: label.height },
          content: label,
          marker: 'arrow',
          message: 'call',
        },
      ],
      fragments: [],
      activations: [
        {
          participant: first.id,
          fromEvent: 'message',
          toEvent: null,
          box: { x: 95, y: 400, width: 10, height: 100 },
        },
      ],
      source: [],
    },
  };
}

/** The scene: one supplied section at revision 7, bounded by that section's box. */
function fixtureScene(
  original: Collection,
  projection: Projection,
  section: PlacedSection,
): Scene {
  return {
    collectionId: original.id,
    revision: 7,
    inputKey: layoutInputKey.parse(projection.inputKey),
    engineVersions: ['explicit-contract-fixture'],
    sections: [section],
    bounds: section.box,
    warnings: [],
    adjustments: [],
  };
}

/** The snapshot's resources: the WebP image, the theme preset, then the three pinned fonts. */
function fixtureResources(
  image: Resource,
  fonts: FontSet,
): readonly Resource[] {
  return [
    image,
    {
      kind: 'preset',
      digest: encoding.hash(themeBytes),
      mediaType: 'application/json',
      bytes: themeBytes,
      metadata: { kind: 'theme' },
    },
    ...fonts.map(
      /** One pinned font as a `font` resource with its decoded bytes. */
      (font) => ({
        kind: 'font' as const,
        digest: font.digest,
        mediaType: font.mediaType,
        bytes: Buffer.from(font.base64, 'base64'),
        metadata: { family: font.family },
      }),
    ),
  ];
}

/** The snapshot every lease returns: identity at revision 7, collection, scene and resources. */
function fixtureSnapshot(
  original: Collection,
  projection: Projection,
  scene: Scene,
  resources: readonly Resource[],
  paint: Snapshot['paint'],
): Snapshot {
  return {
    identity: {
      collectionId: original.id,
      revision: 7,
      inputKey: layoutInputKey.parse(projection.inputKey),
      title: original.title,
    },
    collection: original,
    scene,
    resources,
    paint,
  };
}
