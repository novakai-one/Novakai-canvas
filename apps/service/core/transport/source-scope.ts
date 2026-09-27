/*
 * The print scope of `GET /api/v1/source`, read from its query: the whole collection, one section
 * or one object. Pure. IDs follow Model's ID grammar. A refused scope is the caller's to correct.
 */
import type { Scope } from '../../contract/records/capabilities.js';
import { objectId, sectionId } from '../../contract/schemas.js';
import { failure, success, type Result } from '../../contract/errors.js';

/**
 * The print scope from the query. Fails with `invalid-input` at `scope` when both `section` and
 * `object` are given, when either is repeated, or when the ID is not canonical.
 */
export function sourceScope(query: Readonly<Record<string, string>>): Result<Scope> {
  const section = query.section;
  const object = query.object;
  if (bothScopes(section, object))
    return failure('invalid-input', 'scope', 'Use either section or object, not both');
  const selected = section ?? object;
  return validSourceScope(section, selected);
}

/** Whether both scope keys were given. */
function bothScopes(
  section: string | undefined,
  object: string | undefined,
): boolean {
  return section !== undefined && object !== undefined;
}

/**
 * Fails with `invalid-input` at `scope` when a scope key was repeated; otherwise as
 * `sourceScopeValue`.
 */
function validSourceScope(
  section: string | undefined,
  selected: string | undefined,
): Result<Scope> {
  if (hasDuplicateScopeValue(section) || hasDuplicateScopeValue(selected))
    return failure('invalid-input', 'scope', 'Each read scope query may be provided only once');
  return sourceScopeValue(section, selected);
}

/** The HTTP server joins repeated `section`/`object` values with U+0000. */
function hasDuplicateScopeValue(value: string | undefined): boolean {
  return value?.includes('\u0000') ?? false;
}

/** The whole collection when no ID is given; otherwise as `sourceScopeChoice`. */
function sourceScopeValue(
  section: string | undefined,
  id: string | undefined,
): Result<Scope> {
  if (id === undefined) return success({ kind: 'all' });
  return sourceScopeChoice(section, id);
}

/** A section scope when `section` was given; an object scope otherwise. */
function sourceScopeChoice(
  section: string | undefined,
  id: string,
): Result<Scope> {
  return section === undefined ? objectScope(id) : sectionScope(id);
}

/** Fails with `invalid-input` at `scope` when the ID breaks Model's object ID grammar. */
function objectScope(id: string): Result<Scope> {
  const parsed = objectId.safeParse(id);
  if (!parsed.success) return nonCanonical();
  return success({ kind: 'object', id: parsed.data });
}

/** Fails with `invalid-input` at `scope` when the ID breaks Model's section ID grammar. */
function sectionScope(id: string): Result<Scope> {
  const parsed = sectionId.safeParse(id);
  if (!parsed.success) return nonCanonical();
  return success({ kind: 'section', id: parsed.data });
}

/** `invalid-input` at `scope`: the ID is empty or not canonical. */
function nonCanonical(): Result<Scope> {
  return failure('invalid-input', 'scope', 'Scope IDs must be non-empty canonical IDs');
}
