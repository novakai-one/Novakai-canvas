/*
 * The language description `describe` returns: the grammar, operation words, patch targets,
 * defaults, examples and diagnostic codes, so an author never needs to open implementation files.
 * Pure: every call returns a new copy. Language owns correcting the source; Authoring owns commit
 * recovery.
 */
import type { DiagnosticCode } from '../../contract/errors.js';
import type { Description } from '../../contract/records/vocabulary.js';
import { constructs } from './constructs.js';
import { defaults, modeLayouts } from './defaults.js';
import { operationWords, patchProperties } from './patch-properties.js';
import { reject, origin } from '../validation/outcomes.js';

/**
 * Describes language version 1: its constructs, patch operation words and targets, the host's
 * policies, the patch forms, the defaults (the `defaults` record followed by the layout of each
 * section mode), examples, diagnostic codes and how definitions are written and edited.
 *
 * @throws A `LanguageFault` (`unsupported-version` at the start of the source) for any version
 * other than 1; a `DataCloneError` when `policies` cannot be cloned. The public `describe`
 * runs it inside `protect`.
 */
export function describeLanguage(
  version: number,
  policies: Description['policies'],
): Description {
  if (version !== 1)
    reject('unsupported-version', origin, 'Version 1', 'Unsupported language version');
  return structuredClone({
    version: 1,
    constructs,
    operations: operationWords,
    patchTargets: patchProperties,
    policies,
    patchForms,
    defaults: { ...defaults, ...modeLayouts },
    examples,
    diagnostics: diagnosticCodes,
    definitionSyntax: 'type @id "Label" = <expression>',
    definitionEditing: 'full-source-replacement',
  });
}

/** The forms a patch operation can take. */
const patchForms: readonly string[] = Object.freeze([
  'add <node/wire/asset/source/section declaration>',
  'replace <node/section declaration>',
  'set <target> <name=value ...>',
  'unset <target> <optional-property ...>',
  'show/hide @object in @section',
  'connect/disconnect @wire in @section',
  'add block @object { <one content declaration> } [before=@block]',
  'remove block @object.@block',
  'move block @object.@block before=@sibling',
  'delete node @object [cascade=true]',
  'delete wire/section/asset/source @id',
  'reset layout @section',
  'reset route @section/@wire',
]);

/** Complete example sources and patches. Long examples are split only to fit the line width. */
const examples: readonly string[] = Object.freeze([
  'canvas 1 collection @demo "A process" { node @start step "Start" {} ' +
    'node @finish end "Finish" {} wire @next @start -> @finish "Continue" ' +
    'section @flow "Process" { show @start @finish connect @next } }',
  'canvas 1 collection @emphasis "Emphasis" { node @read step "Read" { text @detail ' +
    '"The *receipt* proves the commit; paired asterisks set strong text in text blocks." ' +
    'role=caption } section @show "Show" { show @read } }',
  'canvas 1 collection @layers "Layers" { node @app module "App" {} ' +
    'node @core module "Core" {} section @map "Map" { group @hosts "HOSTS" { show @app } ' +
    'group @libs "LIBS" { show @core } before group:@hosts group:@libs } }',
  'patch 1 @demo { set node @start label="Begin here" }',
  'patch 1 @demo { set wire @next from-end=@start to-end=@finish }',
  'patch 1 @demo { add block @start { text @detail "Explain why this step matters." } }',
]);

/**
 * Every diagnostic code Language reports, in the order `describe` lists them. The type requires
 * every `DiagnosticCode` as a key, so a new code that is not listed here is a compile error.
 */
const diagnosticCodeSet: Readonly<Record<DiagnosticCode, true>> = Object.freeze({
  syntax: true,
  'unsupported-version': true,
  'invalid-input': true,
  'unknown-property': true,
  'invalid-value': true,
  'unknown-target': true,
  'missing-resource': true,
  'resource-mismatch': true,
  domain: true,
  'display-only': true,
  limit: true,
  'provider-failure': true,
  unrepresentable: true,
});

/** The diagnostic codes, as the list `describe` publishes. */
const diagnosticCodes: readonly DiagnosticCode[] = Object.freeze(
  Object.keys(diagnosticCodeSet).filter(isDiagnosticCode),
);

/** Whether a key of the code table is a diagnostic code (every own key is). */
function isDiagnosticCode(key: string): key is DiagnosticCode {
  return Object.hasOwn(diagnosticCodeSet, key);
}
