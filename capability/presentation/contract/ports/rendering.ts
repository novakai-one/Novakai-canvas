import type { Result } from '../errors.js';
import type { VisualNode, MarkerKind } from '../records/visual.js';
import type { Paint } from '../records/style.js';
/** Serialization consumes the same measured React node component used by Canvas; no alternate layout. */
export interface RenderPort {
  readonly version: string;
  render(node: VisualNode): Result<string>;
  marker(
    kind: MarkerKind,
    paint: Paint,
  ): Result<string>;
}
