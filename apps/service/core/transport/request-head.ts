/*
 * The request head the ingress policy reads (the method and eight headers, still untrusted) and
 * how a check reads one header. Pure. An absent header reads as empty text; a repeated one has no
 * text, so every check refuses it before reading and the caller corrects and resends the request.
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
 * The method (empty when missing) and each header admission checks, from Node's lowercase header
 * lists. Cannot fail.
 */
export function requestHead(
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

/** A header sent at most once, so its text is unambiguous. */
export type UnambiguousHeader = Exclude<HeaderValue, { readonly kind: 'repeated' }>;

/** Whether the header reads as `text`. Absent reads as empty text; repeated never matches. */
export function headerMatches(
  header: HeaderValue,
  text: string,
): boolean {
  if (header.kind === 'repeated') return false;
  return headerText(header) === text;
}

/**
 * The text of a header sent at most once: empty when absent, its value when sent once. A caller
 * refuses a `repeated` header before asking. Cannot fail.
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
