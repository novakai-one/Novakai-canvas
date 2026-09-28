import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { ReactBindings, StaticRenderer } from '../contract/react-types.js';
import type { RenderPort } from '../contract/ports/rendering.js';
import type { Result } from '../contract/errors.js';
import { fail } from '../contract/errors.js';
/** React serialization errors reject export; caller retains the current collection and repairs its resource. */
function render(
  element: ReactNode,
  native: StaticRenderer,
): Result<string> {
  try {
    return { ok: true, value: native(element) };
  } catch {
    return fail('provider-failed', 'renderer', 'React markup serialization failed');
  }
}
/** Static output invokes the same composed React components; it is not an alternate node layout engine. */
export function createMarkupRenderer(
  bindings: Pick<ReactBindings, 'NodeContent' | 'Marker'>,
  native: StaticRenderer = renderToStaticMarkup,
): RenderPort {
  return {
    version: 'react-19.3/presentation-9',
    render: (node) => render(createElement(bindings.NodeContent, { node }), native),
    marker: (kind, paint) => render(createElement(bindings.Marker, { kind, paint }), native),
  };
}
