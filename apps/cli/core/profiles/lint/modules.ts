/*
 * Modules-section rule of the build-spec profile: the modules projection must show canonical
 * module/interface objects that the repo tree also shows.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../contract/records/profiles.js';
import { id, sectionById, shown, text, type Declaration } from './declarations.js';
import { findingAt } from './findings.js';

/** Every shown modules entry must be a canonical module or interface shown by the repo tree. */
export function lintModules(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const repo = sectionById(indexed.sections, 'repo');
  const modules = sectionById(indexed.sections, 'modules');
  if (repo === undefined || modules === undefined) return [];
  const repoObjects = new Set(shown(repo));
  return shown(modules).flatMap((objectId) =>
    moduleProjectionFinding(
      indexed.nodes.find((node) => id(node) === objectId),
      objectId,
      repoObjects,
      modules,
    ),
  );
}

/** A shown object that is not a canonical module is reported. */
function moduleProjectionFinding(
  node: Declaration | undefined,
  objectId: string,
  repoObjects: ReadonlySet<string>,
  modules: Declaration,
): ProfileFinding[] {
  return isCanonicalModule(node, objectId, repoObjects)
    ? []
    : [
        findingAt(
          modules,
          `section @modules show @${objectId}`,
          'Modules must show canonical module/interface objects also shown by the repo tree.',
        ),
      ];
}

/** The node exists, is a module or interface, and the repo tree shows it. */
function isCanonicalModule(
  node: Declaration | undefined,
  objectId: string,
  repoObjects: ReadonlySet<string>,
): boolean {
  return node !== undefined && isModuleKind(node) && repoObjects.has(objectId);
}

/** The node's kind field names a module or an interface. */
function isModuleKind(node: Declaration): boolean {
  return ['module', 'interface'].includes(text(node, 'kind') ?? '');
}
