/*
 * The build-spec structural lint entry point: index the source, run the five rule groups —
 * sections, repo tree, modules, entities/CRUD, appendix content — and summarise. The rules live
 * in this folder; each returns its findings. This file orders and counts them, and runs the
 * entities/CRUD rules only when both of their sections exist. Pure.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
  ProfileLintResult,
  ProfileSource,
} from '../../../contract/records/profiles.js';
import { buildSpecProfile } from '../build-spec/descriptor.js';
import { sectionById, shown } from './declarations.js';
import { lintSectionIdentity } from './sections/identity.js';
import { lintRequiredOrder, lintRequiredSections } from './sections/required.js';
import { lintAppendixShape } from './sections/appendix-sequence.js';
import { lintRepo } from './repo/tree.js';
import { lintModules } from './modules.js';
import { entityFindings } from './entities.js';
import { crudFindings } from './crud.js';
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

/** Identity, presence, order and appendix-shape findings for the section list. */
function lintSections(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  return [
    ...lintSectionIdentity(indexed),
    ...lintRequiredSections(indexed),
    ...lintRequiredOrder(indexed),
    ...lintAppendixShape(indexed),
  ];
}

/** Entity findings first, then the CRUD table findings of the ownership section. */
function lintEntitiesAndCrud(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const entities = sectionById(indexed.sections, 'entities');
  const ownership = sectionById(indexed.sections, 'ownership');
  if (entities === undefined || ownership === undefined) return [];
  return [
    ...entityFindings(shown(entities), indexed.nodes, entities),
    ...crudFindings(indexed, ownership, shown(entities)),
  ];
}

/** The pass/fail summary line. */
function lintSummary(count: number): string {
  return count === 0
    ? 'build-spec@1 structural lint passed.'
    : `build-spec@1 structural lint found ${count} issue(s).`;
}
