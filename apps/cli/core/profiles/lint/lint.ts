/*
 * The build-spec structural lint entry point: index the source, run the five rule groups —
 * sections, repo tree, modules, entities/CRUD, appendix content — and summarise. The rules live
 * in this folder; each returns its findings and this file only orders and counts them.
 */
import type {
  ProfileDeclarationIndex,
  ProfileLintResult,
  ProfileSource,
} from '../../../contract/records/profiles.js';
import { buildSpecProfile } from '../build-spec.js';
import { lintSections } from './sections.js';
import { lintRepo } from './repo.js';
import { lintModules } from './modules.js';
import { lintEntitiesAndCrud } from './crud.js';
import { lintAppendices } from './appendices.js';

/**
 * Lint a parsed source against build-spec@1.
 *
 * A non-canvas source is invalid with no findings. Otherwise the findings of the five rule
 * groups are returned in section, repo, modules, entities and appendix order, and the summary
 * counts them.
 */
export function lintBuildSpec(source: ProfileSource): ProfileLintResult {
  const indexed = index(source);
  if (indexed === null) return unsupportedSource();
  const findings = [
    ...lintSections(indexed),
    ...lintRepo(indexed),
    ...lintModules(indexed),
    ...lintEntitiesAndCrud(indexed),
    ...lintAppendices(indexed),
  ];
  return {
    profile: buildSpecProfile.id,
    valid: findings.length === 0,
    findings,
    summary: lintSummary(findings.length),
  };
}

/** A full canvas document is required; anything else cannot be linted. */
function unsupportedSource(): ProfileLintResult {
  return {
    profile: buildSpecProfile.id,
    valid: false,
    findings: [],
    summary: 'build-spec@1 requires a full canvas 1 document.',
  };
}

/** Index a canvas source into its declaration, sections, nodes and wires. */
function index(source: ProfileSource): ProfileDeclarationIndex | null {
  if (source.kind !== 'canvas') return null;
  const declaration = source.declaration;
  return {
    source,
    declaration,
    sections: declaration.children.filter((child) => child.kind === 'section'),
    nodes: declaration.children.filter((child) => child.kind === 'node'),
    wires: declaration.children.filter((child) => child.kind === 'wire'),
  };
}

/** The pass/fail summary line. */
function lintSummary(count: number): string {
  return count === 0
    ? 'build-spec@1 structural lint passed.'
    : `build-spec@1 structural lint found ${count} issue(s).`;
}
