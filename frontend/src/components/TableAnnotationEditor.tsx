import { useState, useCallback } from "react";
import { Plus, Minus, FloppyDisk, X, Table, Note, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from '@phosphor-icons/react';

export interface TableCell {
  value: string;
  isHeader?: boolean;
  isEdited?: boolean;
  originalValue?: string;
}

export interface AnnotatedTable {
  id: string;
  pageNumber: number;
  title?: string;
  headers: string[];
  rows: TableCell[][];
  notes?: string;
  createdAt?: string;
  isNew?: boolean;
}

export interface PageAnnotation {
  pageNumber: number;
  notes: string;
  missingItems?: string[];
  tables: AnnotatedTable[];
}

interface TableAnnotationEditorProps {
  visible: boolean;
  pageNumber: number;
  existingTables?: AnnotatedTable[];
  onSave: (tables: AnnotatedTable[], pageNotes: string) => void;
  onCancel: () => void;
}

export function TableAnnotationEditor({
  visible,
  pageNumber,
  existingTables = [],
  onSave,
  onCancel,
}: TableAnnotationEditorProps) {
  const [tables, setTables] = useState<AnnotatedTable[]>(existingTables);
  const [selectedTable, setSelectedTable] = useState<string | null>(
    existingTables.length > 0 ? existingTables[0].id : null
  );
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [pageNotes, setPageNotes] = useState("");

  const generateId = () => Math.random().toString(36).substring(2, 10);

  // Create a new empty table
  const addNewTable = useCallback(() => {
    const newTable: AnnotatedTable = {
      id: generateId(),
      pageNumber,
      title: `Table ${tables.length + 1}`,
      headers: ["Column 1", "Column 2", "Column 3"],
      rows: [
        [{ value: "" }, { value: "" }, { value: "" }],
        [{ value: "" }, { value: "" }, { value: "" }],
      ],
      isNew: true,
      createdAt: new Date().toISOString(),
    };
    setTables([...tables, newTable]);
    setSelectedTable(newTable.id);
  }, [tables, pageNumber]);

  // Get the currently selected table
  const currentTable = tables.find(t => t.id === selectedTable);

  // Add a row to the current table
  const addRow = useCallback((position: 'above' | 'below') => {
    if (!currentTable || selectedCell === null) return;

    const newRow: TableCell[] = currentTable.headers.map(() => ({ value: "", isEdited: true }));
    const insertIndex = position === 'above' ? selectedCell.row : selectedCell.row + 1;

    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newRows = [...t.rows];
      newRows.splice(insertIndex, 0, newRow);
      return { ...t, rows: newRows };
    }));
  }, [currentTable, selectedCell, selectedTable, tables]);

  // Add a column to the current table
  const addColumn = useCallback((position: 'left' | 'right') => {
    if (!currentTable || selectedCell === null) return;

    const insertIndex = position === 'left' ? selectedCell.col : selectedCell.col + 1;

    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newHeaders = [...t.headers];
      newHeaders.splice(insertIndex, 0, `Column ${newHeaders.length + 1}`);
      const newRows = t.rows.map(row => {
        const newRow = [...row];
        newRow.splice(insertIndex, 0, { value: "", isEdited: true });
        return newRow;
      });
      return { ...t, headers: newHeaders, rows: newRows };
    }));
  }, [currentTable, selectedCell, selectedTable, tables]);

  // Delete a row
  const deleteRow = useCallback(() => {
    if (!currentTable || selectedCell === null || currentTable.rows.length <= 1) return;

    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newRows = t.rows.filter((_, i) => i !== selectedCell.row);
      return { ...t, rows: newRows };
    }));
    setSelectedCell(null);
  }, [currentTable, selectedCell, selectedTable, tables]);

  // Delete a column
  const deleteColumn = useCallback(() => {
    if (!currentTable || selectedCell === null || currentTable.headers.length <= 1) return;

    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newHeaders = t.headers.filter((_, i) => i !== selectedCell.col);
      const newRows = t.rows.map(row => row.filter((_, i) => i !== selectedCell.col));
      return { ...t, headers: newHeaders, rows: newRows };
    }));
    setSelectedCell(null);
  }, [currentTable, selectedCell, selectedTable, tables]);

  // Update cell value
  const updateCell = useCallback((rowIndex: number, colIndex: number, value: string) => {
    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newRows = t.rows.map((row, ri) => {
        if (ri !== rowIndex) return row;
        return row.map((cell, ci) => {
          if (ci !== colIndex) return cell;
          return {
            ...cell,
            value,
            isEdited: true,
            originalValue: cell.originalValue ?? cell.value
          };
        });
      });
      return { ...t, rows: newRows };
    }));
  }, [selectedTable, tables]);

  // Update header
  const updateHeader = useCallback((colIndex: number, value: string) => {
    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      const newHeaders = [...t.headers];
      newHeaders[colIndex] = value;
      return { ...t, headers: newHeaders };
    }));
  }, [selectedTable, tables]);

  // Update table title
  const updateTableTitle = useCallback((title: string) => {
    setTables(tables.map(t => {
      if (t.id !== selectedTable) return t;
      return { ...t, title };
    }));
  }, [selectedTable, tables]);

  // Delete table
  const deleteTable = useCallback(() => {
    if (!selectedTable) return;
    const newTables = tables.filter(t => t.id !== selectedTable);
    setTables(newTables);
    setSelectedTable(newTables.length > 0 ? newTables[0].id : null);
  }, [selectedTable, tables]);

  // Handle save
  const handleSave = () => {
    onSave(tables, pageNotes);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-app border border-default rounded-lg shadow-xl w-[90vw] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
          <div className="flex items-center gap-3">
            <Table size={20} className="text-accent" />
            <span className="text-[14px] font-medium text-primary">
              Table Annotation Editor - Page {pageNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-accent text-white rounded hover:bg-accent/90 transition-colors"
            >
              <FloppyDisk size={14} />
              Save as Training Data
            </button>
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted hover:text-primary transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar - Table list */}
          <div className="w-48 border-r border-default bg-app-secondary/50 flex flex-col">
            <div className="p-2 border-b border-default">
              <button
                onClick={addNewTable}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30 transition-colors"
              >
                <Plus size={14} />
                New Table
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {tables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => setSelectedTable(table.id)}
                  className={`w-full text-left px-3 py-2 rounded text-[12px] transition-colors ${
                    selectedTable === table.id
                      ? "bg-accent/20 text-accent"
                      : "text-muted hover:text-primary hover:bg-card-hover"
                  }`}
                >
                  <div className="font-medium truncate">{table.title || "Untitled"}</div>
                  <div className="text-[10px] opacity-70">
                    {table.rows.length} rows × {table.headers.length} cols
                    {table.isNew && " (new)"}
                  </div>
                </button>
              ))}
              {tables.length === 0 && (
                <div className="text-[11px] text-muted text-center py-4">
                  No tables yet.<br />Click "New Table" to create one.
                </div>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {currentTable ? (
              <>
                {/* Toolbar */}
                <div className="h-10 px-3 flex items-center gap-2 border-b border-default bg-app-secondary/30">
                  <input
                    type="text"
                    value={currentTable.title || ""}
                    onChange={(e) => updateTableTitle(e.target.value)}
                    className="h-7 px-2 bg-app border border-default rounded text-[13px] text-primary w-48 focus:outline-none focus:border-accent"
                    placeholder="Table title..."
                  />

                  <div className="h-5 w-px bg-default mx-2" />

                  {selectedCell !== null && (
                    <>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addRow('above')}
                          className="p-1.5 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
                          title="Add row above"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => addRow('below')}
                          className="p-1.5 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
                          title="Add row below"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <span className="text-[10px] text-muted mx-1">Row</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addColumn('left')}
                          className="p-1.5 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
                          title="Add column left"
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <button
                          onClick={() => addColumn('right')}
                          className="p-1.5 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
                          title="Add column right"
                        >
                          <ArrowRight size={14} />
                        </button>
                        <span className="text-[10px] text-muted mx-1">Col</span>
                      </div>

                      <div className="h-5 w-px bg-default mx-2" />

                      <button
                        onClick={deleteRow}
                        disabled={currentTable.rows.length <= 1}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30"
                      >
                        <Minus size={12} />
                        Row
                      </button>
                      <button
                        onClick={deleteColumn}
                        disabled={currentTable.headers.length <= 1}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30"
                      >
                        <Minus size={12} />
                        Col
                      </button>
                    </>
                  )}

                  <div className="flex-1" />

                  <button
                    onClick={deleteTable}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  >
                    <X size={12} />
                    Delete Table
                  </button>
                </div>

                {/* Table grid */}
                <div className="flex-1 overflow-auto p-4">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="w-8 p-1 text-[10px] text-muted font-normal">#</th>
                        {currentTable.headers.map((header, colIndex) => (
                          <th key={colIndex} className="min-w-[120px] p-0 border border-default bg-app-secondary">
                            <input
                              type="text"
                              value={header}
                              onChange={(e) => updateHeader(colIndex, e.target.value)}
                              className="w-full h-8 px-2 bg-transparent text-[12px] font-medium text-primary focus:outline-none focus:bg-accent/10"
                              placeholder={`Header ${colIndex + 1}`}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentTable.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <td className="p-1 text-[10px] text-muted text-center">{rowIndex + 1}</td>
                          {row.map((cell, colIndex) => (
                            <td
                              key={colIndex}
                              className={`p-0 border border-default ${
                                selectedCell?.row === rowIndex && selectedCell?.col === colIndex
                                  ? "ring-2 ring-accent ring-inset"
                                  : ""
                              } ${cell.isEdited ? "bg-yellow-500/10" : ""}`}
                              onClick={() => setSelectedCell({ row: rowIndex, col: colIndex })}
                            >
                              <input
                                type="text"
                                value={cell.value}
                                onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                                className="w-full h-8 px-2 bg-transparent text-[12px] text-primary focus:outline-none focus:bg-accent/5"
                                placeholder="..."
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table notes */}
                <div className="h-24 border-t border-default p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Note size={14} className="text-muted" />
                    <span className="text-[11px] font-medium text-muted">Table Notes</span>
                  </div>
                  <textarea
                    value={currentTable.notes || ""}
                    onChange={(e) => {
                      setTables(tables.map(t =>
                        t.id === selectedTable ? { ...t, notes: e.target.value } : t
                      ));
                    }}
                    className="w-full h-12 px-2 py-1 bg-app border border-default rounded text-[12px] text-primary resize-none focus:outline-none focus:border-accent"
                    placeholder="Add notes about this table (e.g., what was corrected, what's missing)..."
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted">
                <div className="text-center">
                  <Table size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-[13px]">No table selected</p>
                  <p className="text-[11px] mt-1">Create a new table or select one from the sidebar</p>
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar - Page notes */}
          <div className="w-64 border-l border-default bg-app-secondary/50 flex flex-col">
            <div className="h-10 px-3 flex items-center border-b border-default">
              <Note size={14} className="text-muted mr-2" />
              <span className="text-[12px] font-medium text-primary">Page Notes</span>
            </div>
            <div className="flex-1 p-3">
              <textarea
                value={pageNotes}
                onChange={(e) => setPageNotes(e.target.value)}
                className="w-full h-full px-3 py-2 bg-app border border-default rounded text-[12px] text-primary resize-none focus:outline-none focus:border-accent"
                placeholder="Notes for this page...

Examples:
- Missing allergen table
- Header row was extracted as data
- Values in column B are swapped with C
- This section needs manual review"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
