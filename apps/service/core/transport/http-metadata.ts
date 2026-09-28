/*
 * Why this file exists
 *
 * Deciding who is calling means reading a request's headers, and a header can be missing or sent
 * twice. For example, a request with two `Authorization` headers must not count as either one.
 *
 * This file reads the method and eight headers (`Host`, `Origin`, the three `Sec-Fetch-*`,
 * `Authorization`, `Cookie` and `Content-Type`) into `HttpMetadata`, and marks each header as not
 * sent, sent once, or sent more than once. It also gives the checks two safe ways to read a
 * header. It trusts nothing it reads; admission.ts makes the decisions.
 */
import type {
  HeaderLists,
  HeaderValue,
  HttpMetadata,
} from '../../contract/records/transport/http.js';

/** A header the request did not send. */
const ABSENT: HeaderValue = Object.freeze({ kind: 'absent' });
/** A header the request sent more than once. */
const REPEATED: HeaderValue = Object.freeze({ kind: 'repeated' });

/**
 * Reads the method and the eight headers the checks use, from Node's header lists (lowercase
 * names, every value sent). A missing method reads as empty text. Never fails.
 */
export function readHttpMetadata(
  method: string | undefined,
  headers: HeaderLists,
): HttpMetadata {
  const read = (name: string): HeaderValue => headerValue(headers[name]);
  return {
    method: method ?? '',
    host: read('host'),
    origin: read('origin'),
    site: read('sec-fetch-site'),
    mode: read('sec-fetch-mode'),
    destination: read('sec-fetch-dest'),
    authorization: read('authorization'),
    cookie: read('cookie'),
    contentType: read('content-type'),
  };
}

/** A header sent at most once, so its text is clear. */
export type UnambiguousHeader = Exclude<HeaderValue, { readonly kind: 'repeated' }>;

/**
 * Whether the header's text is exactly `text`. A header that wasn't sent reads as empty text, so
 * a missing header matches `''`. A header sent more than once never matches.
 */
export function headerMatches(
  header: HeaderValue,
  text: string,
): boolean {
  if (header.kind === 'repeated') return false;
  return headerText(header) === text;
}

/**
 * The text of a header sent at most once: its value, or empty text when it wasn't sent. Callers
 * refuse a header sent more than once before asking. Never fails.
 */
export function headerText(header: UnambiguousHeader): string {
  if (header.kind === 'absent') return '';
  return header.value;
}

/** `absent` when there is no value, `single` for one, `repeated` for several. */
function headerValue(values: readonly string[] | undefined): HeaderValue {
  const [only, ...others] = values ?? [];
  if (only === undefined) return ABSENT;
  if (others.length > 0) return REPEATED;
  return { kind: 'single', value: only };
}
