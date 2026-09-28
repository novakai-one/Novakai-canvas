/*
 * PNG export through resvg (WASM). The SVG from the shared renderer is wrapped in a viewport of
 * whole pixels, its font aliases are replaced by the real family names, and resvg draws it with
 * only the pinned font files. The resvg runtime must already be initialized
 * (`initializeRaster`).
 */
import { Resvg } from '@resvg/resvg-wasm';
import type { FontDecoder, RenderDependencies, NativeFont } from '../../contract/render-types.js';
import type { FormatHandler, RenderInput } from '../../contract/ports/formats.js';
import type { Result } from '../../contract/errors.js';
import type { Encoded } from '../../contract/records/artifact.js';
import { failure, success } from '../../contract/errors.js';

/** The SVG namespace for the outer viewport element. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Creates the PNG format handler.
 *
 * `encode` renders the SVG, decodes the fonts, checks cancellation, checks the raster size,
 * then draws. Each step's failure is returned as it is and no partial PNG is produced:
 * - a renderer or font failure, unchanged;
 * - `cancelled` when the signal is aborted after font decoding;
 * - `limit-exceeded` at `raster` when a side is over 8,192 pixels or the area is over 64
 *   million pixels (Export checks this before encoding too; the check is repeated here for
 *   hosts that call the handler directly);
 * - `encoding-failed` at `png` when resvg throws or its image size differs from the plan.
 *
 * The raster is the selection's bounds times the request scale, each rounded up to whole
 * pixels. Every native object is freed, even when drawing throws. The caller releases the
 * snapshot lease.
 *
 * @param deps - The shared SVG renderer.
 * @param fonts - The pinned-font decoder.
 * @returns The handler; `encode` does not keep state between calls.
 * @throws Never. `encode` rejects only if the renderer or `fonts.decode` throws, or a getter
 * throws: on the input (such as `signal.aborted`, the bounds or the scale) or on a result they
 * return. Export's `produce` turns that into `encoding-failed`.
 */
export function createPngEncoder(
  deps: Pick<RenderDependencies, 'renderer'>,
  fonts: FontDecoder,
): FormatHandler {
  /** Renders, decodes fonts, then rasterizes; see {@link createPngEncoder}. */
  async function encode(input: RenderInput): Promise<Result<Encoded>> {
    const rendered = deps.renderer.render(input);
    if (!rendered.ok) return rendered;
    const decoded = await fonts.decode();
    if (!decoded.ok) return decoded;
    return afterFonts(rendered.value, input, decoded.value);
  }
  return { encode };
}

/**
 * Checks cancellation right after the asynchronous font work, then rasterizes. Rasterizing is
 * synchronous, so there is no later point to check.
 */
function afterFonts(
  svg: string,
  input: RenderInput,
  fonts: readonly NativeFont[],
): Result<Encoded> {
  if (input.signal.aborted)
    return failure('cancelled', '$', 'Export cancelled after font decoding');
  return rasterize(svg, input, fonts);
}

/**
 * Sizes the raster, checks the native limits, then draws. Only drawing is inside the `try`: a
 * throw while drawing becomes `encoding-failed`, but a throwing bounds or scale read escapes.
 */
function rasterize(
  svg: string,
  input: RenderInput,
  fonts: readonly NativeFont[],
): Result<Encoded> {
  const width = Math.ceil(input.selection.bounds.width * input.request.scale);
  const height = Math.ceil(input.selection.bounds.height * input.request.scale);
  if (Math.max(width, height) > 8192 || width * height > 64000000)
    return failure(
      'limit-exceeded',
      'raster',
      'Raster dimensions exceed the native allocation budget',
    );
  try {
    return renderNative(bindFamilies(svg, fonts), input, fonts, width, height);
  } catch {
    return failure('encoding-failed', 'png', 'Native raster encoding failed');
  }
}

/**
 * Replaces each `font-family="canvas-<digest>"` attribute with the font's real family name, so
 * resvg finds the pinned font. Other font rules in the SVG are left as they are.
 */
function bindFamilies(
  svg: string,
  fonts: readonly NativeFont[],
): string {
  return fonts.reduce(
    /** Replaces one font's alias with its escaped family name. */
    (text, font) =>
      text.replaceAll(
        `font-family="${font.alias}"`,
        `font-family="${escapeAttribute(font.family)}"`,
      ),
    svg,
  );
}

/** Escapes `&`, `"` and `<` for an XML attribute; family names come from font files. */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Draws the SVG with resvg using only the pinned fonts, and frees the renderer afterwards. */
function renderNative(
  svg: string,
  input: RenderInput,
  fonts: readonly NativeFont[],
  width: number,
  height: number,
): Result<Encoded> {
  const viewport = rasterViewport(svg, width, height, input.request.scale);
  const renderer = new Resvg(viewport, {
    font: { fontBuffers: fonts.map(/** The font's decoded font bytes. */ (font) => font.bytes) },
  });
  try {
    return readImage(renderer, width, height);
  } finally {
    renderer.free();
  }
}

/**
 * Wraps the SVG in an outer element of whole pixels whose view box keeps the requested scale.
 * Rounding the size up only adds the fractional remainder as empty space at the edges.
 */
function rasterViewport(
  svg: string,
  width: number,
  height: number,
  scale: number,
): string {
  const size = `width="${width}" height="${height}"`;
  const viewBox = `viewBox="0 0 ${width / scale} ${height / scale}"`;
  return `<svg xmlns="${SVG_NAMESPACE}" ${size} ${viewBox}>${svg}</svg>`;
}

/**
 * Draws the image, copies its PNG bytes, then checks resvg produced the planned size. The image
 * is freed afterwards, even when a step throws.
 */
function readImage(
  renderer: InstanceType<typeof Resvg>,
  width: number,
  height: number,
): Result<Encoded> {
  const image = renderer.render();
  try {
    const bytes = image.asPng().slice();
    if (image.width !== width || image.height !== height)
      return failure('encoding-failed', 'png', 'Native dimensions differ from the planned raster');
    return success({ bytes, pages: [], warnings: [] });
  } finally {
    image.free();
  }
}
