/*
 * Entities and ownership rules of the build-spec profile: shown entities must be entity nodes
 * carrying an invariant, and ownership must show one CRUD table with the fixed columns and
 * exactly one row per entity. Each rule returns its findings.
 */
import type {
  ProfileDeclarationIndex,
  ProfileFinding,
} from '../../../contract/records/profiles.js';
import {
  descendants,
  field,
  fieldFinding,
  findingAt,
  id,
  sectionById,
  shown,
  text,
  type Declaration,
  type SyntaxValue,
} from './declarations.js';

/** Entity findings first, then the CRUD table findings of the ownership section. */
export function lintEntitiesAndCrud(indexed: ProfileDeclarationIndex): ProfileFinding[] {
  const entities = sectionById(indexed.sections, 'entities');
  const ownership = sectionById(indexed.sections, 'ownership');
  if (entities === undefined || ownership === undefined) return [];
  return [
    ...entityFindings(shown(entities), indexed.nodes, entities),
    ...crudFindings(indexed, ownership, shown(entities)),
  ];
}

/** Each shown entity must resolve to an entity node with an invariant. */
function entityFindings(
  entityIds: readonly string[],
  nodes: readonly Declaration[],
  section: Declaration,
): ProfileFinding[] {
  return entityIds.flatMap((entityId) =>
    entityFinding(
      nodes.find((node) => id(node) === entityId),
      entityId,
      section,
    ),
  );
}

/** A missing or wrongly-kinded entity is reported at the section; a missing invariant at the node. */
function entityFinding(
  entity: Declaration | undefined,
  entityId: string,
  section: Declaration,
): ProfileFinding[] {
  if (!isEntityNode(entity))
    return [
      findingAt(section, `section @entities show @${entityId}`, 'Entities must show entity nodes.'),
    ];
  return invariantFinding(entity, entityId);
}

/** The declaration exists and its kind field is 'entity'. */
function isEntityNode(entity: Declaration | undefined): entity is Declaration {
  return entity !== undefined && text(entity, 'kind') === 'entity';
}

/** An entity without an invariant text child is reported. */
function invariantFinding(
  entity: Declaration,
  entityId: string,
): ProfileFinding[] {
  return entity.children.some((child) => child.kind === 'text')
    ? []
    : [
        findingAt(
          entity,
          `node @${entityId}`,
          'Entity must contain at least one invariant text child.',
        ),
      ];
}

/** The ownership note must hold exactly one CRUD table; its columns and rows are checked. */
function crudFindings(
  indexed: ProfileDeclarationIndex,
  ownership: Declaration,
  entityIds: readonly string[],
): ProfileFinding[] {
  const tables = crudTables(indexed, ownership);
  const [table] = tables;
  if (tables.length !== 1 || table === undefined)
    return [
      findingAt(
        ownership,
        'section @ownership',
        'Ownership must show one note containing exactly one CRUD table.',
      ),
    ];
  const rows = descendants(table, 'row');
  const expectedRows = new Set(entityIds.map((entityId) => `${entityId}-row`));
  return [
    ...columnFinding(table),
    ...rows.flatMap((row) => crudRowFindings(row, expectedRows)),
    ...missingRowFindings(table, rows, expectedRows),
    ...duplicateRowFindings(table, rows),
  ];
}

/** The tables inside the note nodes the ownership section shows. */
function crudTables(
  indexed: ProfileDeclarationIndex,
  ownership: Declaration,
): readonly Declaration[] {
  return shown(ownership).flatMap((objectId) => {
    const note = indexed.nodes.find((node) => id(node) === objectId);
    return note !== undefined && note.kind === 'node' && text(note, 'kind') === 'note'
      ? descendants(note, 'table')
      : [];
  });
}

/** The CRUD table's columns must be exactly Object, Create, Read, Update, Delete. */
function columnFinding(table: Declaration): ProfileFinding[] {
  return validColumns(field(table, 'columns'))
    ? []
    : [
        fieldFinding(
          table,
          'columns',
          'table',
          'CRUD table columns must be exactly Object, Create, Read, Update, Delete.',
        ),
      ];
}

/** The columns field is the fixed five-column list. */
function validColumns(columns: SyntaxValue): boolean {
  const expected = ['Object', 'Create', 'Read', 'Update', 'Delete'];
  return (
    Array.isArray(columns) &&
    columns.length === expected.length &&
    columns.every((value, index) => value === expected[index])
  );
}

/** One row's id finding first, then its cell-count finding. */
function crudRowFindings(
  row: Declaration,
  expectedRows: ReadonlySet<string>,
): ProfileFinding[] {
  const rowId = id(row);
  return [...rowIdFinding(row, rowId, expectedRows), ...rowCellsFinding(row, rowId)];
}

/** A row id must be one entity's stable `<entity-id>-row` id. */
function rowIdFinding(
  row: Declaration,
  rowId: string | undefined,
  expectedRows: ReadonlySet<string>,
): ProfileFinding[] {
  if (rowId !== undefined && expectedRows.has(rowId)) return [];
  return [findingAt(row, rowLabel(rowId), 'CRUD rows must use one stable <entity-id>-row ID.')];
}

/** A row must contain exactly five cells. */
function rowCellsFinding(
  row: Declaration,
  rowId: string | undefined,
): ProfileFinding[] {
  const cells = field(row, 'cells');
  return Array.isArray(cells) && cells.length === 5
    ? []
    : [fieldFinding(row, 'cells', rowLabel(rowId), 'CRUD rows must contain five cells.')];
}

/** The display path of a row whose id may be missing. */
function rowLabel(rowId: string | undefined): string {
  return `row @${rowId ?? '?'}`;
}

/** Each entity must have its row in the table. */
function missingRowFindings(
  table: Declaration,
  rows: readonly Declaration[],
  expectedRows: ReadonlySet<string>,
): ProfileFinding[] {
  return [...expectedRows].flatMap((expectedRow) =>
    rows.some((row) => id(row) === expectedRow)
      ? []
      : [findingAt(table, `row @${expectedRow}`, 'CRUD table is missing a row for an entity.')],
  );
}

/** A row id used more than once is reported at its first row. */
function duplicateRowFindings(
  table: Declaration,
  rows: readonly Declaration[],
): ProfileFinding[] {
  return [...countRowIds(rows).entries()].flatMap(([rowId, count]) =>
    count > 1
      ? [
          findingAt(
            rows.find((row) => id(row) === rowId) ?? table,
            `row @${rowId}`,
            'CRUD table must contain exactly one row for each entity.',
          ),
        ]
      : [],
  );
}

/** How often each row id appears. */
function countRowIds(rows: readonly Declaration[]): ReadonlyMap<string, number> {
  const rowIds = rows.flatMap((row) => {
    const rowId = id(row);
    return rowId === undefined ? [] : [rowId];
  });
  return tally(rowIds);
}

/** A count per id, in first-seen order. */
function tally(rowIds: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const rowId of rowIds) {
    counts.set(rowId, (counts.get(rowId) ?? 0) + 1);
  }
  return counts;
}
