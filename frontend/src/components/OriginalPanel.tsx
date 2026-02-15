import { useState, useMemo, forwardRef, useImperativeHandle, useRef } from 'react';
import type { ExcelSheet, ExcelCell, MergedRange } from '../types';

interface OriginalPanelProps {
  visible: boolean;
  sheet?: ExcelSheet;
  activeCell?: string | null;
  onCellClick?: (cellRef: string, row: number, col: string) => void;
}

export interface OriginalPanelHandle {
  scrollToCell: (cellRef: string) => void;
}

// Convert column letter to number (A=1, B=2, ... Z=26, AA=27)
function colLetterToNum(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

// Build merge info maps from mergedRanges
function buildMergeInfo(mergedRanges: MergedRange[] | undefined) {
  // Map of "row-col" -> colspan for merge origins
  const colspanMap = new Map<string, number>();
  // Map of "row-col" -> rowspan for merge origins
  const rowspanMap = new Map<string, number>();
  // Set of "row-col" keys to skip (part of merge but not origin)
  const skipCells = new Set<string>();

  if (!mergedRanges) return { colspanMap, rowspanMap, skipCells };

  for (const merge of mergedRanges) {
    const startColNum = colLetterToNum(merge.startCol);
    const endColNum = colLetterToNum(merge.endCol);
    const colspan = endColNum - startColNum + 1;
    const rowspan = merge.endRow - merge.startRow + 1;

    // Set colspan/rowspan for the origin cell
    const originKey = `${merge.startRow}-${merge.startCol}`;
    if (colspan > 1) colspanMap.set(originKey, colspan);
    if (rowspan > 1) rowspanMap.set(originKey, rowspan);

    // Mark all other cells in the merge range to skip
    for (let r = merge.startRow; r <= merge.endRow; r++) {
      for (let c = startColNum; c <= endColNum; c++) {
        // Convert column number back to letter
        let colLetter = '';
        let col = c;
        while (col > 0) {
          const mod = (col - 1) % 26;
          colLetter = String.fromCharCode(65 + mod) + colLetter;
          col = Math.floor((col - 1) / 26);
        }
        const key = `${r}-${colLetter}`;
        if (key !== originKey) {
          skipCells.add(key);
        }
      }
    }
  }

  return { colspanMap, rowspanMap, skipCells };
}

export const OriginalPanel = forwardRef<OriginalPanelHandle, OriginalPanelProps>(function OriginalPanel(
  { visible, sheet, activeCell, onCellClick },
  ref
) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  useImperativeHandle(ref, () => ({
    scrollToCell: (cellRef: string) => {
      const element = cellRefs.current.get(cellRef);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    },
  }));

  // Get column headers and rows
  const { columns, rows } = useMemo(() => {
    if (!sheet?.rows?.length) return { columns: [], rows: [] };

    // Collect all unique column letters
    const colSet = new Set<string>();
    sheet.rows.forEach((row) => {
      if (row.cells) {
        Object.keys(row.cells).forEach((col) => colSet.add(col));
      }
    });

    // Sort columns alphabetically (A, B, C... AA, AB...)
    const sortedCols = Array.from(colSet).sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });

    return { columns: sortedCols, rows: sheet.rows };
  }, [sheet]);

  // Build merge info
  const { colspanMap, rowspanMap, skipCells } = useMemo(
    () => buildMergeInfo(sheet?.mergedRanges),
    [sheet?.mergedRanges]
  );

  if (!visible) return null;

  const getCellStyle = (cell: ExcelCell | undefined, isActive: boolean): string => {
    if (isActive) {
      return 'bg-accent/20 text-accent ring-1 ring-accent ring-inset';
    }

    if (!cell) return 'bg-app';

    const classes: string[] = ['text-primary'];

    if (cell.format?.bold) classes.push('font-medium');

    // Role-based styling - subtle colors
    switch (cell.role) {
      case 'header':
        classes.push('bg-blue-500/10 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 font-medium');
        break;
      case 'section':
        classes.push('bg-purple-500/10 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300 font-medium');
        break;
      case 'label':
        classes.push('bg-app-secondary text-muted');
        break;
      case 'value':
        classes.push('bg-emerald-500/5 dark:bg-emerald-500/5 text-primary');
        break;
      case 'input':
        classes.push('bg-amber-500/5 dark:bg-amber-500/5 text-primary');
        break;
      case 'empty':
        classes.push('bg-app');
        break;
      default:
        if (cell.value) {
          classes.push('bg-app');
        } else {
          classes.push('bg-app-secondary/50');
        }
    }

    return classes.join(' ');
  };

  const handleCellClick = (cellRef: string, row: number, col: string) => {
    if (onCellClick) {
      onCellClick(cellRef, row, col);
    }
  };

  return (
    <div className="flex-1 flex flex-col border-r border-default overflow-hidden min-w-0 bg-app">
      {/* Header */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
        <span className="text-[13px] font-medium text-primary">Original</span>
        <div className="flex items-center gap-3">
          {activeCell && (
            <span className="text-[11px] text-accent font-mono">
              {activeCell}
            </span>
          )}
          <span className="text-[11px] text-muted">
            {sheet ? `${rows.length} rows` : 'No sheet'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {sheet && rows.length > 0 ? (
          <table className="border-collapse text-[11px] w-full">
            <thead>
              <tr>
                <th className="border border-default p-1.5 bg-app-secondary text-muted font-medium sticky top-0 left-0 z-20 w-10 text-center text-[10px]">
                  #
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="border border-default p-1.5 bg-app-secondary text-muted font-medium sticky top-0 z-10 min-w-[60px]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row}>
                  <td className="border border-default p-1.5 bg-app-secondary text-muted text-center sticky left-0 z-10 text-[10px]">
                    {row.row}
                  </td>
                  {columns.map((col) => {
                    const cellKey = `${row.row}-${col}`;

                    // Skip cells that are part of a merge but not the origin
                    if (skipCells.has(cellKey)) {
                      return null;
                    }

                    const cell = row.cells?.[col];
                    // Use the actual cell ref if available (Word docs use T<table>R<row>C<col> format)
                    // Otherwise fall back to Excel-style ref
                    const cellRef = cell?.ref || `${col}${row.row}`;
                    const isHovered = hoveredCell === cellRef;
                    const isActive = activeCell === cellRef;

                    // Get colspan/rowspan for this cell
                    const colspan = colspanMap.get(cellKey);
                    const rowspan = rowspanMap.get(cellKey);

                    return (
                      <td
                        key={col}
                        ref={(el) => { if (el) cellRefs.current.set(cellRef, el); }}
                        colSpan={colspan}
                        rowSpan={rowspan}
                        className={`border border-subtle p-2 max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap transition-colors cursor-pointer ${getCellStyle(cell, isActive)} ${isHovered && !isActive ? 'bg-accent/10' : ''}`}
                        onMouseEnter={() => setHoveredCell(cellRef)}
                        onMouseLeave={() => setHoveredCell(null)}
                        onClick={() => handleCellClick(cellRef, row.row, col)}
                        title={cell?.value || ''}
                      >
                        {cell?.value || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted text-center py-12 text-[13px]">
            {sheet ? 'No data in sheet' : 'No sheet selected'}
          </div>
        )}
      </div>
    </div>
  );
});
