#!/usr/bin/env node
/*
 * Prints who depends on a module, grouped by import hops, so blast-radius claims stay factual.
 * Direct importers are hop 1; modules importing those are hop 2; and so on.
 * Usage: node tools/dependents.mjs <repo-relative-path> [more paths...]
 */
import { execFileSync } from 'node:child_process';

const targets = process.argv.slice(2).map((path) => path.replace(/^\.\//, ''));
if (targets.length === 0) {
  console.error('Usage: node tools/dependents.mjs <repo-relative-path> [more paths...]');
  process.exit(2);
}

const json = execFileSync(
  'npx',
  [
    'depcruise',
    'capability',
    'apps',
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const cruise = JSON.parse(json);

// Reverse adjacency: dependency -> the modules that import it.
const importersOf = new Map();
for (const module of cruise.modules) {
  for (const dependency of module.dependencies) {
    if (!dependency.resolved || dependency.resolved.includes('node_modules')) continue;
    const list = importersOf.get(dependency.resolved) ?? [];
    list.push(module.source);
    importersOf.set(dependency.resolved, list);
  }
}

const hops = new Map();
const queue = targets.map((path) => [path, 0]);
for (const [module, depth] of queue) {
  if (hops.has(module) && hops.get(module) <= depth) continue;
  hops.set(module, depth);
  for (const importer of importersOf.get(module) ?? []) queue.push([importer, depth + 1]);
}

for (const target of targets) hops.delete(target);
const deepest = Math.max(0, ...hops.values());
if (deepest === 0) {
  console.log('No in-repo dependents.');
  process.exit(0);
}
for (let hop = 1; hop <= deepest; hop += 1) {
  const modules = [...hops.entries()]
    .filter(([, depth]) => depth === hop)
    .map(([m]) => m)
    .sort();
  console.log(`hop ${hop} (${modules.length}):`);
  for (const module of modules) console.log(`  ${module}`);
}
console.log(`total dependents: ${hops.size}`);
