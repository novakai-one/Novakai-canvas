/*
 * Modules-section rule of the build-spec profile: the modules projection must show canonical
 * module/interface objects that the repo tree also shows.
 */
import type { ObjectId } from '../../../contract/brands.js';
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import { buildSpecSlots } from '../build-spec/descriptor.js';
import {
  nodeById,
  sectionById,
  shown,
  text,
  type Declaration,
  type DeclarationIndex,
} from './declarations.js';
import { findingAt } from './findings.js';

/** Every shown modules entry must be a canonical module or interface shown by the repo tree. */
export function lintModules(indexed: DeclarationIndex): readonly ProfileFinding[] {
  const repo = sectionById(indexed.sections, buildSpecSlots.repo.id);
  const modules = sectionById(indexed.sections, buildSpecSlots.modules.id);
  if (repo === undefined || modules === undefined) return [];
  const repoObjects = new Set(shown(repo));
  return shown(modules).flatMap((objectId) =>
    moduleProjectionFinding(nodeById(indexed.nodes, objectId), objectId, repoObjects, modules),
  );
}

/** A shown object that is not a canonical module is reported. */
function moduleProjectionFinding(
  node: Declaration | undefined,
  objectId: ObjectId,
  repoObjects: ReadonlySet<ObjectId>,
  modules: Declaration,
): readonly ProfileFinding[] {
  if (isCanonicalModule(node, objectId, repoObjects)) return [];
  return [
    findingAt(modules, {
      code: 'module-projection',
      path: `section @${buildSpecSlots.modules.id} show @${objectId}`,
      message: 'Modules must show canonical module/interface objects also shown by the repo tree.',
    }),
  ];
}

/** The node exists, is a module or interface, and the repo tree shows it. */
function isCanonicalModule(
  node: Declaration | undefined,
  objectId: ObjectId,
  repoObjects: ReadonlySet<ObjectId>,
): boolean {
  return node !== undefined && isModuleKind(node) && repoObjects.has(objectId);
}

/** The node's kind field names a module or an interface. */
function isModuleKind(node: Declaration): boolean {
  return ['module', 'interface'].includes(text(node, 'kind') ?? '');
}
