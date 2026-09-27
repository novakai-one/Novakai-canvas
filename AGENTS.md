# Novakai Canvas — repository map

A local React diagram workspace. Humans and agents author semantic DSL; the app measures, lays out and routes it.
Start with [README.md](README.md) for the walkthrough and running instructions.

# Mandatory REQUIREMENT

Upon reading this file - you must state explicitly which of the standards and mandatory reading documents you have read.
You must stats the command that you executed to verify you have read the files listed in ## Standards and mandatory reading for agents

## Standards and Mandatory Reading for Agents:

CODING-STANDARDS.md

All files in the repo root directory with AGENTS-*.md

AGENTS-AUTHORING-GUIDE-1OF2.md
AGENTS-AUTHORING-GUIDE-2OF2.md
AGENTS-TYPESCRIPT-CODING-STANDARDS
AGENTS-SPEC-AUTHORING.md


## Find the code

| Work on | Start here |
|---|---|
| Web header, menus, collection chooser, inspector and settings | `apps/web/adapters/react/` (`WorkspaceHeader.tsx`, `LibraryBrowser.tsx`, `InterfacePreferences.tsx`); editors include `ObjectEditor.tsx` and `SourceEditor.tsx` |
| Panel placement and defaults | `apps/web/core/panels/`, `resources/ui/panels.default.json` |
| Canvas nodes, wires, trees, camera controls | `capability/canvas/adapters/react-flow/` (`CanvasSurface.tsx`, `SceneNode.tsx`, `SceneEdge.tsx`, `TreeRow.tsx`) |
| Selection, hover, zoom, drag and folding behavior | `capability/canvas/core/interaction/`, `core/scenes/`, `core/drafts/` |
| Node appearance, content and measured size | `capability/presentation/adapters/react/` (`NodeContent.tsx`, `CardChrome.tsx`); measurement in `capability/presentation/core/content/` |
| Shared React controls and resizable panels | `capability/design-system/adapters/react/`; panel components in its `panels/` folder |
| Colors, typography, spacing and themes | `capability/design-system/tokens/`; see [Design System guide](capability/design-system/README.md) for source vs generated CSS |
| Node placement, module roads/lanes and wire routing | `capability/layout/core/`; see [Layout guide](capability/layout/README.md) |
| DSL grammar, parsing, printing and patches | `capability/language/core/`; [Language guide](capability/language/README.md) |
| Diagram records and validity / collection catalog and search | `capability/model/` / `capability/library/` |
| Applying edits, revisions and recovery / physical storage | `capability/authoring/` / `capability/persistence/` |
| Assets, reusable recipes and export | `capability/assets/`, `capability/templates/`, `capability/export/` |
| Local server and CLI | `apps/service/cli/serve.ts`, `apps/cli/cli/canvas.ts` |

## Author or edit a diagram

- Read `resources/examples/walkthrough/*.canvas`; smaller starters are in `resources/recipes/`.
- Run `pnpm canvas describe` for the supported DSL vocabulary. Author semantic DSL, never node coordinates.
- Run `pnpm canvas list`, then `pnpm canvas read ID --out /tmp/diagram.canvas` to obtain editable source and its revision.
- Create with `pnpm canvas create FILE`; update with `pnpm canvas replace FILE --revision N` or `pnpm canvas patch FILE --revision N`.
- Pass `--server http://127.0.0.1:PORT --workspace PATH` for the running workspace; `preview` and `apply` support reviewing edits first.
- Local workspace databases, assets and archived diagrams live in ignored `.novakai/`; committed examples live in `resources/examples/`.
- Inspect the actual rendered result; authoring guidance and approved references are in [visual-quality SOP](docs/agent-diagrams/visual-quality/SOP.md).

## Make a code change

- Read the owning folder's README first. `core/` is behavior, `adapters/` contains React and I/O, `contract/` describes and composes the capability, `tests/` verifies it.
- React components are `.tsx`; nearby `.module.css` styles them. Shared UI colors and dimensions come from the Design System tokens.
- Follow [coding standards](CODING-STANDARDS.md) and [folder structure](docs/standards/REPO-FOLDER-STRUCTURE.md) for engineering rules and responsibility boundaries.
- Run `pnpm check`; inspect visual changes in the app. Report existing failures rather than claiming a clean check.
- Only use subagents when the user requests them.

