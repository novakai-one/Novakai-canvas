/*
 * The one non-compose file that may import service core. It re-exports only what files outside
 * core and compose still call: `projectCollection` for the public index and `historyVersionsOnly`
 * for the HTTP router. Compose imports core directly.
 */
export { historyVersionsOnly } from '../core/session/history-versions.js';
export { projectCollection } from '../core/workspace/collection-projection.js';
