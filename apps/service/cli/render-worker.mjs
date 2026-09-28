/** Explicit TypeScript runtime for the development worker. Parent receives startup errors and retains the current scene. */
import { tsImport } from 'tsx/esm/api';
const worker = await tsImport('../contract/compose/worker.ts', import.meta.url);
await worker.runRenderWorker();
