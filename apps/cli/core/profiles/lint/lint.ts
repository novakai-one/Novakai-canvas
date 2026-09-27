/*
 * The build-spec structural lint entry point: index the source, then run the five rule groups —
 * sections, repo tree, modules, entities/CRUD, appendix content. The rules live in this folder;
 * each returns its findings. This file orders them, runs the entities/CRUD rules only when both of
 * their sections exist, and returns the result union. format.ts writes the summary. Pure.
 */
import type { ParsedSource } from '../../../contract/records/foreign.js';
import type { ProfileFinding, ProfileLintResult } from '../../../contract/records/profiles.js';
import { indexSource, sectionById, shown, type DeclarationIndex } from './declarations.js';
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
 * `unsupported-source` when the source is not a full canvas document (a patch). Otherwise
 * `passed`, or `failed` with the findings of the five rule groups in section, repo, modules,
 * entities and appendix order.
 */
export function lintBuildSpec(source: ParsedSource): ProfileLintResult {
  const indexed = indexSource(source);
  if (indexed === undefined) return { status: 'unsupported-source' };
  const [first, ...rest] = [
    ...lintSections(indexed),
    ...lintRepo(indexed),
    ...lintModules(indexed),
    ...lintEntitiesAndCrud(indexed),
    ...lintAppendices(indexed),
  ];
  if (first === undefined) return { status: 'passed' };
  return { status: 'failed', findings: [first, ...rest] };
}

/** Identity, presence, order and appendix-shape findings for the section list. */
function lintSections(indexed: DeclarationIndex): readonly ProfileFinding[] {
  return [
    ...lintSectionIdentity(indexed),
    ...lintRequiredSections(indexed),
    ...lintRequiredOrder(indexed),
    ...lintAppendixShape(indexed),
  ];
}

/** Entity findings first, then the CRUD table findings of the ownership section. */
function lintEntitiesAndCrud(indexed: DeclarationIndex): readonly ProfileFinding[] {
  const entities = sectionById(indexed.sections, 'entities');
  const ownership = sectionById(indexed.sections, 'ownership');
  if (entities === undefined || ownership === undefined) return [];
  return [
    ...entityFindings(shown(entities), indexed.nodes, entities),
    ...crudFindings(indexed, ownership, shown(entities)),
  ];
}
