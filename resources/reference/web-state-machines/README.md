# Web workspace state machines (option 2)

Replaces `apps/web/adapters/sessions/workspace-session.ts` (1,746 lines) with pure state machines in `apps/web/core/` and one runner in `apps/web/adapters/`. Code base: `owners-base` @ `5571c7e`. No Codex plan file was used.

**Which document wins:** `plan.md`. The canvases are pictures of it. If a canvas and `plan.md` differ, `plan.md` is right and the canvas is out of date.

## Index of `plan.md`

`plan.md` is long. Read only the section you need: `grep -n '^## \|^### ' plan.md`, then read from that line.

- **§1–2 Words and decisions**: plain meaning of every term (machine, event, effect, runner, lift, gate, command, bridge, view); decisions D1–D12.
- **§3 Facts checked in the code**: each claim with its file:line.
- **§4–5 Brands and type homes**: every ID type, where it is minted or parsed, `contract/brands.ts`, `IdSource` and the ID text formats; which types are declarations and which stay in core.
- **§6 The machines**: types and transition tables for lifecycle, link, catalogue, journal, history, source, notices, diagram, gesture (decision 1), connection, forms.
- **§7 Root**: routing, command keys, lift tables, order rules O1–O4, after-rules F1–F6, the one gate (`sendReadiness` + `gatedSend`), permissions (`may`), the view split by feature, status text.
- **§8 Runner and I/O**: runner rules R1–R8, the effect union, one executor per family, the facade (one file per workflow), **the bridge (§8.5)**, the other types named in signatures (§8.6).
- **§9–10 Error codes and file tree**: closed code unions, foreign failures keyed by owner, refusal classes, the target tree (nothing over 300 lines after P7).
- **§11–12 Behaviour**: 59 behaviours kept, each with the PR whose drive shows it; 32 intentional changes; the 16 quirks.
- **§13 PRs**: rules, the PR list in one stack order (55 PRs), the definition of done (§13.4).
- **§15–16 Corrections and open decisions**: where this plan differs from the design text, and 3 questions for Chris.

## The canvases

| File | What it shows |
|---|---|
| `wsm-0-story.canvas` | Story, totals, removed behaviour, definition of done, task list. It is the story and task collection, so it is **not** linted against `build-spec@1` (it has no repo, entities, modules or ownership sections by design). |
| `wsm-1` … `wsm-9` | One build-spec collection each (runner, rules, requests, start-up, diagram, gesture, forms, contract, view). Each passes `pnpm canvas profile lint <file> --profile build-spec@1`. |

`renders/` holds PNG renders made with `pnpm render:png --collection <file> --out renders/<name>`. They are not committed (about 15 MB); make them locally.

## Open the canvases

1. Build and start the app (repo root):

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @novakai/canvas-web build
   pnpm dev --port 5210 --workspace .novakai/web-state-machines
   ```

2. In another terminal, load every canvas once:

   ```sh
   for f in resources/reference/web-state-machines/*.canvas; do
     id=$(sed -n 's/^collection @\([^ ]*\).*/\1/p' "$f" | head -1)
     pnpm canvas create "$f" --request "wsm-$id" \
       --server http://127.0.0.1:5210 --workspace .novakai/web-state-machines
   done
   ```

3. Open `http://127.0.0.1:5210/?collection=<id>`. `<id>` is the name after `collection @` on line 2 of the file.

To load a changed canvas again: `pnpm canvas read <id> --out /tmp/<id>.canvas` for its revision, then `pnpm canvas replace <file> --revision N` with the same `--server` and `--workspace`.

## Review log

Independent reviewers checked the plan through four lenses. Each finding was checked against the code at `5571c7e` and the plan. 66 findings: 66 fixed, 0 rejected. Three fixes need Chris's answer (`plan.md` §16).

