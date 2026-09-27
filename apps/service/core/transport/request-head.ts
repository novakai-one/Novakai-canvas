/*
 * The request head the ingress policy reads (the method and eight headers, still untrusted) and
 * how a check reads one header. Pure. An absent header reads as empty text; a repeated one reads
 * as no text at all, so no check accepts it and the caller corrects and resends the request.
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

/**
 * The header's text: empty when absent, its value when sent once, `undefined` when repeated.
 * Cannot fail.
 */
export function readHeader(header: HeaderValue): string | undefined {
  switch (header.kind) {
    case 'absent':
      return '';
    case 'single':
      return header.value;
    case 'repeated':
      return undefined;
    default:
      return unsupported(header);
  }
}

/** Whether the header reads as `text`. Absent reads as empty text; repeated never matches. */
export function headerMatches(
  header: HeaderValue,
  text: string,
): boolean {
  return readHeader(header) === text;
}

/** `absent` when there is no value, `single` for one, `repeated` for several. */
function headerValue(values: readonly string[] | undefined): HeaderValue {
  const [only, ...others] = values ?? [];
  if (only === undefined) return ABSENT;
  if (others.length > 0) return REPEATED;
  return { kind: 'single', value: only };
}

/** Unreachable: `HeaderValue` has three kinds. Reads as no text, which no check accepts. */
function unsupported(header: never): undefined {
  void header;
  return undefined;
}
