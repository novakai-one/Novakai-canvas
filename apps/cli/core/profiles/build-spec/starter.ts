import type { ProfileDescriptor } from '../../../contract/records/profiles.js';

export const buildSpecProfile: ProfileDescriptor = {
  id: 'build-spec@1',
  name: 'Build specification',
  description: 'A five-document convention for readable implementation plans.',
  commands: {
    describe: 'canvas profile describe build-spec@1',
    scaffold:
      'canvas profile scaffold build-spec@1 --id example --title "Example build" --out /tmp/example.canvas',
    lint: 'canvas profile lint FILE --profile build-spec@1',
  },
  slots: [
    {
      id: '@repo',
      order: 1,
      required: true,
      modes: ['tree'],
      description: 'Repo tree with scoped NEW/CHANGE/REUSE labels.',
    },
    {
      id: '@entities',
      order: 2,
      required: true,
      modes: ['er'],
      description: 'Entities with explicit fields and invariant text.',
    },
    {
      id: '@modules',
      order: 3,
      required: true,
      modes: ['modules'],
      description: 'Interfaces and signatures reusing canonical repo objects.',
    },
    {
      id: '@ownership',
      order: 4,
      required: true,
      modes: ['grid'],
      description: 'One Object/Create/Read/Update/Delete table row per entity.',
    },
  ],
  appendix: {
    idPattern: '@(flow|sequence|state)-5N',
    modes: ['flow', 'sequence', 'state'],
    description: 'At least one numbered 5.N flow, sequence or state appendix.',
  },
  conventions: [
    'Required section numeric orders must increase: repo < entities < modules < ownership < every appendix; extra sections may appear anywhere.',
    'Appendix IDs use @flow-5N, @sequence-5N or @state-5N; the prefix must match the native mode and N is positive.',
    'CRUD row IDs are @<entity-id>-row, exactly one five-cell row for each entity shown in @entities.',
    'Extra non-profile sections are preserved and do not satisfy or invalidate a reserved profile slot.',
  ],
  notes: [
    'These are logical documents in one ordinary collection, not five files.',
    'Sequence lifelines reuse canonical modules; interface lifelines use a linked participant proxy.',
    'Lint checks structure only; it does not certify prose, implementation completeness or rendering.',
  ],
};

