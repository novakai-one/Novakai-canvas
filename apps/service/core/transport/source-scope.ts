/*
 * Why this file exists
 *
 * The source route can print a whole collection, one section, or one object, and the query says
 * which. For example, `?section=m-review-map` asks for one section, and `?section=a&object=b` is
 * refused because it asks for two things at once.
 *
 * This file reads that choice from the query and checks each ID's format (the ID rules in
 * `contract/schemas.ts`). It never reads the collection, so it can't tell whether the section
 * exists.
 *
 * Each step answers a `Result` (see `contract/errors.ts`). Every mistake is `invalid-input` at
 * `scope`, the part of the request that was wrong.
 */
import type { Scope } from '../../contract/records/capability-types.js';
import type { ApiQuery } from '../../contract/records/transport/protocol.js';
import { objectId, sectionId } from '../../contract/schemas.js';
import { failure, success, type Result } from '../../contract/errors.js';
import { readAllValues } from './api-query.js';

/**
 * Reads which part of the collection to print: all of it, one `section`, or one `object`. Fails
 * with `invalid-input` at `scope` when both are given, either is given twice, or an ID isn't in
 * the right format.
 */
export function readSourceScope(query: ApiQuery): Result<Scope> {
  const sections = readAllValues(query, 'section');
  const objects = readAllValues(query, 'object');
  const bothScopes = sections.length > 0 && objects.length > 0;
  if (bothScopes)
    return failure('invalid-input', 'scope', 'Use either section or object, not both');
  return parseSingleScope(sections, objects);
}

/**
 * Fails with `invalid-input` at `scope` when a scope key was repeated; otherwise as
 * `parseScope`.
 */
function parseSingleScope(
  sections: readonly string[],
  objects: readonly string[],
): Result<Scope> {
  const repeatedScope = sections.length > 1 || objects.length > 1;
  if (repeatedScope)
    return failure('invalid-input', 'scope', 'Each read scope query may be provided only once');
  return parseScope(sections[0], objects[0]);
}

/** A section scope when `section` was given; otherwise as `parseObjectOrAll`. */
function parseScope(
  section: string | undefined,
  object: string | undefined,
): Result<Scope> {
  if (section !== undefined) return parseSectionScope(section);
  return parseObjectOrAll(object);
}

/** The whole collection when no object ID is given; otherwise an object scope. */
function parseObjectOrAll(object: string | undefined): Result<Scope> {
  if (object === undefined) return success({ kind: 'all' });
  return parseObjectScope(object);
}

/** Fails with `invalid-input` at `scope` when the ID breaks Model's object ID grammar. */
function parseObjectScope(id: string): Result<Scope> {
  const parsed = objectId.safeParse(id);
  if (!parsed.success) return nonCanonicalScope();
  return success({ kind: 'object', id: parsed.data });
}

/** Fails with `invalid-input` at `scope` when the ID breaks Model's section ID grammar. */
function parseSectionScope(id: string): Result<Scope> {
  const parsed = sectionId.safeParse(id);
  if (!parsed.success) return nonCanonicalScope();
  return success({ kind: 'section', id: parsed.data });
}

/** `invalid-input` at `scope`: the ID is empty or not canonical. */
function nonCanonicalScope(): Result<Scope> {
  return failure('invalid-input', 'scope', 'Scope IDs must be non-empty canonical IDs');
}
