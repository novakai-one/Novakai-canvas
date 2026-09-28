# apps/cli — how agents author collections

Read this top to bottom. Each level adds one step of detail.

## Level 1 — What this folder is

The CLI is the text front door to Novakai Canvas.

- The web app (`apps/web`) is the visual front door: people click and drag.
- The CLI is the typed front door: AI agents type commands, because they cannot click a canvas.
- Both send their work to the same local server (`apps/service`). The server saves it.

```
person in a browser  ->  apps/web  --+
                                     +->  apps/service  ->  Authoring  ->  saved collections
agent in a terminal  ->  apps/cli  --+
```

The CLI decides nothing about diagrams. It reads what was typed, sends it on, and prints the answer.
Whether a diagram is valid is decided by the capabilities (Model, Layout, ...).
Whether a change is saved is decided by Authoring.

## Level 2 — The 7 things it does

1. **Learn the diagram language** — `describe`
2. **Look at what exists** — `list`, `read`, `inspect`
3. **Change a diagram** — `create`, `replace`, `patch`; or check first with `preview`, then `apply`
4. **Recover a save whose answer was lost** — `receipt`, `retry`
5. **Add reusable pieces** — `theme admit`, `recipe admit`, `recipe instantiate`
6. **Work with build specs** — `profile describe`, `profile scaffold`, `profile lint` (no server needed)
7. **Draw a diagram to image files** — `pnpm render:png` (a separate program)

The usual agent path uses the first three, then looks at the result:

```
describe  ->  list / read  ->  create or patch  ->  inspect / render:png
 (learn)       (look)           (change)            (check the result)
```

## Level 3 — The route every command takes

Every command, whichever purpose it serves, travels the same route:

```
words typed in the terminal
  -> cli/canvas.ts               starts the program
  -> core/commands/parse.ts      turns the words into one Command, or a clear refusal
  -> core/commands/dispatch.ts   sends the Command to its purpose
  -> core/<purpose>/             decides what to ask for and what to print
  -> adapters/                   talks to the server, files and image renderer
  -> the printed answer, or a failure with a code
```

Three types carry the story along that route:

- `Command` — what was asked. One member per command. `contract/records/command.ts`
- `Result` — either the answer or a failure. Nothing throws. `contract/errors.ts`
- Failure codes — a fixed list; code branches on the code, never the message. `contract/errors.ts`

Four folders, four jobs:

- `cli/` — the two programs you run. Tiny.
- `core/` — the decisions. No network, no files, no clock.
- `adapters/` — the outside world: terminal arguments, HTTP to the server, files, the renderer.
- `contract/` — the public face, the data shapes, the error codes, and `compose/`, the one place that plugs the parts together.

## Level 4 — Each purpose, one at a time

### 1. Learn the diagram language
- `describe` asks the server for the DSL vocabulary and prints it.
- Starts in `core/reads/queries.ts`.

### 2. Look at what exists
- `list` prints the collections; `read` prints one collection's source; `inspect` prints its layout warnings.
- Starts in `core/reads/queries.ts` (collection text in `core/reads/collections.ts`, source in `core/reads/source.ts`).

### 3. Change a diagram
1. Read the `.canvas` file and parse it with the Language capability.
2. Turn it into one Authoring request with a fresh request ID (`core/authoring/prepare.ts`, `change-request.ts`).
3. Keep a copy of the request in the local journal, so it can be retried.
4. Send it: saved at once (`create`, `replace`, `patch`) or checked first (`preview`, then `apply`).
- Starts in `core/authoring/submit.ts`. `apply` starts in `core/authoring/reconcile.ts`.

### 4. Recover a save whose answer was lost
1. `receipt` asks the server whether the request was saved (`core/reads/receipt.ts`).
2. `retry` checks the receipt first; only if there is none, it resends the SAME request from the journal — never a new one.
- Starts in `core/authoring/reconcile.ts`.

### 5. Add reusable pieces
- `theme admit` reads a `.theme` file (its grammar is in `core/themes/`) and sends it with its font files.
- `recipe admit` sends a reusable diagram starter; `recipe instantiate` turns a starter into editable DSL (written with `--out`).
- Admitting starts in `core/presets/admit.ts`; instantiate is one server call in `core/commands/dispatch.ts`. Font and image files are staged by `core/resources/`.

### 6. Work with build specs
- `profile describe` explains the build-spec format; `profile scaffold` writes a starter spec; `profile lint` checks a spec against the rules.
- Runs locally, with no server.
- Starts in `core/profiles/commands.ts`. The rules are in `core/profiles/lint/`.

### 7. Draw a diagram to image files
- `pnpm render:png --collection ID --out DIR` writes one PNG or SVG per section. It changes nothing that is saved.
- Starts in `core/render/render.ts` (the typed arguments are read in `core/render/request.ts`).

---

## Reference for maintainers

**Add a command** — four places, in this order:
1. Its member in `contract/records/command.ts`.
2. Its row in `core/commands/table.ts` (words, flags, help line).
3. Its fields in `core/commands/operands.ts`.
4. Its case in `core/commands/dispatch.ts`.

**Import rules** (checked by `pnpm architecture` unless marked):
- `core/` imports only `core/` and `contract/{records,ports,brands,schemas,errors}`. No packages, no Node.
- `adapters/` imports only `contract/{records,ports,brands,schemas,errors}`, Node and packages. Never `core/` or another adapter.
- Only `contract/compose/` imports adapters.
- `contract/records/`, `ports/`, `brands.ts`, `errors.ts` never import `core/`, `adapters/` or compose.
- `cli/` imports only `contract/index.ts` and Node (not checked).

**Known exceptions** — two rule sets still live here and are moving to a capability:
the build-spec rules (`core/profiles/lint/`) and the `.theme` grammar (`core/themes/`).

**After a failed send** — run `pnpm canvas receipt ID`, then `pnpm canvas retry ID`.
