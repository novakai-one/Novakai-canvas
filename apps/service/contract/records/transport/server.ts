import type { WorkspaceSession } from '../../types.js';
import type { HttpAdmission, HttpSecurity } from './http.js';
import type { ApiRouter, CommandDecoder } from './protocol.js';
import type { Result } from '../../errors.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WireOutcome } from './protocol.js';
import type { Scope } from '@novakai/canvas-language';
/** Body readers expose only the iterator control needed to preserve a rejected native socket. */
export interface BodyStream {
  iterator(options: { readonly destroyOnReturn: false }): AsyncIterableIterator<unknown>;
}
/** Server-owned paths and port are explicit startup inputs, never request parameters. */
export interface ServerOptions {
  readonly port: number;
  readonly webRoot: string;
  readonly credentialFile: string;
}
export interface LocalServer {
  readonly url: string;
  readonly generation: string;
  close(): Promise<Result<void>>;
}
export interface ServerBindings {
  readonly admission: HttpAdmission;
  readonly security: HttpSecurity;
  readonly router: ApiRouter;
  readonly changes: Pick<WorkspaceSession, 'subscribe'>;
  readonly io: HttpIo;
  readonly files: StaticFiles;
}
/** Native socket adaptation is injected at composition; policy does not inspect Node request objects. */
export interface HttpIo {
  metadata(request: IncomingMessage): import('./http.js').HttpMetadata;
  body(request: BodyStream): Promise<Result<string>>;
  json(
    response: ServerResponse,
    outcome: WireOutcome,
    generation: string,
  ): void;
  bytes(
    response: ServerResponse,
    file: StaticFile,
  ): void;
}
export interface StaticFile {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename?: string;
  readonly headers?: Readonly<Record<string, string>>;
}
export interface StaticFiles {
  read(path: string): Promise<Result<StaticFile>>;
}
export interface RouterBindings {
  readonly session: Pick<
    WorkspaceSession,
    | 'workspace'
    | 'installation'
    | 'read'
    | 'history'
    | 'apply'
    | 'prepare'
    | 'receipt'
    | 'render'
    | 'inspect'
    | 'resources'
  >;
  readonly generation: string;
  readonly admission: Pick<HttpAdmission, 'mutation'>;
  readonly decoder: CommandDecoder;
  readonly source: {
    describe(): unknown;
    print(
      collection: unknown,
      scope?: Scope,
    ): WireReadout;
  };
  readonly exporter?: (
    input: unknown,
    signal: AbortSignal,
  ) => Promise<import('./protocol.js').RouteOutcome>;
}
/** Language diagnostics use an array, so this adapter translates them into the single transport diagnostic. */
export type WireReadout = Result<unknown>;
