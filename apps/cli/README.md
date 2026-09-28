# CLI host

Two executables. The CLI parses argv, binds ports and prints. Capabilities and the local service decide domain rules. The `.theme` grammar is Templates' `readThemeSource`; the CLI reads the file and calls it. The build-spec@1 profile (descriptor, starter, lint rules) is Language's; the CLI reads the lint file, calls Language and prints.

| Run                                                      | Entry           | Does                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm canvas COMMAND`                                    | `cli/canvas.ts` | Reads and changes collections through the local service (`pnpm dev`). Every change crosses Authoring. `profile` commands and `--help` run locally, with no service. `pnpm canvas --help` lists all commands. |
| `pnpm render:png --collection ID\|FILE.canvas --out DIR` | `cli/render.ts` | Draws a collection: writes one SVG or PNG file per section into `--out`. Changes no stored collection.                                                                                                       |

## Command → owning core file

| Command                                                | Core file                                                                 | Ports it uses                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--help`                                               | `core/commands/help.ts`                                                   | none                                                                                                               |
| `describe`, `list`, `read`, `inspect`, `receipt`       | `core/reads/queries.ts`                                                   | service reads, Model check                                                                                         |
| `create`, `replace`, `patch`, `preview`                | `core/authoring/submit.ts` (source → request in `prepare.ts`)             | local files, Language, Model check, request IDs, resource reader, service reads + resources + authoring, journal   |
| `apply`, `retry`                                       | `core/authoring/reconcile.ts` (receipt first, then the identical request) | journal, service reads + resources + authoring                                                                     |
| `theme admit`, `recipe admit`                          | `core/presets/admit.ts` (`.theme` grammar: Templates)                     | local files, Language, theme grammar, request IDs, resource reader, service reads + resources + authoring, journal |
| `recipe instantiate`                                   | `core/commands/dispatch.ts` (one service call)                            | service resources                                                                                                  |
| `profile describe`, `profile scaffold`, `profile lint` | `core/profiles/commands.ts` (profile and lint rules: Language)            | local files, Language, profiles. No service.                                                                       |
| `render:png`                                           | `core/render/render.ts` (argv in `request.ts`)                            | render ports (`contract/ports/render*.ts`), resource reader, theme grammar                                         |

Argv → command: `core/commands/parse.ts` runs the steps against `table.ts` (one row per command: flags, help lines; plus the commands that take no operand): `command-words.ts` picks the command's words (`--help` wins), `operand-count.ts` counts the operand, `accepted-flags.ts` checks each flag is one the command accepts, `assembly.ts` builds the command. `command-stages.ts` holds the type each step hands on. Builders: `service-commands.ts`, `profile-commands.ts`; values are minted in `values.ts`, `recipe-values.ts`. `dispatch.ts` routes; `delivery.ts` prints the answer and is the one `--out` writer.

Add a command: its member in `contract/records/command.ts` → its row in `table.ts` (and `NoOperandCommand` when it takes no operand) → its builder in `service-commands.ts` or `profile-commands.ts` and its cases in `assembly.ts` → its case in `dispatch.ts`.

## Folder map

| Folder                                          | Holds                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/`                                          | The two executables. Import `contract/index.ts` and Node only.                                                                                                    |
| `contract/index.ts`                             | Public surface: `runCli`, `runRender`, `formatFailure`, result types.                                                                                             |
| `contract/api.ts`                               | Core entry points for compose. The only contract file that imports core.                                                                                          |
| `contract/compose.ts`, `contract/compose/`      | Composition root: builds and injects ports (`service.ts`, `profiles.ts`, `render.ts`; shared `language.ts`, `theme-grammar.ts`). Only these import adapters.      |
| `contract/brands.ts`, `schemas.ts`, `errors.ts` | Branded IDs (capability brands re-exported), foreign schemas, closed failure codes, `Result`, and the builders of render:png's faults (`faulted`, `nativeFault`). |
| `contract/records/`                             | Data shapes: command union, argv, retained request, service answers, render request/report/faults/failure; `foreign.ts` re-exports capability records.            |
| `contract/ports/`                               | One interface per seam: HTTP transport, service calls, journal, files, resource reader, Language, profiles, theme grammar, Model check, request IDs, render.      |
| `core/commands/`                                | Argv grammar, command table, help, routing.                                                                                                                       |
| `core/reads/`                                   | Read-only service commands and their text.                                                                                                                        |
| `core/authoring/`                               | DSL change → retained Authoring request → preview/apply; retry.                                                                                                   |
| `core/resources/`                               | Stage, back up and restore font/image bytes; `sha256:` digests.                                                                                                   |
| `core/presets/`                                 | Theme/recipe admission.                                                                                                                                           |
| `core/profiles/`                                | Profile commands: call Language's profiles; format the descriptor and the findings. Local only.                                                                   |
| `core/render/`                                  | `render:png` workflow: themes, font/image admission, asset records, collection, snapshot, Export's retained-resource check, sections, report.                     |
| `core/diagnostics/`, `core/shared/`             | Failure → terminal lines; Result and parse helpers.                                                                                                               |
| `adapters/argv/`                                | Node `parseArgs` → raw arguments.                                                                                                                                 |
| `adapters/service-http/`                        | Loopback HTTP transport and the three service-call adapters over it.                                                                                              |
| `adapters/files/`                               | Source and `--out` files, request journal, confined resource reads.                                                                                               |
| `adapters/render/`                              | Temp asset store, input and section files, PNG raster start-up; ports: sources (+ Export's documents), assets, themes, output (drawing, inspection, Export).      |

## Import rules

| From                                                    | May import                                                                                          | Checked by `pnpm architecture` |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| `core/`                                                 | `core/`, `contract/{records,ports,brands,schemas,errors}`. No packages, no Node.                    | yes                            |
| `adapters/`                                             | `contract/{records,ports,brands,schemas,errors}`, Node, packages. Never `core/` or another adapter. | yes                            |
| `adapters/`                                             | Never `contract/api.ts`, `index.ts` or compose.                                                     | no                             |
| `contract/` outside compose                             | Never `adapters/`.                                                                                  | yes                            |
| `contract/records/`, `ports/`, `brands.ts`, `errors.ts` | Never `core/`, `adapters/`, `api.ts`, `index.ts` or compose.                                        | yes                            |
| `contract/ports/`, `contract/records/`                  | `@novakai/*` types only via `records/foreign.ts`. Records may use `zod`. No other packages or Node. | no                             |
| `contract/` except `api.ts`                             | Never `core/`.                                                                                      | no                             |
| `cli/`                                                  | `contract/index.ts` and Node only.                                                                  | no                             |

## Failures

Every entry point returns a `Result`. Codes are the closed union in `contract/errors.ts`; branch on the code, never the message. A service or credential failure is printed exactly as its owner wrote it. After a sent request: `canvas receipt ID`, then `canvas retry ID`.
