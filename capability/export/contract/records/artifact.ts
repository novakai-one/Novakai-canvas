/*
 * The records an export passes through: the retained revision (`Snapshot`), the part of its
 * scene being exported (`Selection`), an encoder's output (`Encoded`) and the finished
 * `Artifact`. Types only; nothing here runs.
 */
import type { Collection } from '@novakai/canvas-model';
import type { Scene, PlacedSection, Box } from '@novakai/canvas-layout';
import type { Paint } from '@novakai/canvas-presentation';
import type { Diagnostic } from '../errors.js';
import type { Scope } from './input.js';
import type { Resource } from './resource.js';
import type { Page } from './pages.js';

/**
 * Which revision a snapshot holds. Export uses it only while the lease is held; it must match
 * the request and the scene before anything is encoded.
 */
export interface Identity {
  /** The collection ID; must equal the requested ID, `collection.id` and `scene.collectionId`. */
  readonly collectionId: string;

  /**
   * The revision; must equal the requested revision, `collection.revision` and
   * `scene.revision`.
   */
  readonly revision: number;

  /** The projection input key; must equal `scene.inputKey`. */
  readonly inputKey: string;

  /**
   * The collection title: the SVG and HTML title, the PDF document title and each PDF page
   * footer.
   */
  readonly title: string;
}

/** One retained revision, supplied by the host through a snapshot lease. */
export interface Snapshot {
  /** Which revision this is; see {@link Identity}. */
  readonly identity: Identity;

  /** The Model collection at this revision. */
  readonly collection: Collection;

  /** The Layout scene placed from this revision. */
  readonly scene: Scene;

  /**
   * The asset, preset and font blobs of this revision. Export checks that every blob the scene
   * and collection refer to is present before encoding (`resource-rejected` otherwise).
   */
  readonly resources: readonly Resource[];

  /** Presentation colours used when drawing the scene. */
  readonly paint: Paint;
}

/**
 * The part of the scene being exported: every section with the scene bounds (scope `all`), or
 * one section with that section's box.
 */
export interface Selection {
  /** The placed sections to draw. */
  readonly sections: readonly PlacedSection[];

  /** The area to draw, in collection coordinates. */
  readonly bounds: Box;
}

/** What a format handler returns before Export adds the artifact metadata. */
export interface Encoded {
  /** The encoded file. */
  readonly bytes: Uint8Array;

  /** The planned PDF pages; empty for every other format. */
  readonly pages: readonly Page[];

  /** Non-fatal problems. The built-in handlers always return none. */
  readonly warnings: readonly Diagnostic[];
}

/**
 * A finished export. Export takes the handler's bytes through their own `slice()` and makes
 * shallow copies of the identity and scope. Every other field the handler returned (including
 * `pages` and `warnings`) is kept as the handler returned it. `slice()` copies a plain
 * `Uint8Array`, but a `Buffer`'s `slice()` shares memory with the handler's buffer: changing
 * that buffer later changes the artifact's bytes, which then no longer match `digest`.
 */
export interface Artifact extends Encoded {
  /** Artifact record version; always 1. */
  readonly schemaVersion: 1;

  /** The format's media type, for example `image/svg+xml` or `application/pdf`. */
  readonly mediaType: string;

  /** The file extension without a dot, for example `svg` or `nvcanvas` (bundles). */
  readonly extension: string;

  /**
   * The hash of the handler's bytes when the artifact was built, from the host's `Encoding.hash`
   * (SHA-256, 64 lowercase hex characters).
   */
  readonly digest: string;

  /** The exported revision. */
  readonly identity: Identity;

  /** The exported scope. */
  readonly scope: Scope;
}

/** Owner record types re-exported for Export's own modules. */
export type { Collection, Scene, PlacedSection, Box, Paint };
