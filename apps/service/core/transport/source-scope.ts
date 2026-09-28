/*
 * Why this file exists
 *
 * The source route can print a whole collection, one section, or one object, and the query says
 * which. For example, `?section=m-review-map` asks for one section, and `?section=a&object=b` is
 * refused because it asks for two things at once.
 *
 * This file reads that choice from the query and checks each ID's format. It never reads the
 * collection, so it can't tell whether the section exists.
 *
 * Every mistake is `invalid-input` at `scope`, the part of the request that was wrong.
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
  if (hasBothScopes(sections, objects)) {
    return bothScopesFailure();
  }
  if (hasRepeatedScope(sections, objects)) {
    return repeatedScopeFailure();
  }
  return parseScope(sections, objects);
}

/** Whether the query asks for a section and an object at once. */
function hasBothScopes(
  sections: readonly string[],
  objects: readonly string[],
): boolean {
  const sectionGiven = sections.length > 0;
  return sectionGiven && objects.length > 0;
}

/** Whether `section` or `object` was given more than once. */
function hasRepeatedScope(
  sections: readonly string[],
  objects: readonly string[],
): boolean {
  const sectionRepeated = sections.length > 1;
  return sectionRepeated || objects.length > 1;
}

/** Reads the one section or object asked for, or the whole collection when neither was. */
function parseScope(
  sections: readonly string[],
  objects: readonly string[],
): Result<Scope> {
  const [section] = sections;
  const [object] = objects;
  if (section !== undefined) {
    return parseSectionScope(section);
  }
  if (object !== undefined) {
    return parseObjectScope(object);
  }
  return success({ kind: 'all' });
}

/** Checks the ID follows Model's section ID format, and makes it a section scope. */
function parseSectionScope(id: string): Result<Scope> {
  const section = sectionId.safeParse(id);
  if (!section.success) {
    return nonCanonicalIdFailure();
  }
  return success({ kind: 'section', id: section.data });
}

/** Checks the ID follows Model's object ID format, and makes it an object scope. */
function parseObjectScope(id: string): Result<Scope> {
  const object = objectId.safeParse(id);
  if (!object.success) {
    return nonCanonicalIdFailure();
  }
  return success({ kind: 'object', id: object.data });
}

/** Makes the mistake for a query that gives both `section` and `object`. */
function bothScopesFailure(): Result<never> {
  return failure('invalid-input', 'scope', 'Use either section or object, not both');
}

/** Makes the mistake for a `section` or `object` given more than once. */
function repeatedScopeFailure(): Result<never> {
  return failure('invalid-input', 'scope', 'Each read scope query may be provided only once');
}

/** Makes the mistake for a section or object ID that is empty or not in the right format. */
function nonCanonicalIdFailure(): Result<never> {
  return failure('invalid-input', 'scope', 'Scope IDs must be non-empty canonical IDs');
}
