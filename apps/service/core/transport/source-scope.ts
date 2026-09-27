/*
 * The print scope of `GET /api/v1/source`, read from its query: the whole collection, one section
 * or one object. Pure. A refused scope is the caller's to correct.
 */
import type { Scope } from '../../contract/records/capabilities.js';
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
  const selected = section === undefined ? object : section;
  return validSourceScope(section, selected);
}

/** Whether both scope keys were given. */
function bothScopes(
  section: string | undefined,
  object: string | undefined,
): boolean {
  return section !== undefined && object !== undefined;
}

/** Refuses a repeated scope key, then builds the scope as `sourceScopeValue`. */
function validSourceScope(
  section: string | undefined,
  selected: string | undefined,
): Result<Scope> {
  const duplicate = duplicateScopeError(section, selected);
  if (duplicate !== undefined) return duplicate;
  return sourceScopeValue(section, selected);
}

/** `invalid-input` at `scope` when a scope key was repeated; otherwise nothing. */
function duplicateScopeError(
  section: string | undefined,
  selected: string | undefined,
): Result<Scope> | undefined {
  return hasDuplicateScopeValue(section) || hasDuplicateScopeValue(selected)
    ? failure('invalid-input', 'scope', 'Each read scope query may be provided only once')
    : undefined;
}

/** The HTTP server joins repeated `section`/`object` values with U+0000. */
function hasDuplicateScopeValue(value: string | undefined): boolean {
  return value?.includes('\u0000') ?? false;
}

/**
 * The whole collection when no ID is given. Fails with `invalid-input` at `scope` on a
 * non-canonical ID.
 */
function sourceScopeValue(
  section: string | undefined,
  id: string | undefined,
): Result<Scope> {
  if (id === undefined) return success({ kind: 'all' });
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))
    return failure('invalid-input', 'scope', 'Scope IDs must be non-empty canonical IDs');
  return sourceScopeChoice(section, id);
}

/** A section scope when `section` was given; an object scope otherwise. */
function sourceScopeChoice(
  section: string | undefined,
  id: string,
): Result<Scope> {
  return section === undefined ? success({ kind: 'object', id }) : success({ kind: 'section', id });
}
