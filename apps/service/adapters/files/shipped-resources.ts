import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fontSet, fontSource } from '@novakai/canvas-presentation';
import type { FontSource } from '@novakai/canvas-presentation';
import type { Assets } from '@novakai/canvas-assets';
import type { TokenFileBindings } from '@novakai/canvas-design-system';
import type { RecipePayload } from '@novakai/canvas-templates';
import type { BuiltinSources } from '../../contract/records/builtins.js';
import { failure, type Result } from '../../contract/errors.js';
/** Typed staging failure is caught before any canonical startup admission; previously staged bytes remain collectible. */
class BuiltinFault extends Error {}
/** A rejected owner operation never creates a fabricated empty built-in source. */
function accepted<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new BuiltinFault('Built-in resource owner rejected input');
  return result.value;
}
/** Stage exact shipped bytes through Assets' real font codec before constructing a Presentation font source. */
async function font(
  root: string,
  file: string,
  assets: Pick<Assets, 'stage' | 'resolve'>,
): Promise<FontSource> {
  const bytes = await readFile(join(root, 'fonts', file));
  const admission = accepted(
    await assets.stage({
      base64: bytes.toString('base64'),
      mediaType: 'font/woff2',
      alt: file,
      provenance: { source: `bundled:fonts/${file}`, license: 'SIL Open Font License 1.1' },
    }),
  );
  const blob = accepted(assets.resolve(admission.descriptor.digest));
  return fontSource.parse({
    digest: blob.descriptor.digest,
    family: blob.descriptor.fontFamily,
    mediaType: blob.descriptor.mediaType,
    base64: blob.base64,
  });
}
/** File names are a closed installation manifest; authored DSL cannot select arbitrary service paths. */
async function recipe(
  root: string,
  family: RecipePayload['family'],
): Promise<BuiltinSources['recipes'][number]> {
  return { family, source: await readFile(join(root, 'recipes', `${family}.canvas`), 'utf8') };
}
/** Native startup reads/stages resources only; Authoring must admit their preset/workspace bindings atomically afterward. */
export async function loadBuiltinSources(
  resourceRoot: string,
  assets: Pick<Assets, 'stage' | 'resolve'>,
  tokens: TokenFileBindings,
): Promise<Result<BuiltinSources>> {
  try {
    const [body, mono, strong, source, recipes] = await Promise.all([
      font(resourceRoot, 'inter-latin-400-normal.woff2', assets),
      font(resourceRoot, 'jetbrains-mono-latin-400-normal.woff2', assets),
      font(resourceRoot, 'inter-tight-latin-700-normal.woff2', assets),
      tokens.source.read(),
      Promise.all(
        (['er', 'modules', 'sop', 'mindmap', 'sequence', 'infographic'] as const).map((family) =>
          recipe(resourceRoot, family),
        ),
      ),
    ]);
    return {
      ok: true,
      value: { fonts: fontSet.parse([body, mono, strong]), tokens: accepted(source), recipes },
    };
  } catch {
    return failure(
      'unavailable',
      'builtins',
      'Bundled fonts, recipes or token definitions could not be loaded',
    );
  }
}
