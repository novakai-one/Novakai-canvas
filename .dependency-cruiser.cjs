/** Dependency Cruiser owns configuration/filesystem failure reporting and rerun recovery. */
const { readdirSync } = require('node:fs');

const boundary = (name, root) => ({
  name: `${name}-public-surface`,
  severity: 'error',
  from: { pathNot: `^${root}/${name}/` },
  to: { path: `^${root}/${name}/`, pathNot: `^${root}/${name}/contract/index\\.ts$` },
});
const core = (name, root) => ({
  name: `${name}-core-direction`,
  severity: 'error',
  from: { path: `^${root}/${name}/core/` },
  to: {
    pathNot: `^${root}/${name}/(core/|contract/(records/|ports/|types\\.ts$|schemas\\.ts$|brands\\.ts$|errors\\.ts$|events\\.ts$))`,
  },
});
const declarations = (name, root) => ({
  name: `${name}-declarations-no-policy`,
  severity: 'error',
  from: {
    path: `^${root}/${name}/contract/(records/|ports/|types\\.ts$|brands\\.ts$|errors\\.ts$)`,
  },
  to: { path: `^${root}/${name}/(core/|adapters/|contract/(api|index|compose))` },
});
const tests = (name, root) => ({
  name: `${name}-tests-public`,
  severity: 'error',
  from: { path: `^${root}/${name}/tests/` },
  to: {
    path: `^${root}/${name}/`,
    pathNot: `^${root}/${name}/(tests/|contract/index\\.ts$|adapters/)`,
  },
});
const adapter = (name, root) => ({
  name: `${name}-adapter-isolation`,
  severity: 'error',
  from: { path: `^${root}/${name}/adapters/` },
  to: { path: `^${root}/${name}/(core/|adapters/)`, pathNot: '\\.css$' },
});
/** The composition root is the compose.ts file and its compose/ folder; only they wire adapters. */
const wiring = (name, root) => ({
  name: `${name}-adapter-wiring`,
  severity: 'error',
  from: { path: `^${root}/${name}/contract/`, pathNot: '/compose(\\.ts$|/)' },
  to: { path: `^${root}/${name}/adapters/` },
});
const rulesFor = (name, root) => [
  boundary(name, root),
  core(name, root),
  declarations(name, root),
  tests(name, root),
  adapter(name, root),
  wiring(name, root),
];

module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    ...readdirSync('capability').flatMap((name) => rulesFor(name, 'capability')),
    ...readdirSync('apps').flatMap((name) => rulesFor(name, 'apps')),
  ],
  options: {
    /** Type-only imports count: a cycle or a wrong-direction import through `import type` fails. */
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { conditionNames: ['import', 'default'], exportsFields: ['exports'] },
    exclude: { path: '\\.gitkeep$|/\\.generated/|/dist/' },
  },
};
