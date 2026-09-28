/*
 * Why this file exists
 *
 * Starting the service means building every part and plugging them together: capabilities,
 * workspace files, the render worker, Authoring, the export route and the web server. That work
 * lives in `compose/`, one file per part.
 *
 * This file lists the five entry points used from outside `compose/`. `openWorkspace` and
 * `serveWorkspace` start `pnpm dev`. The CLI reuses `prepareInstallation`, `readAgentCredential`
 * and `createHeadlessBindings`. The render worker's start file is not listed: a worker thread loads
 * it directly, so it never loads the web server.
 */
export { prepareInstallation } from './compose/installation.js';
export { openWorkspace } from './compose/startup.js';
export { serveWorkspace } from './compose/serve.js';
export { readAgentCredential } from './compose/agent-credential.js';
export { createHeadlessBindings } from './compose/headless.js';
