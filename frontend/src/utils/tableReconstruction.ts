import type { ExcelSheet, ExcelCell, ReconstructedTable, TableCell } from '../types';

/**
 * Reconstruct tables from raw Excel sheet structure data
 * This applies the same logic as the backend but to the original structure
 */
export function reconstructTablesFromSheet(sheet: ExcelSheet): {
  tables: ReconstructedTable[];
  remainingCells: ExcelCell[];
  sectionMap: Map<string, { tables: ReconstructedTable[]; cells: ExcelCell[]; sectionType: string }>;
} {
  const rowMap = new Map<number, ExcelCell[]>();
  const cellsWithoutPosition: ExcelCell[] = [];
  const allCells = sheet.rows.flatMap(row =>
    Object.values(row.cells).filter(cell => cell.filled && cell.value?.trim())
  );

  // Group cells by row number
  for (const cell of allCells) {
    const rowMatch = cell.ref.match(/\d+/);
    if (!rowMatch) {
      cellsWithoutPosition.push(cell);
      continue;
    }

    const rowNumber = parseInt(rowMatch[0], 10);
    if (!rowMap.has(rowNumber)) {
      rowMap.set(rowNumber, []);
    }
    rowMap.get(rowNumber)!.push(cell);
  }

  // Find potential table structures (rows with multiple columns)
  const tableRows = Array.from(rowMap.entries())
    .filter(([_, rowCells]) => rowCells.length > 1) // More than one cell per row = potential table
    .sort(([a], [b]) => a - b); // Sort by row number

  const tables: ReconstructedTable[] = [];
  const tableCellRefs = new Set<string>();

  // Group consecutive rows into tables
  if (tableRows.length > 0) {
    let currentTable: {
      rows: { rowNumber: number; cells: TableCell[] }[];
      sourceItems: string[];
      startRow: number;
      endRow: number;
    } | null = null;

    for (const [rowNumber, rowCells] of tableRows) {
      // Sort cells by column
      const sortedCells = rowCells.sort((a, b) => {
        const colA = extractColumn(a.ref);
        const colB = extractColumn(b.ref);
        return colA.localeCompare(colB);
      });

      const tableCells: TableCell[] = [];
      for (const cell of sortedCells) {
        tableCells.push({
          column: extractColumn(cell.ref),
          value: cell.value,
          itemId: cell.ref, // Use cell ref as item ID for structure data
          type: cell.role || 'field'
        });
      }

      // Check if this row continues the current table
      if (currentTable && rowNumber <= currentTable.endRow + 3) {
        // Continue existing table (allow gaps of up to 3 rows)
        currentTable.rows.push({
          rowNumber,
          cells: tableCells
        });
        currentTable.sourceItems.push(...sortedCells.map(c => c.ref));
        currentTable.endRow = rowNumber;
      } else {
        // Finalize previous table if exists
        if (currentTable && currentTable.rows.length > 1) { // Only create tables with multiple rows
          finishStructureTable(currentTable, tables);
        }

        // Start new table
        currentTable = {
          rows: [{
            rowNumber,
            cells: tableCells
          }],
          sourceItems: sortedCells.map(c => c.ref),
          startRow: rowNumber,
          endRow: rowNumber
        };
      }

      // Mark cells as part of table
      sortedCells.forEach(cell => tableCellRefs.add(cell.ref));
    }

    // Finalize last table
    if (currentTable && currentTable.rows.length > 1) {
      finishStructureTable(currentTable, tables);
    }
  }

  // Remaining cells not part of tables
  const remainingCells = [
    ...cellsWithoutPosition,
    ...allCells.filter(cell => !tableCellRefs.has(cell.ref))
  ];

  // Create section map (simplified for structure data - group by proximity)
  const sectionMap = new Map<string, { tables: ReconstructedTable[]; cells: ExcelCell[]; sectionType: string }>();

  // Group tables and cells into rough sections based on row ranges
  const sections = groupIntoSections(tables, remainingCells);
  sections.forEach((section, index) => {
    const sectionName = section.name || `Section ${index + 1}`;
    let sectionType: string;
    if (section.tables.length > 0 && section.cells.length === 0) {
      sectionType = 'table_data';
    } else if (section.tables.length === 0) {
      sectionType = 'individual_items';
    } else {
      sectionType = 'mixed';
    }

    sectionMap.set(sectionName, {
      tables: section.tables,
      cells: section.cells,
      sectionType
    });
  });

  return { tables, remainingCells, sectionMap };
}

function finishStructureTable(
  currentTable: {
    rows: { rowNumber: number; cells: TableCell[] }[];
    sourceItems: string[];
    startRow: number;
    endRow: number;
  },
  tables: ReconstructedTable[]
) {
  if (currentTable.rows.length === 0) return;

  // Generate headers from columns
  const allColumns = new Set<string>();
  for (const row of currentTable.rows) {
    for (const cell of row.cells) {
      allColumns.add(cell.column);
    }
  }
  const headers = Array.from(allColumns).sort();

  // Generate table title based on content
  const firstRow = currentTable.rows[0];
  const hasHeaderRow = firstRow.cells.some(cell =>
    cell.type === 'header' || cell.type === 'section'
  );

  let tableTitle = '';
  if (hasHeaderRow && firstRow.cells.length > 0) {
    tableTitle = firstRow.cells[0].value || `Rows ${currentTable.startRow}-${currentTable.endRow}`;
  } else {
    tableTitle = `Table (rows ${currentTable.startRow}-${currentTable.endRow})`;
  }

  tables.push({
    title: tableTitle,
    headers,
    rows: currentTable.rows,
    sourceItems: currentTable.sourceItems
  });
}

function extractColumn(cellRef: string): string {
  const match = cellRef.match(/^([A-Z]+)/);
  return match ? match[1] : 'A';
}

function groupIntoSections(
  tables: ReconstructedTable[],
  cells: ExcelCell[]
): Array<{ name?: string; tables: ReconstructedTable[]; cells: ExcelCell[] }> {
  // Simple grouping by row ranges - could be more sophisticated
  const sections: Array<{ name?: string; tables: ReconstructedTable[]; cells: ExcelCell[]; startRow: number; endRow: number }> = [];

  // Add tables to sections
  for (const table of tables) {
    const startRow = Math.min(...table.rows.map(r => r.rowNumber));
    const endRow = Math.max(...table.rows.map(r => r.rowNumber));

    sections.push({
      name: table.title,
      tables: [table],
      cells: [],
      startRow,
      endRow
    });
  }

  // Add individual cells to appropriate sections or create new ones
  for (const cell of cells) {
    const rowMatch = cell.ref.match(/\d+/);
    if (!rowMatch) continue;

    const cellRow = parseInt(rowMatch[0], 10);

    // Find section this cell belongs to (within 5 rows of a table)
    let assigned = false;
    for (const section of sections) {
      if (cellRow >= section.startRow - 5 && cellRow <= section.endRow + 5) {
        section.cells.push(cell);
        assigned = true;
        break;
      }
    }

    // If not assigned to any section, create individual cell section
    if (!assigned) {
      sections.push({
        name: `Individual Items (row ${cellRow})`,
        tables: [],
        cells: [cell],
        startRow: cellRow,
        endRow: cellRow
      });
    }
  }

  // Sort sections by start row
  sections.sort((a, b) => a.startRow - b.startRow);

  return sections;
}

export default reconstructTablesFromSheet;