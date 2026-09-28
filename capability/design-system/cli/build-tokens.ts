import {
  composeDesignSystem,
  createTokenFileBindings,
  type Result,
  type ArtifactManifest,
  type ArtifactSet,
  type TokenFileBindings,
} from '../contract/index.js';
/** Explicit build command; public compiler/bindings own validation and recovery, CLI reports failures. */
async function build(
  root: string,
  mode: string,
): Promise<Result<ArtifactManifest>> {
  const bound = await createTokenFileBindings(root);
  if (!bound.ok) return bound;
  const source = await bound.value.source.read();
  if (!source.ok) return source;
  return compileAndPublish(source.value, bound.value, mode);
}
/** Compilation succeeds before immutable publication; a failed generation never updates source snapshots. */
async function compileAndPublish(
  source: unknown,
  files: TokenFileBindings,
  mode: string,
): Promise<Result<ArtifactManifest>> {
  const compiled = composeDesignSystem().compile(source);
  if (!compiled.ok) return compiled;
  const published = await files.artifacts.publish(compiled.value);
  if (!published.ok) return published;
  return handleSnapshots(compiled.value, files, mode);
}
/** Writing is an explicit command; verification reports drift rather than hiding it. */
async function handleSnapshots(
  artifacts: ArtifactSet,
  files: Pick<TokenFileBindings, 'writeSnapshots' | 'verifySnapshots'>,
  mode: string,
): Promise<Result<ArtifactManifest>> {
  if (mode === '--write') return files.writeSnapshots(artifacts);
  const checked = await files.verifySnapshots(artifacts);
  if (!checked.ok) return checked;
  return verified(checked.value, artifacts.manifest);
}
/** Successful verification retains the same published generation identity. */
function verified(
  paths: readonly string[],
  manifest: ArtifactManifest,
): Result<ArtifactManifest> {
  if (paths.length) return drift(paths);
  return { ok: true, value: manifest };
}
/** Snapshot drift is a failed build; build host owns correction and rerun. */
function drift(paths: readonly string[]): Result<never> {
  return {
    ok: false,
    error: {
      code: 'unsafe-artifact',
      path: 'snapshots',
      targets: paths,
      expected: 'compiler-identical snapshots',
      message: 'Generated snapshots differ',
      recovery: 'Build host reviews source changes, runs tokens:build, then verifies again.',
    },
  };
}
const outcome = await build(new URL('..', import.meta.url).pathname, process.argv[2] ?? '--check');
console.log(JSON.stringify(outcome));
process.exitCode = outcome.ok ? 0 : 1;
