/*
 * Reading the installed UI resources at startup: the installation payload, the shipped theme
 * pins and the panel dimensions from the installed token scope. A typed fault aborts before
 * anything mounts, so no half-mounted workspace is reported as ready.
 */
import type { Diagnostic, Result } from '../errors.js';
import { failure } from '../errors.js';
import { designSystemFailure, ownerResult, wireOutcome } from '../foreign-failures.js';
import type { ServiceClient } from '../ports/client.js';
import type { PanelSizing } from '../records/panels.js';
import type { ThemeChoice } from '../records/preferences.js';
import { installationSchema, type Installation } from '../records/installation.js';
import type { DesignSystem, Environment } from '@novakai/canvas-design-system';

/** A typed initialization fault is caught once at startWeb; no half-mounted workspace is reported as ready. */
export class InitializationRejected extends Error {
  /** Preserve an owner's complete failure until startWeb returns it to the display boundary. */
  constructor(
    message: string,
    readonly diagnostic?: Diagnostic,
  ) {
    super(message);
  }
}

/** Preserve a failing owner's readable message without asserting the success type. */
export function accepted<T>(result: Result<T>): T {
  if (!result.ok) throw new InitializationRejected(result.error.message, result.error);
  return result.value;
}

/** Sources are authenticated transport data and then admitted through their public owner schemas. */
export async function resources(client: ServiceClient): Promise<Installation> {
  const response = accepted(await client.get('/api/v1/installation'));
  return installationSchema.parse(accepted(wireOutcome('service', response.outcome)));
}

/** Shipped theme pins come from the owner; labels do not substitute for release identity. */
export function themeChoices(
  tokens: DesignSystem,
  sources: unknown,
  environment: Environment,
): readonly ThemeChoice[] {
  return (['light', 'dark'] as const).map((scheme) => {
    const resolved = accepted(
      ownerResult(
        tokens.resolve({
          scope: 'ui',
          sources,
          preferences: {
            schemaVersion: 1,
            theme: { mode: 'system' },
            textSize: 14,
            density: 'comfortable',
            motion: 'system',
          },
          environment: { ...environment, scheme },
        }),
        designSystemFailure,
      ),
    );
    const pin = resolved.provenance.ui;
    if (pin === null) throw new InitializationRejected('UI theme provenance is missing');
    return { label: scheme === 'light' ? 'Light' : 'Dark', pin };
  });
}

/** Layout thresholds and dimensions are read from the same installed token scope as UI CSS. */
export function panelSizing(element: HTMLElement): PanelSizing {
  return {
    canvasMinimum:
      dimension(element, '--nv-breakpoint-medium') - dimension(element, '--nv-panel-right'),
    medium: dimension(element, '--nv-breakpoint-medium'),
    large: dimension(element, '--nv-breakpoint-large'),
    sides: { left: panelDimensions(element, 'left'), right: panelDimensions(element, 'right') },
  };
}

/** Provider details are shown only when explicitly carried by the initialization boundary. */
export function initializationFailure(error: unknown): Result<never> {
  if (error instanceof InitializationRejected) return initializationRejection(error);
  return failure('initialization-failed', 'Canvas could not initialize its UI resources');
}

/** Numeric panel bounds are read from the resolved token scope, preserving one CSS/TS authority. */
function dimension(
  element: HTMLElement,
  variable: string,
): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(variable));
  if (!Number.isFinite(value)) throw new InitializationRejected(`Missing UI token ${variable}`);
  return value;
}

/** Pane sizing always uses the same root token values as the shared SidePanel CSS. */
function panelDimensions(
  element: HTMLElement,
  side: 'left' | 'right',
): { readonly width: number; readonly minimum: number; readonly maximum: number } {
  return {
    width: dimension(element, `--nv-panel-${side}`),
    minimum: dimension(element, `--nv-panel-${side}-minimum`),
    maximum: dimension(element, `--nv-panel-${side}-maximum`),
  };
}

/** Owner failures keep their original code; locally detected setup faults use the host vocabulary. */
function initializationRejection(error: InitializationRejected): Result<never> {
  if (error.diagnostic !== undefined) return { ok: false, error: error.diagnostic };
  return failure('initialization-failed', error.message);
}
