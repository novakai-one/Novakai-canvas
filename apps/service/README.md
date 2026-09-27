# Service host

Authenticated local HTTP service: `pnpm dev --port N --workspace PATH`.

Composes all capabilities: owns sessions, rendering and inspection jobs, resource admission and physical persistence. The web workspace and CLI both talk to it; no domain rule is decided here. Composition follows the same contract/core/adapters shape and import gates as the capabilities.

| Folder                                         | Holds                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/`                                         | Process entries: `serve.ts` (`pnpm dev`) and `render-worker.mjs` (the render worker realm)                                                |
| `contract/index.ts`                            | The only import surface for web and cli                                                                                                   |
| `contract/api.ts`                              | The one core function consumers call (`projectCollection`)                                                                                |
| `contract/errors.ts`, `types.ts`, `schemas.ts` | Service failure codes and `Result`; the `WorkspaceSession` type; capability schemas core parses with                                      |
| `contract/brands.ts`                           | Typed IDs: capability brands; service brands (generation, session/agent secrets, port, host path, render job ID); `sha256:` ⇄ bare digest |
| `contract/records/`                            | Data (see note below): capability types, then a folder per topic (`transport`, `rendering`, `planning`, `presets`, `workspace`, `export`) |
| `contract/ports/`                              | Seams: capabilities, storage, rendering, notifications, transport, export, workspace, headless                                            |
| `contract/compose/`                            | Wiring only: builds capabilities once, binds core to adapters, starts the server and the worker                                           |
| `core/session/`                                | Session facade, lifetime, startup policy, apply-then-read                                                                                 |
| `core/workspace/`                              | Snapshot → checked contents; record lookup; collection → Library projection                                                               |
| `core/authoring-roles/`                        | What the service plugs into Authoring: planners, candidate validation, feasibility, resource leases                                       |
| `core/resources/`                              | Resource selection and resource commands (restore, freeze, preset preparation, instantiate)                                               |
| `core/presets/`                                | Built-in presets, preset codecs, theme pins and theme admission                                                                           |
| `core/rendering/`                              | Render jobs and job IDs, renderer, cache, inspection                                                                                      |
| `core/export/`                                 | Export request, lease, snapshot, resources, text and file answers                                                                         |
| `core/transport/`                              | HTTP policy: admission, routes, request reading, status, envelopes, events                                                                |
| `adapters/`                                    | Real I/O, one leaf per medium: `http`, `credentials`, `render-worker`, `raster`, `files`, `storage`, `notifications`                      |

Records that also carry methods: `NativeFactories` and `NativeWorkspace` (startup handles, `records/workspace/startup.ts`), `LocalServer` (server handle, `records/transport/server.ts`), `PresetContext` and `PresetCodecs` (codec shapes, `records/presets/codecs.ts`).

An owner bag (the capabilities one core module reads) lives beside that module. The CLI-facing bags live in `contract/ports/headless.ts`.
