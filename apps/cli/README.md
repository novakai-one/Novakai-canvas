# CLI host

Two executables. The CLI parses argv, binds ports and prints. Capabilities and the local service decide domain rules, with two exceptions in `core/`: the build-spec@1 lint rules (`core/profiles/lint/`; a follow-up moves them into a capability) and the `.theme` grammar (`core/themes/`).

| Run                                                      | Entry           | Does                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm canvas COMMAND`                                    | `cli/canvas.ts` | Reads and changes collections through the local service (`pnpm dev`). Every change crosses Authoring. `profile` commands and `--help` run locally, with no service. `pnpm canvas --help` lists all commands. |
| `pnpm render:png --collection ID\|FILE.canvas --out DIR` | `cli/render.ts` | Draws a collection: writes one SVG or PNG file per section into `--out`. Changes no stored collection.                                                                                                       |

## Command → owning core file

| Command                                                | Core file                                                                 | Ports it uses                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--help`                                               | `core/commands/help.ts`                                                   | none                                                                                                             |
| `describe`, `list`, `read`, `inspect`, `receipt`       | `core/reads/queries.ts`                                                   | service reads, Model check                                                                                       |
| `create`, `replace`, `patch`, `preview`                | `core/authoring/submit.ts` (source → request in `prepare.ts`)             | local files, Language, Model check, request IDs, resource reader, service reads + resources + authoring, journal |
| `apply`, `retry`                                       | `core/authoring/reconcile.ts` (receipt first, then the identical request) | journal, service reads + resources + authoring                                                                   |
| `theme admit`, `recipe admit`                          | `core/presets/admit.ts` (`.theme` grammar in `core/themes/`)              | local files, Language, request IDs, resource reader, service reads + resources + authoring, journal              |
| `recipe instantiate`                                   | `core/commands/dispatch.ts` (one service call)                            | service resources                                                                                                |
| `profile describe`, `profile scaffold`, `profile lint` | `core/profiles/commands.ts` (lint rules in `core/profiles/lint/`)         | local files, Language. No service.                                                                               |
| `render:png`                                           | `core/render/render.ts` (argv in `request.ts`)                            | render ports (`contract/ports/render.ts`), resource reader                                                       |

Argv → command: `core/commands/parse.ts` checks words against `table.ts` (one row per command: operands, flags, help lines). Values are minted in `values.ts`, `operands.ts`, `recipe-values.ts`, `profile-operands.ts`. `dispatch.ts` routes and is the one `--out` writer.

Add a command: its member in `contract/records/command.ts` → its row in `table.ts` → its fields in `operands.ts` → its case in `dispatch.ts`.

## Folder map

| Folder                                          | Holds                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/`                                          | The two executables. Import `contract/index.ts` and Node only.                                                                                                    |
| `contract/index.ts`                             | Public surface: `runCli`, `runRender`, `formatFailure`, result types.                                                                                             |
| `contract/api.ts`                               | Core entry points for compose. The only contract file that imports core.                                                                                          |
| `contract/compose.ts`, `contract/compose/`      | Composition root: builds and injects ports per command family (`service.ts`, `profiles.ts`, `render.ts`, `language.ts`). The only files that import adapters.     |
| `contract/brands.ts`, `schemas.ts`, `errors.ts` | Branded IDs (capability brands re-exported), foreign schemas, closed failure codes, `Result` and the `provider-failed` fault a native throw becomes.              |
| `contract/records/`                             | Data shapes: command union, argv, retained request, service answers, theme source, render request/report/failure, provider fault, profiles.                       |
| `contract/ports/`                               | One interface per I/O seam: HTTP transport, service reads/authoring/resources, journal, local files, resource reader, Language, Model check, request IDs, render. |
| `core/commands/`                                | Argv grammar, command table, help, routing.                                                                                                                       |
| `core/reads/`                                   | Read-only service commands and their text.                                                                                                                        |
| `core/authoring/`                               | DSL change → retained Authoring request → preview/apply; retry.                                                                                                   |
| `core/resources/`                               | Stage, back up and restore font/image bytes; `sha256:` digests.                                                                                                   |
| `core/presets/`, `core/themes/`                 | Theme/recipe admission; the `.theme` grammar.                                                                                                                     |
| `core/profiles/`                                | build-spec@1: descriptor, starter, lint rules. Local only.                                                                                                        |
| `core/render/`                                  | `render:png` workflow: themes, collection, snapshot, sections, report.                                                                                            |
| `core/diagnostics/`, `core/shared/`             | Failure → terminal lines; Result and parse helpers.                                                                                                               |
| `adapters/argv/`                                | Node `parseArgs` → raw arguments.                                                                                                                                 |
| `adapters/service-http/`                        | Loopback HTTP transport and the three service-call adapters over it.                                                                                              |
| `adapters/files/`                               | Source and `--out` files, request journal, confined resource reads.                                                                                               |
| `adapters/render/`                              | Temp asset store, file I/O, PNG raster start-up; the render environment's parts: capability rules, lowering and documents port, the service's drawing, Export.    |

## Import rules

| From                                                    | May import                                                                                          | Checked by `pnpm architecture` |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| `core/`                                                 | `core/`, `contract/{records,ports,brands,schemas,errors}`. No packages, no Node.                    | yes                            |
| `adapters/`                                             | `contract/{records,ports,brands,schemas,errors}`, Node, packages. Never `core/` or another adapter. | yes                            |
| `adapters/`                                             | Never `contract/api.ts`, `index.ts` or compose.                                                     | no                             |
| `contract/` outside compose                             | Never `adapters/`.                                                                                  | yes                            |
| `contract/records/`, `ports/`, `brands.ts`, `errors.ts` | Never `core/`, `adapters/`, `api.ts`, `index.ts` or compose.                                        | yes                            |
| `contract/` except `api.ts`                             | Never `core/`.                                                                                      | no                             |
| `cli/`                                                  | `contract/index.ts` and Node only.                                                                  | no                             |

## Failures

Every entry point returns a `Result`. Codes are the closed union in `contract/errors.ts`; branch on the code, never the message. A service or credential failure is printed exactly as its owner wrote it. After a sent request: `canvas receipt ID`, then `canvas retry ID`.
