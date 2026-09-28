/*
 * Size limits used across Export. They are plain values; no function here fails.
 */

/**
 * Presentation's projection capacity (most sections, placed nodes and wires). Export re-exports
 * Presentation's own record rather than keeping a copy, so manual snapshots and the scene
 * allocation check use the same numbers as the projection.
 */
export { PROJECTION_CAPACITY } from '@novakai/canvas-presentation';

/**
 * The most pages one PDF export may produce. Page planning checks it before a PDF document
 * exists, and the PDF encoder checks it again for pages supplied directly.
 */
export const PDF_PAGE_LIMIT = 512;