/** Small native current-DSL starter; profile commands never depend on a service or workspace. */
export const buildSpecStarter = String.raw`# Editable build-spec@1 starter using current native DSL.
# Sequence lifelines reuse canonical modules; the interface uses a linked participant proxy.
canvas 1
collection @build-spec-starter "Edit a title safely — build spec starter" theme=paper {
  node @root concept "example-app/" {}
  node @web concept "apps/web/" {}
  node @controller module "title-controller.ts [CHANGE]" {
    signature @rename "renameTitle" parameters=["edit: TitleEdit"] returns="Promise<Result<Receipt>>"
  }
  node @domain concept "capability/title/" {}
  node @validator module "validate-title.ts [NEW]" {
    signature @validate "validateTitle" parameters=["edit: TitleEdit"] returns="Result<ValidatedTitle>"
  }
  node @persistence concept "capability/persistence/" {}
  node @store interface "title-store.ts [REUSE]" {
    signature @save "saveTitle" parameters=["title: ValidatedTitle"] returns="Promise<Result<Receipt>>"
  }

  wire @tree-root-web @root -> @web "contains" kind=parent
  wire @tree-web-controller @web -> @controller "contains" kind=parent
  wire @tree-root-domain @root -> @domain "contains" kind=parent
  wire @tree-domain-validator @domain -> @validator "contains" kind=parent
  wire @tree-root-persistence @root -> @persistence "contains" kind=parent
  wire @tree-persistence-store @persistence -> @store "contains" kind=parent

  section @repo "1 / Repo tree" mode=tree order=0 {
    show @root @web @controller @domain @validator @persistence @store detail=label
    connect @tree-root-web @tree-web-controller @tree-root-domain @tree-domain-validator @tree-root-persistence @tree-persistence-store
    root @root
  }

  node @title-edit entity "TitleEdit [NEW]" {
    field @edit-id "id" type="string" key=primary
    field @edit-title "title" type="string"
    field @edit-base "baseRevision" type="number"
    text @edit-invariant "The title is trimmed, non-empty and accepted only against its captured revision."
    text @validated-view "ValidatedTitle carries the trimmed title and captured revision into persistence."
  }
  node @receipt entity "Receipt [REUSE]" {
    field @receipt-id "id" type="string" key=primary
    field @receipt-revision "revision" type="number"
    text @receipt-invariant "A successful write returns one durable receipt for the committed revision."
  }
  wire @edit-produces-receipt @title-edit.@edit-id -> @receipt.@receipt-id "commits as" kind=association from=1 to=0..1

  section @entities "2 / Entities and invariants" mode=er order=1 {
    show @title-edit @receipt
    connect @edit-produces-receipt
  }

  wire @controller-validates @controller -> @validator.@validate "validates title" kind=reference
  wire @controller-stores @controller -> @store.@save "stores accepted title" kind=reference

  section @modules "3 / Modules" mode=modules layout=layered direction=right order=2 {
    show @controller @validator @store
    connect @controller-validates @controller-stores
  }

  node @crud note "Ownership / CRUD" size=large {
    table @crud-table columns=["Object", "Create", "Read", "Update", "Delete"] {
      row @title-edit-row cells=["TitleEdit", "title-controller: capture draft", "validateTitle; renameTitle", "Never; immutable", "Release after confirmed receipt or explicit discard; retain on rejection"]
      row @receipt-row cells=["Receipt", "title-store: successful commit", "title-controller: confirm result", "Never; immutable", "Never in this workflow"]
    }
  }

  section @ownership "4 / Ownership and CRUD" mode=grid columns=1 order=3 {
    show @crud
  }

  node @start start "Submit title edit" {}
  node @valid decision "Title and revision valid?" {}
  node @commit step "Store title atomically" {}
  node @confirmed end "Return receipt" {}
  node @rejected end "Keep draft and explain problem" {}
  wire @flow-check @start -> @valid "Validate" kind=flow
  wire @flow-commit @valid -> @commit "Yes" kind=flow
  wire @flow-reject @valid -> @rejected "No" kind=flow
  wire @flow-confirm @commit -> @confirmed "Committed" kind=flow

  section @flow-51 "5.1 / Validate and store title" mode=flow direction=right order=4 {
    show @start @valid @commit @confirmed @rejected
    connect @flow-check @flow-commit @flow-reject @flow-confirm
  }

  node @p-human participant "Human" {}
  node @p-store participant "title-store.ts" {
    link @store-link "Interface" target=@store section=@modules
  }
  section @sequence-52 "5.2 / Commit a valid title" mode=sequence order=5 {
    show @p-human @controller @validator @p-store detail=label
    event @submit @p-human -> @controller "renameTitle(edit)" kind=call
    event @check @controller -> @validator "validateTitle(edit)" kind=call
    event @accepted @validator -> @controller "ValidatedTitle" kind=return
    event @save-title @controller -> @p-store "saveTitle(title)" kind=call
    event @saved @p-store -> @controller "Receipt" kind=return
    event @confirm @controller -> @p-human "Confirmed revision" kind=return
  }
}`;

export function scaffoldBuildSpec(
  id: string,
  title: string,
): string {
  const escapedTitle = title.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return buildSpecStarter
    .replace(
      'collection @build-spec-starter "Edit a title safely — build spec starter"',
      `collection @${id} "${escapedTitle}"`,
    )
    .replace(
      '# Editable build-spec@1 starter using current native DSL.',
      `# Editable build-spec@1 starter for ${id}.`,
    );
}
