import { reject } from './outcomes.js';
/** Read a plain JSON record; Design System facade converts structured faults to Results. */
export function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object')
    return reject('invalid-input', path, 'object', 'Expected an object');
  if (value === null) return reject('invalid-input', path, 'object', 'Expected an object');
  return plainRecord(value, path);
}
/** Closed record keys reject unsupported extensions rather than silently discarding them. */
export function keys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length)
    reject('invalid-input', path, allowed.join(', '), 'Unsupported keys: ' + unknown.join(', '));
}
/** Decode a bounded string without coercion; facade owns input correction. */
export function text(
  value: unknown,
  path: string,
): string {
  if (typeof value !== 'string') return reject('invalid-input', path, 'string', 'Expected text');
  if (value.length > 4096) return reject('limit', path, 'at most 4096 characters', 'Text too long');
  return value;
}
/** Decode finite numbers without coercion; all dimensions remain explicit. */
export function number(
  value: unknown,
  path: string,
): number {
  if (typeof value !== 'number') return reject('invalid-input', path, 'number', 'Expected number');
  if (!Number.isFinite(value))
    return reject('out-of-range', path, 'finite number', 'Nonfinite value');
  return value;
}
/** Require an array; parent source-byte and entry-count bounds cap allocation. */
export function list(
  value: unknown,
  path: string,
): readonly unknown[] {
  if (!Array.isArray(value)) return reject('invalid-input', path, 'array', 'Expected array');
  return value;
}
/** Require a defined map member, preserving its precise type after validation. */
export function member<T>(
  values: Readonly<Record<string, T>>,
  key: string,
): T {
  const value = values[key];
  if (value === undefined)
    return reject(
      'unknown-token',
      key,
      'known token or policy member',
      'Unknown token or policy member',
    );
  return value;
}
/** Reject malformed branded/schema input with a stable category; no library exception escapes. */
export function parsed<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  path: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    return reject(
      'invalid-input',
      path,
      'valid declared shape',
      'Input does not match its declared shape',
    );
  return result.data;
}
/** A nesting bound prevents untrusted recursive sources from exhausting the stack. */
export function depthLimit(
  depth: number,
  path: string,
): void {
  if (depth > 64) reject('limit', path, 'depth≤64', 'Token nesting limit exceeded');
}

/** Arrays cannot impersonate closed keyed objects; facade owns correction. */
function plainRecord(
  value: object,
  path: string,
): Readonly<Record<string, unknown>> {
  if (Array.isArray(value)) return reject('invalid-input', path, 'object', 'Expected an object');
  return Object.fromEntries(Object.entries(value));
}
