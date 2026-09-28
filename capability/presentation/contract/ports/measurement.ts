import type { FontRef } from '../records/style.js';
import type { Result } from '../errors.js';
export interface TextMetrics {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}
/** Exact pinned metrics shared by local node layout and export. Version participates in the projection input key. */
export interface MeasurementPort {
  readonly version: string;
  measure(
    text: string,
    font: FontRef,
    size: number,
  ): Result<TextMetrics>;
}
