/*
 * Corpus fixture for Export: loads one recorded stage-5 input (collection, projection,
 * measurements, scene, fonts, style and resources captured from real DSL admissions), rechecks
 * it through the public Model, Presentation and Layout readers, and composes Export over it.
 * The encoders under test are the live ones, not saved SVGs.
 */
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { assert } from 'vitest';
import { validate, plan, stage, type Collection } from '@novakai/canvas-model';
import { createLanguage } from '@novakai/canvas-language';
import {
  createReactBindings,
  fontSet,
  resolvedStyle,
  readMeasuredProjection,
  readMeasuredContent,
  readSupplementalMeasurements,
} from '@novakai/canvas-presentation';
import { readScene, defaultEngineVersions } from '@novakai/canvas-layout';
import {
  composeExport,
  type Snapshot,
  type ExportBindings,
  type Documents,
} from '../contract/index.js';

/** The recorded file's shape: the captured payload and the resources as base64. */
const recorded = z.object({
  payload: z.object({
    collection: z.unknown(),
    projection: z.unknown(),
    measurements: z.unknown(),
    scene: z.unknown(),
    options: z.unknown(),
    fonts: fontSet,
    style: resolvedStyle,
  }),
  resources: z.array(
    z.strictObject({
      kind: z.enum(['asset', 'preset', 'font']),
      digest: z.string().regex(/^[a-f0-9]{64}$/u),
      mediaType: z.string().min(1),
      base64: z.string(),
      metadata: z.record(z.string(), z.json()),
    }),
  ),
});

/** The parsed recording. */
type Recording = z.infer<typeof recorded>;

/**
 * Loads corpus input `id` and composes Export over it. The lease always returns the recorded
 * snapshot and its release succeeds; the resource owner accepts every resource unchanged; the
 * documents provider is the real Model and Language, with the collection's own theme and assets
 * pinned.
 *
 * @param id - The corpus input name: lowercase letters and hyphens only.
 * @returns The composed Export and the snapshot it serves.
 * @throws Rejects with:
 * - an `AssertionError` with no message when `id` is not lowercase letters and hyphens;
 * - an `AssertionError` whose message is the whole result as JSON when a real reader rejects;
 * - a file-system error when the input or the reader stylesheet cannot be read;
 * - a zlib error when the input is not valid gzip, or a `SyntaxError` when it is not JSON;
 * - a `ZodError` when the recording has the wrong shape.
 */
export async function corpusFixture(
  id: string,
): Promise<{ readonly bindings: ExportBindings; readonly snapshot: Snapshot }> {
  assert(/^[a-z-]+$/u.test(id));
  const file = new URL(
    `../../../quality/agent-diagrams/visual-quality/stage-5/inputs/${id}.json.gz`,
    import.meta.url,
  );
  const raw: unknown = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
  const { payload, resources } = recorded.parse(raw);
  const collection = accepted(validate(payload.collection));
  const domain = {
    read: /** Validates through Model; a rejection fails the setup. */ (input: unknown) => ({
      ok: true as const,
      value: accepted(validate(input)),
    }),
  };
  const projection = accepted(readMeasuredProjection(payload.projection, collection, domain));
  const measurements = accepted(readSupplementalMeasurements(payload.measurements));
  const scene = accepted(
    readScene(
      { projection, measurements, options: payload.options, candidate: payload.scene },
      {
        engineVersions: defaultEngineVersions,
        projection: {
          read: /** Rereads a measured projection; a rejection fails the setup. */ (input) => ({
            ok: true,
            value: accepted(readMeasuredProjection(input, collection, domain)),
          }),
          content: /** Rereads measured content; a rejection fails the setup. */ (input) => ({
            ok: true,
            value: accepted(readMeasuredContent(input)),
          }),
        },
      },
    ),
  );
  const snapshot = corpusSnapshot(collection, scene, resources, payload.style);
  const documents = corpusDocuments(collection);
  const bindings = composeExport({
    presentation: accepted(await createReactBindings(payload.fonts)),
    snapshots: {
      acquire: /** Leases the recorded snapshot; its release always succeeds. */ async () => ({
        ok: true,
        value: {
          snapshot,
          release: /** Succeeds without doing anything. */ async () => ({
            ok: true,
            value: undefined,
          }),
        },
      }),
    },
    documents,
    resources: {
      inspect: /** Accepts every resource unchanged. */ async (items) => ({
        ok: true,
        value: items,
      }),
    },
    readerCss: await readFile(new URL('../adapters/html/reader.css', import.meta.url), 'utf8'),
  });
  return { bindings, snapshot };
}

/**
 * The value of a successful outcome. An unexpected rejection fails the setup with the whole
 * result as JSON, and never becomes an invented success. The outcome is turned into JSON even
 * when it succeeds: a cycle or a `BigInt` throws a `TypeError`, other values JSON cannot hold
 * (such as functions or `undefined`) are silently left out, and a getter or `toJSON` that
 * throws throws its own error.
 */
function accepted<T>(
  outcome: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  assert(outcome.ok, JSON.stringify(outcome));
  return outcome.value;
}

/**
 * The recorded snapshot: identity from the collection and scene, the resources with their bytes
 * decoded from base64, and the paint taken from the recorded style.
 */
function corpusSnapshot(
  collection: Collection,
  scene: Snapshot['scene'],
  resources: Recording['resources'],
  style: Recording['payload']['style'],
): Snapshot {
  return {
    identity: {
      collectionId: collection.id,
      revision: collection.revision,
      inputKey: scene.inputKey,
      title: collection.title,
    },
    collection,
    scene,
    resources: resources.map(
      /** One recorded resource with `base64` replaced by its decoded bytes. */
      ({ base64, ...resource }) => ({
        ...resource,
        bytes: Buffer.from(base64, 'base64'),
      }),
    ),
    paint: { fill: style.surface, text: style.text, stroke: style.border },
  };
}

/**
 * The documents provider, built on the real Model and Language. `read` validates, `print`
 * prints the whole collection, and `parse` lowers DSL with the collection's own theme and
 * assets pinned. Any rejection fails the setup.
 */
function corpusDocuments(collection: Collection): Documents {
  const language = createLanguage({ reader: { validate }, planner: { plan }, stage: { stage } });
  const pins = {
    themes: { [collection.theme.id]: collection.theme },
    assets: Object.fromEntries(
      collection.assets.map(/** One asset under its ID. */ (asset) => [asset.id, asset]),
    ),
  };
  return {
    read: /** Validates the input through Model. */ (input) => ({
      ok: true,
      value: accepted(validate(input)),
    }),
    print: /** Prints the whole collection as DSL source. */ (input) => ({
      ok: true,
      value: accepted(language.print({ collection: input, scope: { kind: 'all' } })).source,
    }),
    parse: /** Lowers DSL source into a new collection. */ (source) => ({
      ok: true,
      value: accepted(language.lower({ source, mode: 'create', snapshot: null, resources: pins }))
        .collection,
    }),
  };
}
