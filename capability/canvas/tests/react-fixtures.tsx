import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fireEvent } from '@testing-library/react';
import { vi, assert } from 'vitest';
import { composePresentation, fontSet } from '@novakai/canvas-presentation';
import type { Result as PresentationResult } from '@novakai/canvas-presentation';
import { createReactBindings as designBindings } from '@novakai/canvas-design-system';
import type { RenderSlots, Scene } from '../contract/index.js';
import { value, sequenceScene } from './fixtures.js';
/** Unused semantic providers fail loudly; this fixture uses real font-bound rendering, not projection. */
function unavailable(): PresentationResult<never> {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      path: 'fixture',
      message: 'Projection is outside this renderer contract',
      recovery: 'Supply a projection fixture',
    },
  };
}
/** Pin actual repository font bytes through the public Presentation composition. */
export async function slots(): Promise<RenderSlots> {
  const fontFile = '../../../resources/fonts/inter-latin-400-normal.woff2';
  const bytes = readFileSync(new URL(fontFile, import.meta.url));
  const fonts = fontSet.parse([
    {
      family: 'Inter',
      digest: createHash('sha256').update(bytes).digest('hex'),
      mediaType: 'font/woff2',
      base64: bytes.toString('base64'),
    },
  ]);
  const result = await composePresentation(
    {
      domain: { read: unavailable },
      themes: { resolve: unavailable },
      assets: { read: unavailable },
    },
    fonts,
  );
  assert(result.ok, JSON.stringify(result));
  const design = value(await designBindings());
  return { ...result.value.react, Button: design.Button };
}
/** Scene dimensions are already known; browser geometry stubs only make React Flow's DOM observer operable in JSDOM. */
export function installDomGeometry(): void {
  class Observer implements ResizeObserver {
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    /** Deliver one observed DOM box; this stub cannot establish actual browser geometry correctness. */
    observe(target: Element): void {
      const bounds = target.getBoundingClientRect();
      const size = { inlineSize: bounds.width, blockSize: bounds.height };
      const entry: ResizeObserverEntry = {
        target,
        contentRect: bounds,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      };
      this.timers.add(setTimeout(() => this.callback([entry], this), 0));
    }
    /** Contract fixture lifetime is ended by disconnect; there are no recurring observations. */
    unobserve(): void {}
    /** Clear pending fixture callbacks when a real React Flow observer is cleaned up. */
    disconnect(): void {
      this.timers.forEach(clearTimeout);
      this.timers.clear();
    }
  }
  class Matrix {
    readonly m22 = 1;
  }
  vi.stubGlobal('DOMMatrixReadOnly', Matrix);
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ): number {
    return this.style.width.endsWith('%') ? 800 : parseFloat(this.style.width) || 800;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ): number {
    return this.style.height.endsWith('%') ? 600 : parseFloat(this.style.height) || 600;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ): DOMRect {
    return new DOMRect(0, 0, this.offsetWidth, this.offsetHeight);
  });
}
/** Use valid SVG path spacing so a markup assertion cannot pass with an unrenderable route. */
export function renderedScene(): Scene {
  const original = sequenceScene();
  return {
    ...original,
    sections: original.sections.map((section) => ({
      ...section,
      wires: section.wires.map((wire) => ({ ...wire, path: 'M 140 70 L 380 70' })),
    })),
  };
}

/** Vitest's window proxy fails JSDOM30's constructor brand check. Supply the real event view after construction;
 * React Flow and d3 still receive the actual bubbling mouse event and its literal coordinates.
 */
export function mouseGesture(
  target: Element | Window,
  type: string,
  x: number,
  y: number,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  });
  Object.defineProperty(event, 'view', { value: window });
  fireEvent(target, event);
}
