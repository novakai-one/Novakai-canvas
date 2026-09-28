/** Loads the worker composition root through tsx and starts it. */
import { tsImport } from 'tsx/esm/api';
const composition = await tsImport('../contract/compose/worker.ts', import.meta.url);
const started = await composition.runRenderWorker();
if (!started.ok) process.exitCode = 1;
