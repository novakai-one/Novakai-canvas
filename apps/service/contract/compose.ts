/*
 * Composition root for the service. Every cross-adapter binding lives in the compose/ folder,
 * one module per concern: capabilities (the one capability construction site), rendering (worker
 * lifecycle), installation (shipped resources), wiring (adapter bridges), startup (open and
 * initialize), serve (HTTP and headless).
 * Adapters never import siblings or reach another capability's private implementation.
 */
export { runRenderWorker } from './compose/rendering.js';
export { prepareInstallation } from './compose/installation.js';
export { openWorkspace } from './compose/startup.js';
export { serveWorkspace, readAgentCredential, createHeadlessBindings } from './compose/serve.js';
