/*
 * Ownership rules of the build-spec profile: the ownership section shows one note holding exactly
 * one CRUD table, with the fixed columns and one five-cell `<entity-id>-row` row per entity.
 * Pure; the findings are returned.
 */
import { descendantId } from '../../../contract/brands.js';
import type { DescendantId, ObjectId } from '../../../contract/brands.js';
import type { ProfileFinding, ProfilePath } from '../../../contract/records/profiles.js';
import type { SyntaxValue } from '../../../contract/records/syntax.js';
import { buildSpecSlots } from '../build-spec/descriptor.js';
import {
  descendants,
  field,
  nodeById,
  rowIdOf,
  shown,
  text,
  type Declaration,
  type DeclarationIndex,
} from './declarations.js';
import { fieldFinding, findingAt } from './findings.js';

/** The ownership note must hold exactly one CRUD table; its columns and rows are checked. */
export function crudFindings(
  indexed: DeclarationIndex,
  ownership: Declaration,
  entityIds: readonly ObjectId[],
): readonly ProfileFinding[] {
  const tables = crudTables(indexed, ownership);
  const [table] = tables;
  if (tables.length !== 1 || table === undefined)
    return [
      findingAt(ownership, {
        code: 'crud-table',
        path: `section @${buildSpecSlots.ownership.id}`,
        message: 'Ownership must show one note containing exactly one CRUD table.',
      }),
    ];
  const rows = descendants(table, 'row');
  const expectedRows = new Set(entityIds.flatMap(entityRowId));
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
    const note = nodeById(indexed.nodes, objectId);
    if (!isNoteNode(note)) return [];
    return descendants(note, 'table');
  });
}

/**
 * An entity's CRUD row ID, `<entity-id>-row`, as Model's `DescendantId`, as a list of one. An
 * entity ID always makes a valid row ID; the check only brands it.
 */
function entityRowId(entityId: ObjectId): readonly DescendantId[] {
  const rowId = descendantId.safeParse(`${entityId}-row`);
  if (!rowId.success) return [];
  return [rowId.data];
}

/** The declaration exists, is a node, and its kind field is 'note'. */
function isNoteNode(node: Declaration | undefined): node is Declaration {
  return node !== undefined && node.kind === 'node' && text(node, 'kind') === 'note';
}

/** The CRUD table's columns must be exactly Object, Create, Read, Update, Delete. */
function columnFinding(table: Declaration): readonly ProfileFinding[] {
  if (validColumns(field(table, 'columns'))) return [];
  return [
    fieldFinding(table, 'columns', {
      code: 'crud-columns',
      path: 'table',
      message: 'CRUD table columns must be exactly Object, Create, Read, Update, Delete.',
    }),
  ];
}

/** The columns field is exactly {@link crudColumns}. */
function validColumns(columns: SyntaxValue | undefined): boolean {
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
  expectedRows: ReadonlySet<DescendantId>,
): readonly ProfileFinding[] {
  const rowId = rowIdOf(row);
  return [...rowIdFinding(row, rowId, expectedRows), ...rowCellsFinding(row, rowId)];
}

/** A row id must be one entity's stable `<entity-id>-row` id. */
function rowIdFinding(
  row: Declaration,
  rowId: DescendantId | undefined,
  expectedRows: ReadonlySet<DescendantId>,
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
  rowId: DescendantId | undefined,
): readonly ProfileFinding[] {
  const cells = field(row, 'cells');
  if (Array.isArray(cells) && cells.length === crudColumns.length) return [];
  return [
    fieldFinding(row, 'cells', {
      code: 'crud-cells',
      path: rowLabel(rowId),
      message: 'CRUD rows must contain five cells.',
    }),
  ];
}

/** The display path of a row whose ID may be missing. */
function rowLabel(rowId: DescendantId | undefined): ProfilePath {
  return `row @${rowId ?? '?'}`;
}

/** Each entity must have its row in the table. */
function missingRowFindings(
  table: Declaration,
  rows: readonly Declaration[],
  expectedRows: ReadonlySet<DescendantId>,
): readonly ProfileFinding[] {
  return [...expectedRows].flatMap((expectedRow) => missingRowFinding(table, rows, expectedRow));
}

/** An entity row the table does not contain is reported at the table. */
function missingRowFinding(
  table: Declaration,
  rows: readonly Declaration[],
  expectedRow: DescendantId,
): readonly ProfileFinding[] {
  if (rows.some((row) => rowIdOf(row) === expectedRow)) return [];
  return [
    findingAt(table, {
      code: 'crud-missing-row',
      path: `row @${expectedRow}`,
      message: 'CRUD table is missing a row for an entity.',
    }),
  ];
}

/** A row id used more than once is reported once, at its first row. */
function duplicateRowFindings(rows: readonly Declaration[]): readonly ProfileFinding[] {
  const rowIds = rows.map(rowIdOf);
  return rows.flatMap((row, index) => duplicateRowFinding(row, rowIds, index));
}

/** The row at `index` is reported when it is the first of a repeated row id. */
function duplicateRowFinding(
  row: Declaration,
  rowIds: readonly (DescendantId | undefined)[],
  index: number,
): readonly ProfileFinding[] {
  if (!firstOfRepeated(rowIds, index)) return [];
  return [
    findingAt(row, {
      code: 'crud-duplicate-row',
      path: rowLabel(rowIds[index]),
      message: 'CRUD table must contain exactly one row for each entity.',
    }),
  ];
}

/** The row at `index` has an id, is the first row with it, and a later row repeats it. */
function firstOfRepeated(
  rowIds: readonly (DescendantId | undefined)[],
  index: number,
): boolean {
  const rowId = rowIds[index];
  return (
    rowId !== undefined && rowIds.indexOf(rowId) === index && rowIds.lastIndexOf(rowId) > index
  );
}
