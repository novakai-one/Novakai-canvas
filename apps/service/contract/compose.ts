/*
 * Composition root for the service. Every cross-adapter binding lives in the compose/ folder,
 * one module per concern: capabilities (the one capability construction site), rendering (worker
 * lifecycle), installation (shipped resources), wiring (adapter bridges), startup (open and
 * initialize), serve (HTTP), agent-credential (CLI credential read), headless (headless export).
 * Adapters never import siblings or reach another capability's private implementation.
 */
export { runRenderWorker } from './compose/worker.js';
export { prepareInstallation } from './compose/installation.js';
export { openWorkspace } from './compose/startup.js';
export { serveWorkspace } from './compose/serve.js';
export { readAgentCredential } from './compose/agent-credential.js';
export { createHeadlessBindings } from './compose/headless.js';
