# Panel layout data

`panels.default.json` is the shipped default panel arrangement. Change section order/side here; each section ID must be listed in `panelSectionIds` (`apps/web/contract/brands.ts`) and have a trusted definition and React renderer registered by web composition. The web does not start if this file names an unknown section.

User layout preferences are separate; upgrading defaults must preserve valid user choices. No functions, JSX, CSS, source paths or domain mutations belong in this file.
