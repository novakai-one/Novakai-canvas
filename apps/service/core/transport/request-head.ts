/*
 * The request head the ingress policy reads: the method and eight headers, still untrusted. Pure.
 * An absent header reads as empty text; a repeated one reads as `<duplicate>`, which no admission
 * check accepts, so an ambiguous request is refused and the caller corrects and resends it.
 */
import type { HeaderLists, HttpMetadata } from '../../contract/records/transport/http.js';

/** What a repeated header reads as. It never equals an admitted value. */
const REPEATED = '<duplicate>';

/**
 * The method (empty when missing) and each header admission checks, from Node's lowercase header
 * lists. Cannot fail.
 */
export function requestHead(
  method: string | undefined,
  headers: HeaderLists,
): HttpMetadata {
  const read = (name: string): string => headerValue(headers[name]);
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

/** The only value; empty when there is none, `REPEATED` when there are several. */
function headerValue(values: readonly string[] | undefined): string {
  const [only = '', ...others] = values ?? [];
  if (others.length > 0) return REPEATED;
  return only;
}
