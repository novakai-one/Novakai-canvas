### Additional References:

Typescript coding standards: /Users/christopherdasca/Programming/Novakai-canvas/AGENTS-TYPESCRIPT-CODING-STANDARDS.md

# Canvas builder coding standards

Authority: [16-principle scoring SOP](docs/standards/CODING-STANDARDS.md) and [import matrix](docs/standards/REPO-FOLDER-STRUCTURE.md). Examples below illustrate boundaries; ellipses/comments are explanatory snippets, not production implementations. Every source file requires an evidence-based score >144/160. Sonar complexity ≤2 per function.


## Ownership and implementation

- Model owns diagram validity; Library owns catalog validity; Authoring alone admits/commits changes; Persistence executes physical transactions.
- React and React Flow are required. Web owns panel layout; Canvas owns selection, camera and gestures; Presentation owns content measurement.
- Panels compose reusable header/body/section components and registered contents. UI styling uses centralized Design System tokens.
- Do not create fake implementations, empty TSX components, placeholder passing tests or fake green CI.
- Run `pnpm check`; rendered-output changes also require inspection against `docs/agent-diagrams/visual-quality/References.md` and `docs/maintenance/diagram-quality-improvements.md`.

## 1. SRP

Bad:
```ts
validateAndSave(input);
```
Good:
```ts
validate(input); // Model returns a candidate; Authoring owns saving.
```
One domain reason to change per file.

## 2. OCP

Bad:
```ts
switch (mode) { /* validation and persistence and rendering */ }
```
Good:
```ts
const rules = [identityRules, referenceRules, sectionRules];
```
Keep independent rule steps composable; adding a shipped kind changes its schema/rules, not every caller.

## 3. LSP

Bad:
```ts
const planner: Planner = { plan: () => { throw new Error("unsupported"); } };
```
Good:
```ts
runPlannerContract(planner); // Every real implementation receives the same cases.
```
Do not invent implementations for points. No subtyping scores exactly 7, not demonstrated.

## 4. ISP

Bad:
```ts
function check(deps: WholeApplication) { /* uses one method */ }
```
Good:
```ts
function check(resolve: (id: ObjectId) => DiagramObject | undefined) { /* uses resolve */ }
```
Consumer owns the narrow dependency; no broad application service port.

## 5. DIP

Bad:
```ts
const db = new Database(); // inside Model
```
Good:
```ts
function plan(snapshot: unknown, changes: unknown): Result<ChangePlan> { /* pure */ }
```
Core never constructs I/O or imports a host; no port needed when no I/O exists.

## 6. DRY

Bad:
```ts
const id = z.string().regex(ID); // repeated across every record
```
Good:
```ts
const objectId = identifier.brand<"ObjectId">();
```
Define identity grammar once; preserve distinct brands.

## 7. KISS

Bad:
```ts
return { ...base, ...(x ? {x} : {}), ...(y ? {y} : {}) };
```
Good:
```ts
const next = { ...base, label }; return next;
```
Prefer direct record transforms; no conditional spread chains.
Order every file with all exported functions above all private internal functions, so the public surface is found first.

## 8. YAGNI

Bad:
```ts
class RuntimePluginBusWithHotReload {}
```
Good:
```ts
const rules = [validateObjects, validateSections];
```
Ship needed pure rules; no runtime plugin or I/O adapter without a real use.

## 9. Typed error outcomes

Bad:
```ts
return failure('invalid-input', issues.map(issue => issue.message).join('; '));
return { ok: false, error, diagnostics: moreErrors }; // two failure channels
```
Good:
```ts
// Each capability declares this shape locally; E defaults to its own named error.
type Result<T, E = ValidationError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
interface ValidationError {
  readonly code: 'validation-failed';
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
}
// At a consumer boundary, translation retains the originating typed failure.
return { ok: false, error: {
  code: 'invariant-violation', path, message, recovery, targets: [], traceId: null,
  source: planned.error,
} };
```

- Declare Result locally in each capability; no shared kernel or foreign Result import to define it. A local default error type keeps signatures concise.
- Supported-input failures expose only `error`, never a partial `value` or optional second failure channel.
- Validation failures contain a non-empty diagnostic tuple. Empty accumulated issues mean success; empty rejected evidence is a provider bug.
- Adapters retain typed originating failures under `error.source`. Add context without replacing source codes, paths, spans, targets, expected values or recovery. Cleanup failures belong inside the primary error as `cleanup`.
- Source contracts are consumer-owned data protocols. Originating owners keep closed code vocabularies; consumers preserve foreign codes without interpreting prose. These declaration records contain no foreign behavior or shared kernel dependency.
- Runtime readers must validate and retain source evidence. A boundary probe must pass multiple distinct diagnostics through the real adapter and serialization boundary and compare the complete evidence.
- Format only at terminal/browser display boundaries. Never recover by parsing a message string.
- Private typed throw idioms (`TokenFault`, `LanguageFault`, etc.) remain legal when the public boundary converts them to Result. Do not rewrite them merely for envelope consistency.

## 10. Idempotency and failure semantics

Bad:
```ts
snapshot.revision++; persist(snapshot);
```
Good:
```ts
/** Pure replay; Authoring owns commit/recovery. */
function plan(snapshot: unknown, changes: unknown): Result<ChangePlan> { /* compute */ }
```
Same snapshot/change gives same plan; failed plans expose no partial candidate.

## 11. Deep modules

Bad:
```ts
export { resolvePrivateField, checkEachRule, mutateCandidate };
```
Good:
```ts
export { validate, plan };
```
Consumers ask for validity or a transition; private algorithms stay hidden.

## 12. Law of Demeter

Bad:
```ts
store.getCollection(id).getSection(s).deleteNode(n);
```
Good:
```ts
const section = collection.sections.find(matchesId);
```
Read data directly; do not navigate collaborator service chains.

## 13. Immutability

Bad:
```ts
collection.objects.push(object);
```
Good:
```ts
const next = { ...collection, objects: [...collection.objects, object] };
```
Readonly records; detached frozen public output. Bounded local traversal state must never escape or persist across calls.

## 14. Type safety

Bad:
```ts
const object = input as DiagramObject;
```
Good:
```ts
const parsed = objectSchema.safeParse(input);
```
Unknown input is checked. No any, unchecked assertions or non-null assertions; brands come from checked schemas.

## 15. Cognitive complexity

Bad:
```ts
if (a) { for (const b of items) { if (b.valid) act(b); } }
```
Good:
```ts
const eligible = items.filter(isEligible);
eligible.forEach(applyRule);
```
Named single-purpose functions; Sonar maximum 2 per function, including test callbacks. Do not compress branches into clever expressions.

## 16. Testability

Bad:
```ts
const revision = Date.now(); const file = process.env.DIAGRAM;
```
Good:
```ts
const result = plan(fixture, changes);
```
No ambient inputs. Tests assert independently specified public outcomes; no mocks of private helpers or E2E.

## Review evidence

Score each target file against all 16 original anchors. Cite the target and direct collaborator evidence; a passing command is not a standards score. Do not award 10 to absent subtyping. Record verified failures without waivers. Tests cross public contracts, assert failure codes/paths and independently expected domain state, and demonstrate meaningful invalid counterexamples. No tests that merely repeat the implementation.
