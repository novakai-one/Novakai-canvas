/*
 * `pnpm render:png` wiring: the ports of one read-only render. The service's headless bindings,
 * the resource reader and the render's file and raster adapters are bound once; `open` makes the
 * render's temporary asset store, prepares the installation in it and composes Language, the
 * Design System and Templates over it. Not pure: the adapters touch the filesystem. Failures are
 * values, and a failed `open` closes the store it made; a render changes nothing stored, so the
 * caller fixes the input and runs it again.
 */
import { join } from 'node:path';
import {
  createHeadlessBindings,
  prepareInstallation,
  type BuiltinResources,
} from '@novakai/canvas-service';
import { composeDesignSystem } from '@novakai/canvas-design-system';
import { composeTemplates } from '@novakai/canvas-templates';
import { createResourceReader } from '../../adapters/files/resource-reader.js';
import { createRaster } from '../../adapters/render/raster.js';
import { createRenderFiles } from '../../adapters/render/render-files.js';
import { openTempAssets } from '../../adapters/render/temp-assets.js';
import type { RenderEnvironment, RenderPorts, TempAssetStore } from '../ports/render.js';
import type { RenderRequest } from '../records/render.js';
import { faulted, nativeFault, type RenderEvidence } from '../records/render-failure.js';
import type { HeadlessBindings } from '../records/foreign.js';
import { success, type Result } from '../errors.js';
import { composeLanguage } from './language.js';
import { renderEnvironment, type Environment } from './render-environment.js';

/**
 * The ports of one render. Rejects when the service's render adapters cannot be imported; the
 * composition root reports that as `render-unavailable`.
 */
export async function renderPorts(request: RenderRequest): Promise<RenderPorts> {
  const service = await createHeadlessBindings();
  return {
    open: () => openEnvironment(request, service),
    files: { ...createRenderFiles(request), ...createRaster(request.root) },
    resources: createResourceReader(),
  };
}

/**
 * The render's temporary asset store and the environment over it. Fails with `provider-failed`
 * or Assets' failure when the store cannot be made. After that, fails as {@link environmentIn}
 * does, or with `provider-failed` when one of its steps throws; the store is then closed and the
 * first failure wins.
 */
async function openEnvironment(
  request: RenderRequest,
  service: HeadlessBindings,
): Promise<Result<RenderEnvironment, RenderEvidence>> {
  const store = await openTempAssets();
  if (!store.ok) return store;
  const environment = await environmentIn(request, service, store.value).catch(thrown);
  if (!environment.ok) return closedAfter(store.value, environment.error);
  return environment;
}

/**
 * The installation prepared in `store` and the capability values over both. Fails with the
 * service's installation failure.
 */
async function environmentIn(
  request: RenderRequest,
  service: HeadlessBindings,
  store: TempAssetStore,
): Promise<Result<RenderEnvironment, RenderEvidence>> {
  const installation = await prepareInstallation(
    join(request.root, 'resources'),
    join(request.root, 'capability/design-system'),
    store.assets,
  );
  if (!installation.ok) return installation;
  const env = capabilities(service, store.assets, installation.value);
  return success(renderEnvironment(env, { service, request, store }));
}

/** A step that threw instead of returning its failure, as `provider-failed` with its evidence. */
function thrown(error: unknown): Result<never, RenderEvidence> {
  return faulted(nativeFault(error));
}

/** `error` as the outcome once `store` is closed; a failed close is not reported over it. */
async function closedAfter(
  store: TempAssetStore,
  error: RenderEvidence,
): Promise<Result<never, RenderEvidence>> {
  await store.close();
  return { ok: false, error };
}

/** Language, the Design System and Templates over the installation's tokens. Cannot fail. */
function capabilities(
  service: HeadlessBindings,
  assets: TempAssetStore['assets'],
  installation: BuiltinResources,
): Environment {
  const system = composeDesignSystem();
  const language = composeLanguage();
  const codecs = service.createPresetCodecs({
    system,
    language,
    sources: installation.tokens,
    resources: { themes: {}, assets: {} },
  });
  return { assets, installation, system, language, templates: composeTemplates(codecs) };
}
