/*
 * The installation payload delivered at browser initialization: fonts and public token source
 * data, admitted through the owners' schemas. Installation credentials are never included.
 */
import { z } from 'zod';
import { fontSet } from '@novakai/canvas-presentation';

/** Only fonts and public token source data are delivered at browser initialization; installation credentials are never included. */
export const installationSchema = z.strictObject({ fonts: fontSet, tokens: z.unknown() });

/** The parsed installation payload. */
export type Installation = z.infer<typeof installationSchema>;
