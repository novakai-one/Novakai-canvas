/*
 * The parsed form of canvas source. `parse` returns these records; lowering, patching and
 * diagnostics read them. They describe only what the source says: nothing here has been checked
 * against Model yet. Language owns correcting the source; Authoring owns every commit and
 * recovery.
 */

/**
 * One point in the source. `offset` counts UTF-16 code units from the start; `line` and `column`
 * start at 1.
 */
export interface Position {
  /** UTF-16 code units before this point. */
  readonly offset: number;

  /** Line number, starting at 1. */
  readonly line: number;

  /** Column number, starting at 1. */
  readonly column: number;
}

/** A stretch of source. `end` is exclusive: it is the first position after the stretch. */
export interface Span {
  /** The first position inside the stretch. */
  readonly start: Position;

  /** The first position after the stretch. */
  readonly end: Position;
}

/**
 * A reference to something by ID, written `@id` in source.
 *
 * - `@id.@member` sets `member` (an endpoint inside an object).
 * - `@section/@id` sets `section` (an appearance or route inside that section).
 * - `group:@id` or `section:@id` sets `namespace` (a layout reference).
 */
export interface Reference {
  /** Always `reference`, which tells a reference apart from the other syntax values. */
  readonly kind: 'reference';

  /** The referenced ID, without the leading `@`. */
  readonly id: string;

  /** The member ID after `.`, for an endpoint inside an object. */
  readonly member?: string;

  /** The layout namespace before `:`, for a group or section reference. */
  readonly namespace?: 'group' | 'section';

  /** The section ID before `/`, for an appearance or route address. */
  readonly section?: string;
}

/** A value written in source: text, a number, a boolean, a reference, or a list of these. */
export type SyntaxValue = string | number | boolean | Reference | readonly SyntaxValue[];

/** A syntax value together with where it was written. */
export interface LocatedValue {
  /** The value. */
  readonly value: SyntaxValue;

  /** Where the value was written. */
  readonly span: Span;

  /**
   * For the expression of a `type` definition: the tokens it was read from, used to map
   * references back to source.
   */
  readonly tokens?: readonly Token[];

  /**
   * For a scalar, or a reference without a namespace: the first token it was read from. Absent
   * on a `type` definition's `id`.
   */
  readonly token?: Token;

  /** Set only for a bracketed `[...]` list: each item with its own location. */
  readonly items?: readonly LocatedValue[];
}

/** A declaration's properties, by property name. */
export type Fields = Readonly<Record<string, LocatedValue>>;

/** The keyword that starts a declaration, such as `node`, `wire` or `section`. */
export type Construct =
  | 'collection'
  | 'type'
  | 'asset'
  | 'source'
  | 'node'
  | 'wire'
  | 'section'
  | 'text'
  | 'code'
  | 'link'
  | 'list'
  | 'image'
  | 'icon'
  | 'figure'
  | 'field'
  | 'keygroup'
  | 'signature'
  | 'member'
  | 'table'
  | 'row'
  | 'port'
  | 'show'
  | 'connect'
  | 'group'
  | 'rank'
  | 'align'
  | 'before'
  | 'below'
  | 'root'
  | 'event'
  | 'fragment'
  | 'branch';

/** One declaration and the declarations nested inside its braces. */
export interface Declaration {
  /** The keyword that starts the declaration. */
  readonly kind: Construct;

  /** Its positional and named properties, by property name. */
  readonly fields: Fields;

  /** The declarations nested inside it, in source order. */
  readonly children: readonly Declaration[];

  /** Where the whole declaration was written. */
  readonly span: Span;
}

/** The kind of record a patch operation addresses, such as `node` in `set node @start`. */
export type TargetKind =
  | 'collection'
  | 'node'
  | 'wire'
  | 'block'
  | 'appearance'
  | 'section'
  | 'route'
  | 'asset'
  | 'source'
  | 'layout';

/** The verb that starts a patch operation, such as `set` or `delete`. */
export type Action =
  | 'add'
  | 'set'
  | 'unset'
  | 'replace'
  | 'show'
  | 'hide'
  | 'connect'
  | 'disconnect'
  | 'remove'
  | 'move'
  | 'delete'
  | 'reset';

/** One operation inside a `patch 1` source. */
export interface Operation {
  /** The verb. */
  readonly action: Action;

  /** The kind of record addressed. */
  readonly target: TargetKind;

  /** The addressed record; for a `collection` target the ID is empty. */
  readonly address: Reference;

  /** The `name=value` properties written with the operation. */
  readonly fields: Fields;

  /** For `unset`: the property names to remove. Otherwise empty. */
  readonly properties: readonly string[];

  /** For an operation that carries a full declaration (such as `add` or `replace`); else `null`. */
  readonly declaration: Declaration | null;

  /** Where the operation was written. */
  readonly span: Span;
}

/** A parsed `canvas 1` source: one whole collection. */
export interface Document {
  /** Always `canvas`. */
  readonly kind: 'canvas';

  /** The language version; only 1 exists. */
  readonly version: 1;

  /** The collection ID. */
  readonly collection: string;

  /** The `collection` declaration and everything inside it. */
  readonly declaration: Declaration;

  /**
   * From `canvas` to the closing brace. Comments before it, such as a printed heading, are
   * outside.
   */
  readonly span: Span;
}

/** A parsed `patch 1` source: operations to apply to an existing collection. */
export interface Patch {
  /** Always `patch`. */
  readonly kind: 'patch';

  /** The language version; only 1 exists. */
  readonly version: 1;

  /** The ID of the collection to change. */
  readonly collection: string;

  /** The operations, in source order. */
  readonly operations: readonly Operation[];

  /**
   * From `patch` to the closing brace. Comments before it, such as a printed heading, are
   * outside.
   */
  readonly span: Span;
}

/**
 * A theme or asset the source asks for. The host resolves it before lowering; Language itself
 * never reads a file or the network.
 */
export interface ResourceRequest {
  /** What is asked for. */
  readonly kind: 'theme' | 'image' | 'icon' | 'font';

  /**
   * The name the source uses for it: the asset ID, or the theme name or pin (`paper` when a
   * document writes no theme or a patch unsets it).
   */
  readonly alias: string;

  /** Where the source says it comes from; for a theme, the same text as `alias`. */
  readonly source: string;

  /** The asset's alternative text, when written. */
  readonly alt?: string;

  /** The asset's licence, when written. */
  readonly license?: string;

  /** The asset's attribution, when written. */
  readonly attribution?: string;

  /** Where the request was written. */
  readonly span: Span;
}

/** Links a record path to where it was written, so Model's issues can be shown in the source. */
export interface SourceMapping {
  /**
   * For a `canvas` document, Model's record path: `''` for the collection, then paths such as
   * `objects.<id>`, `sections.<id>.content.<id>` or `objects.<id>.parameters.0.name`. For a
   * patch, the operation's target ID.
   */
  readonly path: string;

  /** Where that record, field or operation was written. */
  readonly span: Span;
}

/** What `parse` returns: the document or patch, plus its resource requests and source mappings. */
export type ParsedSource = (Document | Patch) & {
  /** The themes and assets the source asks for. */
  readonly resources: readonly ResourceRequest[];

  /** Where each record and field was written. */
  readonly sourceMap: readonly SourceMapping[];
};

/** One token read from the source. */
export interface Token {
  /** The token class; `eof` marks the end of the source. */
  readonly kind: 'word' | 'string' | 'id' | 'integer' | 'symbol' | 'eof';

  /** The token's text as written. */
  readonly text: string;

  /** Where the token was written. */
  readonly span: Span;
}
