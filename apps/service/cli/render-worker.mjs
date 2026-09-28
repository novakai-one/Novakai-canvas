/*
 * Why this file exists
 *
 * Laying out a diagram is slow native work, so the service runs it on a separate worker thread.
 * Node starts a worker thread from a plain JavaScript file, but the worker's code is TypeScript.
 *
 * This file is that plain start file. It loads `contract/compose/worker.ts` through tsx and starts
 * it. If the worker cannot start, it sets exit code 1. It does nothing else.
 */
import { tsImport } from 'tsx/esm/api';
const composition = await tsImport('../contract/compose/worker.ts', import.meta.url);
const started = await composition.runRenderWorker();
if (!started.ok) process.exitCode = 1;
