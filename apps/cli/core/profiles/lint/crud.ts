/*
 * Ownership rules of the build-spec profile: the ownership section shows one note holding exactly
 * one CRUD table, with the fixed columns and one five-cell `<entity-id>-row` row per entity.
 * Pure; the findings are returned.
 */
import type { ProfileFinding } from '../../../contract/records/profiles.js';
import {
  descendants,
  field,
  id,
  shown,
  text,
  type Declaration,
  type DeclarationIndex,
  type SyntaxValue,
} from './declarations.js';
import { fieldFinding, findingAt } from './findings.js';

/** The ownership note must hold exactly one CRUD table; its columns and rows are checked. */
export function crudFindings(
  indexed: DeclarationIndex,
  ownership: Declaration,
  entityIds: readonly string[],
): readonly ProfileFinding[] {
  const tables = crudTables(indexed, ownership);
  const [table] = tables;
  if (tables.length !== 1 || table === undefined)
    return [
      findingAt(ownership, {
        code: 'crud-table',
        path: 'section @ownership',
        message: 'Ownership must show one note containing exactly one CRUD table.',
      }),
    ];
  const rows = descendants(table, 'row');
  const expectedRows = new Set(entityIds.map((entityId) => `${entityId}-row`));
  return [
    ...columnFinding(table),
    ...rows.flatMap((row) => crudRowFindings(row, expectedRows)),
    ...missingRowFindings(table, rows, expectedRows),
    ...duplicateRowFindings(rows),
  ];
}

/** The tables inside the note nodes the ownership section shows. */
function crudTables(
  indexed: DeclarationIndex,
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
function columnFinding(table: Declaration): readonly ProfileFinding[] {
  return validColumns(field(table, 'columns'))
    ? []
    : [
        fieldFinding(table, 'columns', {
          code: 'crud-columns',
          path: 'table',
          message: 'CRUD table columns must be exactly Object, Create, Read, Update, Delete.',
        }),
      ];
}

/** The columns field is exactly {@link crudColumns}. */
function validColumns(columns: SyntaxValue): boolean {
  return (
    Array.isArray(columns) &&
    columns.length === crudColumns.length &&
    columns.every((value, index) => value === crudColumns[index])
  );
}

/** The fixed CRUD table columns; every row has one cell per column. */
const crudColumns = Object.freeze(['Object', 'Create', 'Read', 'Update', 'Delete'] as const);

/** One row's id finding first, then its cell-count finding. */
function crudRowFindings(
  row: Declaration,
  expectedRows: ReadonlySet<string>,
): readonly ProfileFinding[] {
  const rowId = id(row);
  return [...rowIdFinding(row, rowId, expectedRows), ...rowCellsFinding(row, rowId)];
}

/** A row id must be one entity's stable `<entity-id>-row` id. */
function rowIdFinding(
  row: Declaration,
  rowId: string | undefined,
  expectedRows: ReadonlySet<string>,
): readonly ProfileFinding[] {
  if (rowId !== undefined && expectedRows.has(rowId)) return [];
  return [
    findingAt(row, {
      code: 'crud-row-id',
      path: rowLabel(rowId),
      message: 'CRUD rows must use one stable <entity-id>-row ID.',
    }),
  ];
}

/** A row must contain one cell per CRUD column. */
function rowCellsFinding(
  row: Declaration,
  rowId: string | undefined,
): readonly ProfileFinding[] {
  const cells = field(row, 'cells');
  return Array.isArray(cells) && cells.length === crudColumns.length
    ? []
    : [
        fieldFinding(row, 'cells', {
          code: 'crud-cells',
          path: rowLabel(rowId),
          message: 'CRUD rows must contain five cells.',
        }),
      ];
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
): readonly ProfileFinding[] {
  return [...expectedRows].flatMap((expectedRow) =>
    rows.some((row) => id(row) === expectedRow)
      ? []
      : [
          findingAt(table, {
            code: 'crud-missing-row',
            path: `row @${expectedRow}`,
            message: 'CRUD table is missing a row for an entity.',
          }),
        ],
  );
}

/** A row id used more than once is reported once, at its first row. */
function duplicateRowFindings(rows: readonly Declaration[]): readonly ProfileFinding[] {
  const rowIds = rows.map(id);
  return rows.flatMap((row, index) =>
    firstOfRepeated(rowIds, index)
      ? [
          findingAt(row, {
            code: 'crud-duplicate-row',
            path: rowLabel(rowIds[index]),
            message: 'CRUD table must contain exactly one row for each entity.',
          }),
        ]
      : [],
  );
}

/** The row at `index` has an id, is the first row with it, and a later row repeats it. */
function firstOfRepeated(
  rowIds: readonly (string | undefined)[],
  index: number,
): boolean {
  const rowId = rowIds[index];
  return (
    rowId !== undefined && rowIds.indexOf(rowId) === index && rowIds.lastIndexOf(rowId) > index
  );
}
