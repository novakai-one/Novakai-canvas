import { createIdentity } from '../adapters/identity.js';
import { createTemplates } from './api.js';
import type { RecipePort, ThemePort } from './ports/codecs.js';
import type { Templates } from './types.js';

/**
 * Builds Templates with the built-in SHA-256 hasher. The host must supply both codecs. No I/O.
 *
 * @param codecs - The recipe codec (Language) and theme codec (Design System).
 * @returns A frozen {@link Templates} facade.
 * @throws Whatever a getter on `codecs` throws while its `recipe` and `theme` fields are copied;
 * nothing is caught here. Plain objects never throw.
 */
export function composeTemplates<T>(codecs: {
  readonly recipe: RecipePort<T>;
  readonly theme: ThemePort;
}): Templates<T> {
  return createTemplates({ ...codecs, identity: createIdentity() });
}
