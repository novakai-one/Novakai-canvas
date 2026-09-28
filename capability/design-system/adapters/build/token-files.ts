import { readFile, mkdir, writeFile, rename, rm, mkdtemp, lstat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import type { Result } from '../../contract/errors.js';
import type { BuildChecks, TokenFileBindings } from '../../contract/ports/build-files.js';
import type { ArtifactSet, ArtifactManifest, Artifact } from '../../contract/records/artifacts.js';
/** Explicit absolute root, closed paths, checked bytes. Build host owns retry and inactive-generation cleanup. */
export function createTokenFiles(
  root: string,
  checks: BuildChecks,
): TokenFileBindings {
  const sourceRoot = resolve(root);
  const output = join(sourceRoot, '.generated');
  return {
    source: { read: () => readSources(sourceRoot, checks) },
    artifacts: { publish: (input) => publish(output, input, checks) },
    readActive: () => readActive(output, checks),
    verifySnapshots: (input) => verifySnapshots(sourceRoot, input, checks),
    writeSnapshots: (input) => writeSnapshots(sourceRoot, input, checks),
  };
}
/** I/O diagnostics never require parsing native messages; failed output leaves active generation unchanged. */
function ioFailure(path: string): Result<never> {
  return {
    ok: false,
    error: {
      code: 'io-failure',
      path,
      targets: [path],
      expected: 'readable safe local token files',
      message: 'Token file operation failed',
      recovery: 'Build host retains the prior scope/generation; repair file access and retry.',
    },
  };
}
/** Read one JSON value as unknown; owner validation happens before it becomes source data. */
async function readJson(path: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  return value;
}
/** All source files are explicit and local; caller controls root, never ambient cwd. */
async function readSources(
  root: string,
  checks: BuildChecks,
): Promise<Result<unknown>> {
  try {
    const [definitions, semantics, preferences, paper, ink] = await Promise.all(
      [
        'definitions.tokens.json',
        'semantics.tokens.json',
        'preferences.tokens.json',
        'themes/paper.theme.json',
        'themes/ink.theme.json',
      ].map((path) => readJson(join(root, 'tokens', path))),
    );
    const header = await readJson(join(root, 'tokens/source.json'));
    const input = sourceInput(header, definitions, semantics, preferences, paper, ink);
    const checked = checks.source(input);
    if (!checked.ok) return checked;
    return { ok: true, value: input };
  } catch {
    return ioFailure(root);
  }
}
/** Source manifest contains only version metadata; no path can escape the selected root. */
function sourceInput(
  header: unknown,
  definitions: unknown,
  semantics: unknown,
  preferences: unknown,
  paper: unknown,
  ink: unknown,
): unknown {
  if (typeof header !== 'object' || header === null) return header;
  return { ...header, definitions, semantics, preferences, themes: [paper, ink] };
}
/** Stage then atomically select a complete checked generation. Concurrent identical replays are harmless. */
async function publish(
  root: string,
  input: ArtifactSet,
  checks: BuildChecks,
): Promise<Result<ArtifactManifest>> {
  const checked = checks.artifacts(input);
  if (!checked.ok) return checked;
  try {
    await mkdir(root, { recursive: true });
    await rejectSymlink(root);
    await writeGeneration(root, checked.value);
    await activate(root, checked.value);
    return { ok: true, value: checked.value.manifest };
  } catch {
    return ioFailure(root);
  }
}
/** Artifact destination cannot redirect writes through a symlink at the managed generation boundary. */
async function rejectSymlink(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new TypeError('Unsafe token output root');
}
/** New generations are private until fully written; existing generations must match every expected byte. */
async function writeGeneration(
  root: string,
  artifacts: ArtifactSet,
): Promise<void> {
  const destination = join(root, artifacts.digest);
  const stage = await mkdtemp(join(root, '.stage-'));
  try {
    await Promise.all(artifacts.files.map((file) => writeArtifact(stage, file)));
    await writeFile(join(stage, 'generation.json'), JSON.stringify(artifacts), 'utf8');
    await moveGeneration(stage, destination, artifacts);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
/** Atomic directory rename cannot expose a partly written generation; replay verifies rather than overwrites. */
async function moveGeneration(
  stage: string,
  destination: string,
  artifacts: ArtifactSet,
): Promise<void> {
  try {
    await rename(stage, destination);
  } catch (error) {
    await verifyExistingGeneration(destination, artifacts, error);
  }
}
/** Compiler-owned relative paths have already passed the artifact schema and content hash checks. */
async function writeArtifact(
  root: string,
  file: Artifact,
): Promise<void> {
  const path = join(root, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content, { encoding: 'utf8', flag: 'wx' });
}
/** Manifest activation is one rename; abandoned temporary files never become an active generation. */
async function activate(
  root: string,
  artifacts: ArtifactSet,
): Promise<void> {
  const temporary = await mkdtemp(join(root, '.manifest-'));
  try {
    const path = join(temporary, 'manifest.json');
    await writeFile(path, JSON.stringify(artifacts.manifest), 'utf8');
    await rename(path, join(root, 'manifest.json'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
/** Read one manifest and pin it for the entire operation, verifying its generation and all bytes. */
async function readActive(
  root: string,
  checks: BuildChecks,
): Promise<Result<ArtifactSet>> {
  try {
    const manifest = await readJson(join(root, 'manifest.json'));
    const generation = requireGeneration(manifest);
    const input = await readJson(join(root, generation, 'generation.json'));
    const checked = checks.artifacts(input);
    if (!checked.ok) return checked;
    requireManifestMatch(checked.value, manifest);
    await verifyArtifactBytes(join(root, generation), checked.value);
    return checked;
  } catch {
    return ioFailure(root);
  }
}
/** Untrusted manifests cannot supply filesystem paths; public readActive owns typed recovery. */
function requireGeneration(value: unknown): string {
  const generation = generationValue(value);
  if (typeof generation !== 'string') throw new TypeError('Invalid generation');
  if (!/^[a-f0-9]{64}$/.test(generation)) throw new TypeError('Invalid generation');
  return generation;
}
/** Safely extract the one manifest identity without a downcast or native path interpretation. */
function generationValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return null;
  return Object.fromEntries(Object.entries(value)).generation;
}
/** Content manifest must match the single pinned activation manifest before any bytes are trusted. */
function requireManifestMatch(
  artifacts: ArtifactSet,
  manifest: unknown,
): void {
  if (JSON.stringify(artifacts.manifest) !== JSON.stringify(manifest))
    throw new TypeError('Manifest differs');
}
/** Replayed immutable generations are verified, never overwritten; public publish owns typed recovery. */
async function verifyExistingGeneration(
  destination: string,
  artifacts: ArtifactSet,
  error: unknown,
): Promise<void> {
  const existing = await readFile(join(destination, 'generation.json'), 'utf8');
  if (existing !== JSON.stringify(artifacts)) throw error;
  await verifyArtifactBytes(destination, artifacts);
}
/** Shared byte verification keeps replay and active-reader corruption policy identical. */
async function verifyArtifactBytes(
  root: string,
  artifacts: ArtifactSet,
): Promise<void> {
  await Promise.all(
    artifacts.files.map(async (file) => {
      const bytes = await readFile(join(root, file.path), 'utf8');
      if (bytes !== file.content) throw new TypeError('Generation bytes differ');
    }),
  );
}
/** Repository snapshots are verification outputs, separate from atomic runtime generation activation. */
async function verifySnapshots(
  root: string,
  input: ArtifactSet,
  checks: BuildChecks,
): Promise<Result<readonly string[]>> {
  const checked = checks.artifacts(input);
  if (!checked.ok) return checked;
  try {
    const differences = await Promise.all(
      checked.value.files.map(async (file) => {
        const bytes = await readFile(join(root, file.path), 'utf8');
        return bytes === file.content ? [] : [file.path];
      }),
    );
    return { ok: true, value: differences.flat() };
  } catch {
    return ioFailure(root);
  }
}
/** Explicit build command materializes checked compiler snapshots; CI must verify them before use. */
async function writeSnapshots(
  root: string,
  input: ArtifactSet,
  checks: BuildChecks,
): Promise<Result<ArtifactManifest>> {
  const checked = checks.artifacts(input);
  if (!checked.ok) return checked;
  try {
    await Promise.all(
      checked.value.files.map(async (file) => {
        const path = join(root, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content, 'utf8');
      }),
    );
    return { ok: true, value: checked.value.manifest };
  } catch {
    return ioFailure(root);
  }
}
