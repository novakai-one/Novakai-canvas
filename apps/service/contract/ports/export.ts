/*
 * The PNG runtime port: Export encodes PNG only after its rasterizer is initialized. Composition
 * supplies the runtime; the export route asks for it lazily, on the first PNG request.
 */
import type { Result } from '../errors.js';

/** The first `prepare` starts the one initialization; later calls share that outcome, failure too. */
export interface PngRuntime {
  prepare(): Promise<Result<void>>;
}
