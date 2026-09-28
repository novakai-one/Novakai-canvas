/*
 * Shared vocabulary for the movement-preview checks: the preview shape a geometry move returns
 * and one box within it. Pure; Authoring owns commit and recovery.
 */
import type { MoveOption } from '../../../contract/records/movement.js';

/** The geometry preview a move option carries. */
export type GeometryPreview = MoveOption['preview'];

/** One preview box: the target and where it ended up. */
export type PreviewBox = GeometryPreview['boxes'][number];
