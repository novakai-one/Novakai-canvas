/** Explicit TypeScript runtime for the development worker. Parent receives startup errors and retains the current scene. */
import { tsImport } from 'tsx/esm/api';
const compose = await tsImport('../contract/compose.ts', import.meta.url);
await compose.runRenderWorker();
