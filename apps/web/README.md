# Web host

Owns the header, collection chooser, inspector/settings panels, panel visibility and workspace navigation. Canvas owns camera, selection and diagram gestures; this host submits its edits through Authoring.

| Find | Location |
|---|---|
| React shell and library UI | `adapters/react/` |
| Inspector and source panel contents | `adapters/react/ObjectEditor.tsx`, `WireEditor.tsx`, `SourceEditor.tsx`, `InterfacePreferences.tsx` |
| Panel visibility/layout behavior | `core/panels/` |
| Definitions panel behavior | `core/definitions/` |
| Add panel behavior | `core/creation/` |
| Default panel arrangement | `../../resources/ui/panels.default.json` |
| Feature and renderer registration | `contract/compose.ts` |
| Workspace controller assembly | `contract/compose/workspace.ts` |
| Request builders and input decoders | `adapters/edge/request-builders.ts`, `adapters/edge/workspace-decoders.ts` |
| ID types and new IDs | `contract/brands.ts`; `contract/ports/ids.ts`, built by `adapters/edge/ids.ts` |
| Failure codes and other owners' failures | `contract/records/error-codes.ts`, `contract/errors.ts`; `contract/foreign-failures.ts` |
| Shared controls, styles and tokens | `../../capability/design-system/` |

Build the served browser assets with `pnpm --dir apps/web exec vite build`. The local service serves that build; source edits require a rebuild when using the service directly.
