import type { TokenValues } from '../../contract/records/tokens.js';
import type { SourceSet } from '../../contract/records/source.js';
import type { ContrastEvidence } from '../../contract/records/resolved.js';
import { member } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { colorText } from './values.js';
type Rgb = readonly [number, number, number];
/** Channel conversion uses canonical byte colors; no later projection can change the tested color. */
function channels(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
/** Composite alpha against the actual adjacent surface before computing luminance. */
function composite(
  hex: string,
  background: Rgb,
): Rgb {
  const rgb = channels(hex);
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return [
    rgb[0] * alpha + background[0] * (1 - alpha),
    rgb[1] * alpha + background[1] * (1 - alpha),
    rgb[2] * alpha + background[2] * (1 - alpha),
  ];
}
/** WCAG sRGB transfer function is fixed physical color math, not a second palette. */
function linear(channel: number): number {
  if (channel <= 0.04045) return channel / 12.92;
  return ((channel + 0.055) / 1.055) ** 2.4;
}
/** Standard relative luminance weights are independent of the theme vocabulary. */
function luminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}
/** Compare two composited colors; callers provide the opaque containing surface. */
export function contrastRatio(
  foreground: string,
  background: string,
  surface: string,
): number {
  const back = composite(background, channels(surface));
  const front = composite(foreground, back);
  const a = luminance(front);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Resolve named state and role pairs, returning evidence only when every required pair passes. */
export function validateContrast(
  source: SourceSet,
  values: TokenValues,
  roles: readonly string[],
): readonly ContrastEvidence[] {
  const surface = colorText(member(values, 'surface.base'), 'surface.base');
  requireOpaque(surface, 'surface.base');
  requireOpaque(colorText(member(values, 'surface.raised'), 'surface.raised'), 'surface.raised');
  const pairs = [...source.policy.pairs, ...rolePairs(roles)];
  return pairs.map((pair) => inspectPair(pair, values, surface));
}
/** Base scopes cannot depend on an unknown ambient page behind translucent surfaces. */
function requireOpaque(
  color: string,
  path: string,
): void {
  if (color.length !== 7)
    reject('contrast', path, 'opaque surface', 'Base surfaces must be opaque');
}
/** Semantic role names have exactly three color members, with readable content and visible boundaries. */
function rolePairs(roles: readonly string[]): readonly {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
}[] {
  return roles.flatMap((role) => [
    {
      id: 'role.' + role + '.content',
      foreground: 'role.' + role + '.text',
      background: 'role.' + role + '.fill',
      ratio: 4.5,
    },
    {
      id: 'role.' + role + '.boundary',
      foreground: 'role.' + role + '.stroke',
      background: 'surface.base',
      ratio: 3,
    },
  ]);
}
/** Contrast diagnostics name the rendered pair and computed requirement; retain prior scope on rejection. */
function inspectPair(
  pair: {
    readonly id: string;
    readonly foreground: string;
    readonly background: string;
    readonly ratio: number;
  },
  values: TokenValues,
  surface: string,
): ContrastEvidence {
  const foreground = colorText(member(values, pair.foreground), pair.foreground);
  const background = colorText(member(values, pair.background), pair.background);
  const ratio = contrastRatio(foreground, background, surface);
  if (ratio < pair.ratio)
    return reject(
      'contrast',
      pair.id,
      'contrast≥' + pair.ratio,
      'Contrast ' + ratio.toFixed(3) + ' is insufficient',
    );
  return { id: pair.id, foreground, background, ratio, required: pair.ratio };
}
