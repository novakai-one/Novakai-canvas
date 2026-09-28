/*
 * The one non-compose file that may import service core. It re-exports only what files outside
 * core and compose still call, for the public index: `projectCollection` (web) and `validReport`
 * (CLI). Compose imports core directly.
 */
export { projectCollection } from '../core/workspace/collection-projection.js';
export { validReport } from '../core/rendering/inspection.js';
