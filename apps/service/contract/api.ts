/*
 * The one non-compose file that may import service core. It re-exports only what files outside
 * core and compose still call: `projectCollection` for the public index and the workspace reader,
 * the export rules for the export adapter and export documents, and `historyVersionsOnly` for the
 * HTTP router. Compose imports core directly.
 */
export { readExportRequest } from '../core/export/request.js';
export {
  cancelledExport,
  exportRejection,
  exportRouteFailure,
  releaseOutcome,
  settledFailure,
} from '../core/export/faults.js';
export {
  exportSnapshot,
  renderedDocument,
  selectedCollection,
  workspaceSnapshot,
} from '../core/export/snapshot.js';
export { resourceInspector } from '../core/export/resources.js';
export { artifactOutcome, dslFile, markdownFile } from '../core/export/files.js';
export { historyVersionsOnly } from '../core/session/history-versions.js';
export { projectCollection } from '../core/workspace/collection-projection.js';
