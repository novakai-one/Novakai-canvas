/*
 * The one non-compose file that may import service core. It re-exports only what files outside
 * core and compose still call: `projectCollection` for the public index. Compose imports core
 * directly.
 */
export { projectCollection } from '../core/workspace/collection-projection.js';
