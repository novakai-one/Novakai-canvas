/*
 * Comparing coordinates and boxes within a hundredth of a unit: the tolerance every
 * movement-preview check shares. Pure.
 */
import type { Box } from '../capture/boxes.js';

/** Two coordinates are equal within a hundredth of a unit. */
export function near(
  a: number,
  b: number,
): boolean {
  return Math.abs(a - b) < 0.01;
}

/** Two boxes have the same width and height. */
export function sameSize(
  expected: Box,
  actual: Box,
): boolean {
  return near(actual.width, expected.width) && near(actual.height, expected.height);
}

/** v sits between a and b, within a hundredth of a unit. */
export function between(
  a: number,
  b: number,
  v: number,
): boolean {
  return v >= Math.min(a, b) - 0.01 && v <= Math.max(a, b) + 0.01;
}
