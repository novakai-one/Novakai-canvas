import { z } from 'zod';

/*
 * Small presentation-intent enums shared by objects, sections and content. Each is an exported,
 * shared, unfrozen zod schema: `safeParse` returns a result; `parse` throws a `ZodError`.
 */

/**
 * An object's frame: `auto` (the kind's usual notation), `none`, `card` or `panel`. Independent
 * of the object's kind.
 */
export const frameSchema = z.enum(['auto', 'none', 'card', 'panel']);

/**
 * How an object arranges its content: `stack`, `media-top` or `media-left`. Model requires
 * visible media (an image, icon or figure) for the two media-led arrangements.
 */
export const compositionSchema = z.enum(['stack', 'media-top', 'media-left']);

/** A group's (container's) frame: `auto`, `none` or `panel`. Groups are regions, not cards. */
export const containerFrameSchema = z.enum(['auto', 'none', 'panel']);

/**
 * A text block's typography role: `body`, `caption` or `annotation`. It changes how the text is
 * measured, never what it means or where the object sits.
 */
export const textRoleSchema = z.enum(['body', 'caption', 'annotation']);

/**
 * Four parametric figure forms: `vessel`, `layered-bed`, `screen`, `gauge`. Presentation owns
 * drawing, so new forms ship with the renderer. Nothing imports this schema: the content schema
 * (`content.ts`) declares its own list of 10 forms.
 */
export const figureFormSchema = z.enum(['vessel', 'layered-bed', 'screen', 'gauge']);

/**
 * A figure's fill level: `low`, `half` or `full`. Named levels keep free numbers out of authored
 * DSL; Presentation maps them to geometry.
 */
export const figureLevelSchema = z.enum(['low', 'half', 'full']);
