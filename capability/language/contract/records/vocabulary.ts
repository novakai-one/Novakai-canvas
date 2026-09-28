/*
 * The language vocabulary as data: the value types, properties and positional rules of each
 * construct, and the `Description` that `describe` returns. The parser, printer and patch
 * compiler all read the same tables, so the description matches what they accept. Language owns
 * correcting the source; Authoring owns every commit and recovery.
 */
import type { Construct, SyntaxValue, TargetKind } from './syntax.js';

/** The form a property or positional value must have. */
export type ValueType =
  /** Text. */
  | 'string'
  /** Text; used for bare words, often limited to a property's `values`. */
  | 'word'
  /** A plain `@id`, with no member, section or namespace. */
  | 'id'
  /** An `@id` or an `@id.@member`. */
  | 'endpoint'
  /** Any reference, including `@section/@id` and `group:@id`. */
  | 'address'
  /** A list of text values. */
  | 'strings'
  /** A bracketed list of plain IDs, such as `[@a, @b]`. */
  | 'ids'
  /** A list of endpoints. */
  | 'endpoints'
  /** `true` or `false`. */
  | 'boolean'
  /** A whole number. */
  | 'integer'
  /** Text (such as a URL) or a plain ID. */
  | 'link'
  /**
   * A list of any references; as a positional value, written one after another without
   * brackets, as in `before group:@a group:@b`.
   */
  | 'targets'
  /**
   * A list of plain IDs; as a positional value, written one after another without brackets, as
   * in `show @a @b`.
   */
  | 'references'
  /** One endpoint or a list of endpoints. */
  | 'reference-value'
  /** A list whose items are a name, or a `[name, type]` pair whose type is text or a plain ID. */
  | 'signature-parameters'
  /** Text or a plain ID. */
  | 'type-expression';

/** One named property a construct or patch target accepts, written `name=value`. */
export interface Property {
  /** The form its value must have. */
  readonly type: ValueType;

  /** The record field the value is stored in. */
  readonly field: string;

  /** Whether a declaration must write it; a required property also cannot be unset. */
  readonly required?: boolean;

  /** The only words allowed, when the value is limited to a fixed set. */
  readonly values?: readonly string[];

  /**
   * Used when a new declaration omits it or a patch unsets it. In a patch, an omitted property
   * keeps its value.
   */
  readonly fallback?: SyntaxValue;
}

/** The properties one construct or patch target accepts, by property name. */
export type PropertyTable = Readonly<Record<string, Property>>;

/** One value a construct takes by position, such as the ID and label in `node @id "Label"`. */
export interface PositionRule {
  /** The field the value is stored in. */
  readonly name: string;

  /** The form the value must have. */
  readonly type: ValueType;

  /** Whether the value may be left out. */
  readonly optional?: boolean;

  /** The only words allowed, when the value is limited to a fixed set. */
  readonly values?: readonly string[];

  /** A fixed token that must appear here (such as `->`); nothing is stored for it. */
  readonly literal?: string;
}

/** The grammar of one construct. */
export interface ConstructDefinition {
  /** The keyword that starts it. */
  readonly kind: Construct;

  /** The values it takes by position, in order. */
  readonly positions: readonly PositionRule[];

  /** The named properties it accepts, by property name. */
  readonly properties: PropertyTable;

  /** The constructs allowed inside its braces, or `null` when it takes no braces. */
  readonly children: readonly Construct[] | null;
}

/**
 * What `describe` returns: everything an author needs to write valid source, without opening the
 * implementation.
 */
export interface Description {
  /** The properties `set` and `unset` accept, per patch target kind. */
  readonly patchTargets: Readonly<Record<TargetKind, PropertyTable>>;

  /** The shape of each patch operation, as short templates. */
  readonly patchForms: readonly string[];

  /** The language version; only 1 exists. */
  readonly version: 1;

  /** The grammar of every construct. */
  readonly constructs: readonly ConstructDefinition[];

  /** The patch operation verbs. */
  readonly operations: readonly string[];

  /** The default value of each defaulted setting, and the layout each section mode uses. */
  readonly defaults: Readonly<Record<string, string>>;

  /** Complete example sources. */
  readonly examples: readonly string[];

  /** Every diagnostic code Language can report. */
  readonly diagnostics: readonly string[];

  /** How a type definition is written. */
  readonly definitionSyntax: 'type @id "Label" = <expression>';

  /** How a type definition is changed: by replacing the full source, never by patch. */
  readonly definitionEditing: 'full-source-replacement';

  /** Model's acceptance tables, published as Model defines them. */
  readonly policies: {
    /** The layouts each section mode allows. */
    readonly layouts: Readonly<Record<string, readonly string[]>>;

    /** The relationship kinds each section mode may draw; a missing mode allows every kind. */
    readonly wires: Readonly<Record<string, readonly string[]>>;

    /** Which objects and members a relationship's ends may use. */
    readonly endpoints: {
      /** The member kinds an endpoint can address, per object kind. */
      readonly members: Readonly<Record<string, readonly string[]>>;

      /** The member kinds addressable on an object kind with no `members` entry. */
      readonly genericMembers: readonly string[];

      /** The object kinds allowed as a source, per relationship kind; missing allows any. */
      readonly sources: Readonly<Record<string, readonly string[]>>;

      /** The object kinds allowed as a target, per relationship kind; missing allows any. */
      readonly targets: Readonly<Record<string, readonly string[]>>;
    };
  };
}
