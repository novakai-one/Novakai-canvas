# Export

Responsibility: produce retained-revision SVG, PNG, PDF, offline HTML and editable bundles; prepare uncommitted imports for Authoring.

Public entry: `@novakai/canvas-export`. `initializeRaster(module)` runs once at host startup. `composeExport(owners)` binds shared Presentation slots and real encoders. Hosts provide a consistent snapshot lease, owner resource inspection, Model/Language document operations and the supplied reader stylesheet. `createExport(dependencies)` supports equivalent in-process hosts with explicit format roles.

`exportArtifact({identity:{collectionId,revision},format,scope})` returns the bytes, their content digest and source metadata. The bytes come from the format handler's own `slice()`: a copy for a plain `Uint8Array`, but shared memory for a `Buffer`. PDF tiles ordered sections at a fixed readable scale. Native adapters do not perform filesystem downloads.

`inspectBundle(bytes)` checks the bounded versioned manifest, hashes and required owner validation. `prepareImport({bytes,targetCollectionId})` reconstructs full DSL plus manual/storage-order sidecar under a new namespace at revision zero. Authoring must revalidate and atomically admit its resources and absent-target precondition. Neither operation commits data.

Shared fonts are embedded once per exported scene. Native WOFF2 decoding serializes and copies the decoder's reusable heap; raster font aliases bind actual internal font families. Ambiguous internal names fail explicitly. WebP images are losslessly converted for PDFKit.

Verification: in-process contract cases, including the export corpus fixtures under `quality/agent-diagrams/visual-quality/stage-5/inputs/`.
