/*
 * What the local service answers, once the HTTP transport has checked its envelope. Pure
 * declarations. A service rejection never arrives here: the transport returns it as
 * `service-rejected`.
 */
import type { Generation } from '../brands.js';

/** A successful answer's value and the service generation that sent it. */
export interface Observed<T> {
  readonly generation: Generation;
  readonly value: T;
}
