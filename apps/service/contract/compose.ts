/*
 * Composition root for the service. Every cross-adapter binding lives in the compose/ folder, one
 * module per concern: capabilities (the one capability construction site), installation (shipped
 * resources), producer (the parent realm's render worker pool), workspace, authoring, export and
 * session (the roles one workspace binds), wiring (their order), startup (open and start), serve
 * (HTTP), agent-credential (CLI credential read), headless (headless export). worker.ts is the
 * render worker realm's root; cli/render-worker.mjs loads it directly, not through this barrel.
 * Adapters never import siblings or reach another capability's private implementation.
 */
export { prepareInstallation } from './compose/installation.js';
export { openWorkspace } from './compose/startup.js';
export { serveWorkspace } from './compose/serve.js';
export { readAgentCredential } from './compose/agent-credential.js';
export { createHeadlessBindings } from './compose/headless.js';