| # | Finding | Lens | Outcome |
|---|---|---|---|
| 1 | Foreign failures: one flat code union for Authoring and Service; Canvas, Library, Layout failures fit no branch | types | Fixed. `Diagnostic` keyed by origin (authoring, service, canvas, library, layout, language, unrecognised); `foreignFailure(owner, source)`; web codes get a typed `cause`; `library-changed` added (§9) |
| 2 | TargetId, SceneKey, LibraryCursor, VisitTime are plain aliases | types | Fixed. Named aliases, listed with sequence and revision as open decision §16 Q1 (§4.1) |
| 3 | Any machine can return post-apply; lint override drops the wildcard-export ban | types | Fixed. `Step<S, O, E>` with per-machine effect subsets; post-apply is its own `apply` family carrying `AdmittedSend`; `syntax()` helper repeats the ban; `Executor<E, A>` (§6.0, §6.4 J3, §8.2) |
| 4 | Refusal typed as broad Diagnostic; journal re-checks the class | types | Fixed. `RefusedCode` and `Refusal`; the apply executor classifies once; journal guard removed; `moveRefusal` keyed by `RefusedCode` (§6.4, §9) |
| 5 | `permissions` cannot call `gatedSend` (no request) | types | Fixed. Request-free `sendReadiness(target)` used by both; `gatedSend` adds workspace and record checks (§7.5, §7.6) |
| 6 | Flat view and 35-method controller kept; busy beside `may` | types | Fixed. D6 changed: view split by feature, one command set per feature, busy flags removed (§2, §7.7, §8.4) |
| 7 | `'unread'` shares the generation value space; cast needed | types | Fixed. `ReadGeneration` union; not-read check returns the generation (§7.5) |
| 8 | Stored generations parsed by web readers with `z.string()` | types | Fixed. Service exports the schema; the 7 readers listed as parse sites in B2b (§4.1) |
| 9 | `ReadVersion` listed as a brand | types | Fixed. Owner record, removed from the brand table (§4.1) |
| 10 | Tickets can be minted anywhere | types | Fixed. Lint `no-restricted-imports` with `importNames` per owning folder (§4.1, §4.2) |
| 11 | Illegal combinations: via, preview choice, duplicate choices, non-placement capture | types | Fixed. `via` only on `installing`; `PreviewAsk`; `Choices` keyed by kind with the shown one present; `GestureCapture<PlacementIntent>` (§6.8, §6.9) |
| 12 | `recording` does not know it is a Retry | types | Fixed. `recording{after}`; a failed Retry write returns to `retryable` (§6.4) |
| 13 | autoCheck list and refusal stored twice | types | Fixed. autoCheck flag on the entry; `ProblemSlot.refusal` holds only the RequestId (§6.4, §6.7 N1) |
| 14 | CommandKey undefined; kinds collide; lifted events look like commands | types | Fixed. `commandKeys` keyed `to:kind`; `by: person \| system` on the two shared events (§7.1) |
| 15 | Canvases show corrected types (ZodTypeDef, no descendantId, StoredSubmission) | types | Fixed in wsm-8 and wsm-3 |
| 16 | B1 re-exports GestureId before B5 | types | Fixed. Re-export moves to B5 (§4.2) |
| 17 | B5 changes a 358-line file with no split | types | Fixed. P7 splits `interaction-handlers.ts` first; B5 parses in a new `gesture-ids.ts` (§10, §13.2) |
| 18 | `records/movement.ts` keeps old types | types | Fixed. MoveReview, MoveOptionKind, MoveOption.id deleted in M29; view type from the gesture phase (§10) |
| 19 | Change stream never opens: a read sets `online` from `unwatched` | behaviour | Fixed. Link holds stream phase and reach separately; a read never moves the stream; every open rereads (§6.2 K2) |
| 20 | "Choose another collection" and opening the chooser mid-render stop working | behaviour | Fixed. Rows for `switch-failed` and `opening` (§6.8) |
| 21 | View maps `choosing` to idle; snapshot, generation, collections missing | behaviour | Fixed. View table rows (§7.7) |
| 22 | Blocked editor sends never answer the store; bindRequest / unlockWithoutRequest missing | behaviour | Fixed. Editor block → answer-caller; editor-sends binds and unlocks (§7.3, §8.4) |
| 23 | M14c drive cannot force constraint-conflict | behaviour | Fixed. M28 note: trigger or "Not verified"; Canvas-side reasoning stated (§3, §13.2) |
| 24 | Lifecycle waits on an event that can be dropped; create while choosing does not open | behaviour | Fixed. Open accepted in every phase; kept during install; every exit from opening settles (§6.1 L3, §6.8 DG6) |
| 25 | Panel-preference problems never reach their slot | behaviour | Fixed. `reportPanel` wired in compose (§6.7 N2, §8.4) |
| 26 | Source readout not reprinted on open or after discard | behaviour | Fixed. Reprint on `shown open`, discard and confirm; `SourceContext` defined (§6.6) |
| 27 | Foreign or corrupt source draft overwritten on first keystroke | behaviour | Fixed. `blocked` phase, never writes (S4); change I30 |
| 28 | Move Apply checks narrower than today | behaviour | Fixed. Capture current adds listed revision and latest generation; the any-collection hold listed as change I31 (§6.9) |
| 29 | `may` and the view built only in M17 but used earlier | delivery | Fixed. M1 declares them, M2 adds empty `project.ts` / `permissions.ts`, each wire PR adds its rows (§7.6, §13.2) |
| 30 | PRs depend on several chains; M17 misses forms and connection | delivery | Fixed. One stack in one written order (§13.1, §13.3) |
| 31 | Bridge has no design | delivery | Fixed. §8.5: interface, message table with add / remove PRs, merge rule, budget |
| 32 | PR sizes over 600; estimates do not add up | delivery | Fixed. Changed lines defined; every PR re-estimated `+a / −r`; big PRs split; totals explained (§13.2) |
| 33 | "Pure, unwired" PRs change or delete live files | delivery | Fixed. Core PRs add files next to live ones; switches and deletes move to wire PRs; moves go to P8 (§13.1) |
| 34 | Second browser cannot force constraint-conflict | delivery | Fixed. Same as 23 |
| 35 | Session and bridge cannot pass the score gate | delivery | Fixed as open decision §16 Q2 (default: exempt, with the shrink rule) |
| 36 | Facade would be a new god file | delivery | Fixed. One file per workflow, 40–90 lines each (§8.4) |
| 37 | `core/creation/records.ts` must be rewritten, in no PR | delivery | Fixed. M21 splits it into `validation.ts` and `changes.ts`; M24 deletes it (§6.11) |
| 38 | Wire drives skip moved work; DoD8 has no PR column | delivery | Fixed. Drag / connect, Cmd+Z, Wire Apply, ER2 drives added; "Driven in" column in §11 |
| 39 | M4 drive expects Saved after Check with no receipt | delivery | Fixed. Check → `No receipt found…` → Retry → Saved (M7, B4) |
| 40 | Nine core PRs unexercised | delivery | Fixed. Wire PRs list the core rows they exercised; connection core and wire merged (M25) |
| 41 | B5 grows a 358-line file | delivery | Fixed. Same as 17 |
| 42 | Session must convert gesture ID to RequestId after B4 / B5 | delivery | Fixed. I2 moves to B4: session mints the request; 3 lookups match the stored gesture (§12.1) |
| 43 | Story canvas PR list disagrees with plan | delivery | Fixed. Task list regenerated from §13.2; journal file count and waiters PR fixed |
| 44 | Bridge unspecified; ProjectedView needed in M1 | spec | Fixed. Same as 31; view records in M1 |
| 45 | `may` used before it exists | spec | Fixed. Same as 29 |
| 46 | No reproducible constraint-conflict drive | spec | Fixed. Same as 23 |
| 47 | Canvases not updated after §15; no authority rule | spec | Fixed. Canvases updated; "plan.md wins" at the top of this file and in plan.md |
| 48 | Canvas, Language, Layout failures have no typed branch | spec | Fixed. Same as 1 |
| 49 | DoD rows cannot pass or name no command | spec | Fixed. §13.4: lint-based purity, scoped post-apply check, PR column, exact commands, all capabilities |
| 50 | Types in signatures never defined | spec | Fixed. §8.6 type blocks, contexts, `commandKeys`, command sets with return types, per-entry permissions on `PendingView` |
| 51 | "gatedSend in dry run" undefined | spec | Fixed. Same as 5 |
| 52 | Changed files in no tree or summary | spec | Fixed. P2a, P2b, connection-policy, features.ts in wsm-8; palette-drop in wsm-7; Dialog.module.css in wsm-9; §10 tree |
| 53 | Removed table misses I28, I29, the Add panel refusal line | spec | Fixed. Rows added with ID text formats; change I32 |
| 54 | Executor factory signatures differ between canvases | spec | Fixed. One signature table (§8.3); canvases aligned; apply is its own family |
| 55 | New files assigned to no PR | spec | Fixed. Every §10 file named in a PR row |
| 56 | Termination reason false | spec | Fixed. Restated (§7.3) |
| 57 | Decision 1 narrowed to constraint-conflict without asking | spec | Fixed as open decision §16 Q3 |
| 58 | One label names several things | spec | Fixed. DG1–DG6, FM1–FM3, CT1–CT2, EF1–EF2, DoD1–DoD12, ER1–ER3 |
| 59 | PR estimates leave out deletions | spec | Fixed. Same as 32 |
| 60 | Task list lacks "done when" and "achieves" columns, +/− | spec | Fixed in wsm-0 and §13.2 |
| 61 | §10 "nothing over 300" vs the canvas | spec | Fixed. P7 split; §10 says why |
| 62 | Module groups not nested by folder; duplicate 3.2; ER without wires | spec | Fixed. Nested groups in wsm-1, 3, 4, 6, 7, 8, 9; wsm-6 renumbered 3.3; wsm-8 ER wires |
| 63 | Renders hard to read | spec | Fixed. Trees nested by folder segment (crossings wsm-1 70→52, wsm-3 77→57, wsm-5 74→66); wsm-5 state split in two (11 → 4 and 5); wsm-6 state simplified (11→8) |
| 64 | wsm-0 fails build-spec lint | spec | Fixed. This README says it is exempt |
| 65 | Two places classify an apply answer | spec | Fixed. Same as 4 |
| 66 | R2 notifies mid-chain | spec | Fixed. Notify once the queue is empty (§8.1 R2, D2) |
