import React, { useState, useCallback } from 'react';
import { PencilSimple, Plus, X, Check, Trash } from '@phosphor-icons/react';
import type { ReconstructedTable, IndexedItem } from '../types';

// Helper to format checkbox values from Azure extraction
// Converts :selected: and :unselected: markers to visual checkboxes
const formatCheckboxValue = (value: string | undefined | null): React.ReactNode => {
  if (!value) return null;

  // Check if the value contains checkbox markers
  if (!value.includes(':selected:') && !value.includes(':unselected:')) {
    return value;
  }

  // Split the value into parts and render each with appropriate styling
  const parts = value.split(/(:selected:|:unselected:)/g).filter(Boolean);

  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap">
      {parts.map((part, i) => {
        if (part === ':selected:') {
          return (
            <span key={i} className="inline-flex items-center justify-center w-4 h-4 rounded border border-accent bg-accent/20 text-accent text-[10px] font-bold">
              ✓
            </span>
          );
        }
        if (part === ':unselected:') {
          return (
            <span key={i} className="inline-flex items-center justify-center w-4 h-4 rounded border border-muted/50 text-muted/30 text-[10px]">
              ○
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

interface TableEdit {
  rowIndex: number;
  column: string;
  value: string;
  itemId?: string;
}

interface NewRow {
  cells: { column: string; value: string; itemId?: string }[];
}

interface ReconstructedTableProps {
  table: ReconstructedTable;
  onItemSelect?: (itemId: string, multiSelect: boolean, shiftSelect: boolean) => void;
  selectedItems?: Set<string>;
  visionCorrectedIds?: Set<string>;
  reviewMode?: boolean;
  getReviewStatus?: (itemId: string) => "accepted" | "rejected" | undefined;
  onAccept?: (itemId: string) => void;
  onReject?: (itemId: string, reason?: string) => void;
  onCellRefClick?: (cellRef: string) => void;
  // Edit mode props
  unassignedItems?: IndexedItem[];
  onTableEdit?: (tableTitle: string, edits: { type: 'update' | 'add' | 'delete'; rowIndex?: number; cells?: { column: string; value: string; itemId?: string }[] }[]) => void;
}

export const ReconstructedTableComponent: React.FC<ReconstructedTableProps> = ({
  table,
  onItemSelect,
  selectedItems = new Set(),
  visionCorrectedIds = new Set(),
  reviewMode = false,
  getReviewStatus,
  onAccept,
  onReject,
  onCellRefClick,
  unassignedItems = [],
  onTableEdit
}) => {
  const [editMode, setEditMode] = useState(false);
  const [localEdits, setLocalEdits] = useState<Map<string, TableEdit>>(new Map());
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [showItemPool, setShowItemPool] = useState(false);

  const handleCellClick = (e: React.MouseEvent, itemId: string) => {
    if (editMode) return; // Don't select in edit mode
    if (onItemSelect) {
      e.stopPropagation();
      onItemSelect(itemId, e.metaKey || e.ctrlKey, e.shiftKey);
    }
  };

  const getCellStatus = (itemId: string) => {
    const isSelected = selectedItems.has(itemId);
    const isVisionCorrected = visionCorrectedIds.has(itemId);
    const reviewStatus = getReviewStatus?.(itemId);

    return { isSelected, isVisionCorrected, reviewStatus };
  };

  const handleCellDoubleClick = (rowIndex: number, column: string, currentValue: string) => {
    if (!editMode) return;
    setEditingCell({ rowIndex, column });
  };

  const handleCellEdit = (rowIndex: number, column: string, value: string, itemId?: string) => {
    const key = `${rowIndex}-${column}`;
    setLocalEdits(prev => {
      const next = new Map(prev);
      next.set(key, { rowIndex, column, value, itemId });
      return next;
    });
  };

  const getEditedValue = (rowIndex: number, column: string, originalValue: string): string => {
    const key = `${rowIndex}-${column}`;
    const edit = localEdits.get(key);
    return edit ? edit.value : originalValue;
  };

  const handleAddRow = () => {
    const newRow: NewRow = {
      cells: table.headers.map(header => ({ column: header, value: '' }))
    };
    setNewRows(prev => [...prev, newRow]);
  };

  const handleNewRowCellEdit = (newRowIndex: number, column: string, value: string) => {
    setNewRows(prev => {
      const next = [...prev];
      const row = next[newRowIndex];
      const cellIndex = row.cells.findIndex(c => c.column === column);
      if (cellIndex >= 0) {
        next[newRowIndex] = {
          ...row,
          cells: row.cells.map((c, i) => i === cellIndex ? { ...c, value } : c)
        };
      }
      return next;
    });
  };

  const handleDeleteRow = (rowIndex: number) => {
    setDeletedRows(prev => new Set([...prev, rowIndex]));
  };

  const handleDeleteNewRow = (newRowIndex: number) => {
    setNewRows(prev => prev.filter((_, i) => i !== newRowIndex));
  };

  const handleAddItemToRow = (item: IndexedItem, newRowIndex: number, column: string) => {
    setNewRows(prev => {
      const next = [...prev];
      const row = next[newRowIndex];
      const cellIndex = row.cells.findIndex(c => c.column === column);
      if (cellIndex >= 0) {
        next[newRowIndex] = {
          ...row,
          cells: row.cells.map((c, i) =>
            i === cellIndex ? { ...c, value: item.value || '', itemId: item.id } : c
          )
        };
      }
      return next;
    });
    setShowItemPool(false);
  };

  const handleSave = () => {
    if (!onTableEdit) return;

    const edits: { type: 'update' | 'add' | 'delete'; rowIndex?: number; cells?: { column: string; value: string; itemId?: string }[] }[] = [];

    // Add updates
    localEdits.forEach((edit, key) => {
      edits.push({
        type: 'update',
        rowIndex: edit.rowIndex,
        cells: [{ column: edit.column, value: edit.value, itemId: edit.itemId }]
      });
    });

    // Add deletions
    deletedRows.forEach(rowIndex => {
      edits.push({ type: 'delete', rowIndex });
    });

    // Add new rows
    newRows.forEach(row => {
      edits.push({ type: 'add', cells: row.cells });
    });

    onTableEdit(table.title, edits);

    // Reset state
    setEditMode(false);
    setLocalEdits(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setEditingCell(null);
  };

  const handleCancel = () => {
    setEditMode(false);
    setLocalEdits(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setEditingCell(null);
  };

  const visibleRows = table.rows.filter((_, idx) => !deletedRows.has(idx));

  return (
    <div className="bg-card border border-default rounded-lg overflow-hidden">
      {/* Table Header */}
      <div className="px-3 py-2 bg-app-secondary border-b border-default flex items-center justify-between">
        <div>
          <h4 className="text-[12px] font-medium text-primary">{table.title}</h4>
          <div className="text-[10px] text-muted mt-0.5">
            {visibleRows.length} row{visibleRows.length !== 1 ? 's' : ''} × {table.headers.length} column{table.headers.length !== 1 ? 's' : ''}
            {newRows.length > 0 && <span className="text-accent ml-1">+{newRows.length} new</span>}
            {deletedRows.size > 0 && <span className="text-red-400 ml-1">-{deletedRows.size} deleted</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-accent/20 text-accent hover:bg-accent/30 rounded transition-colors"
                title="Add new row"
              >
                <Plus size={12} weight="bold" />
                Add Row
              </button>
              <button
                onClick={() => setShowItemPool(!showItemPool)}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  showItemPool ? 'bg-blue-500/20 text-blue-400' : 'bg-muted/20 text-muted hover:bg-muted/30'
                }`}
                title="Show unassigned items"
              >
                {unassignedItems.length} items
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-muted/20 text-muted hover:bg-muted/30 rounded transition-colors"
              >
                <X size={12} weight="bold" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors"
              >
                <Check size={12} weight="bold" />
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] bg-muted/20 text-muted hover:bg-muted/30 rounded transition-colors"
              title="Edit table"
            >
              <PencilSimple size={12} />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Unassigned Items Pool (collapsible) */}
      {editMode && showItemPool && unassignedItems.length > 0 && (
        <div className="px-3 py-2 bg-blue-500/5 border-b border-blue-500/20 max-h-32 overflow-y-auto">
          <div className="text-[10px] text-blue-400 font-medium mb-1">
            Unassigned Items (drag to cells or click to add to new row)
          </div>
          <div className="flex flex-wrap gap-1">
            {unassignedItems.slice(0, 20).map((item, idx) => (
              <div
                key={item.id || idx}
                className="px-2 py-1 bg-blue-500/10 text-[10px] text-blue-300 rounded cursor-pointer hover:bg-blue-500/20 max-w-[200px] truncate"
                title={`${item.label}: ${item.value}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('itemId', item.id || '');
                  e.dataTransfer.setData('itemValue', item.value || '');
                }}
              >
                <span className="font-medium">{item.label?.slice(0, 30)}</span>
                {item.value && <span className="text-blue-400/70">: {item.value.slice(0, 20)}</span>}
              </div>
            ))}
            {unassignedItems.length > 20 && (
              <span className="text-[10px] text-blue-400/50">+{unassignedItems.length - 20} more</span>
            )}
          </div>
        </div>
      )}

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          {/* Table Headers */}
          <thead>
            <tr className="border-b border-default bg-app-secondary/50">
              <th className="text-left px-3 py-2 text-[10px] font-medium text-muted w-12">Row</th>
              {table.headers.map((header, index) => (
                <th key={index} className="text-left px-3 py-2 text-[10px] font-medium text-muted">
                  {header}
                </th>
              ))}
              {editMode && <th className="w-10"></th>}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody>
            {table.rows.map((row, rowIndex) => {
              if (deletedRows.has(rowIndex)) return null;

              return (
                <tr key={rowIndex} className={`border-b border-default/50 hover:bg-card-hover/50 transition-colors ${editMode ? 'group' : ''}`}>
                  {/* Row Number */}
                  <td className="px-3 py-2 text-muted font-mono text-[10px]">
                    {row.rowNumber}
                  </td>

                  {/* Table Cells */}
                  {table.headers.map((header, colIndex) => {
                    const cell = row.cells.find(c => c.column === header);
                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.column === header;
                    const editedValue = cell ? getEditedValue(rowIndex, header, cell.value) : '';

                    if (!cell) {
                      return (
                        <td
                          key={colIndex}
                          className={`px-3 py-2 text-muted italic ${editMode ? 'cursor-text hover:bg-accent/5' : ''}`}
                          onDoubleClick={() => editMode && handleCellDoubleClick(rowIndex, header, '')}
                          onDrop={(e) => {
                            if (!editMode) return;
                            e.preventDefault();
                            const itemId = e.dataTransfer.getData('itemId');
                            const itemValue = e.dataTransfer.getData('itemValue');
                            if (itemValue) {
                              handleCellEdit(rowIndex, header, itemValue, itemId);
                            }
                          }}
                          onDragOver={(e) => editMode && e.preventDefault()}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              className="w-full bg-transparent border-b border-accent outline-none text-primary"
                              value={editedValue}
                              onChange={(e) => handleCellEdit(rowIndex, header, e.target.value)}
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                            />
                          ) : editedValue ? (
                            <span className="text-primary">{formatCheckboxValue(editedValue)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    }

                    const { isSelected, isVisionCorrected, reviewStatus } = getCellStatus(cell.itemId);

                    return (
                      <td
                        key={colIndex}
                        className={`px-3 py-2 transition-colors relative ${
                          editMode ? 'cursor-text' : 'cursor-pointer'
                        } ${
                          isSelected && !editMode ? 'bg-accent/10 ring-1 ring-accent/20' : 'hover:bg-card-hover'
                        } ${
                          reviewStatus === 'accepted' ? 'border-l-2 border-l-green-500' :
                          reviewStatus === 'rejected' ? 'border-l-2 border-l-red-500' : ''
                        }`}
                        onClick={(e) => !editMode && handleCellClick(e, cell.itemId)}
                        onDoubleClick={() => editMode && handleCellDoubleClick(rowIndex, header, cell.value)}
                        onDrop={(e) => {
                          if (!editMode) return;
                          e.preventDefault();
                          const itemId = e.dataTransfer.getData('itemId');
                          const itemValue = e.dataTransfer.getData('itemValue');
                          if (itemValue) {
                            handleCellEdit(rowIndex, header, itemValue, itemId);
                          }
                        }}
                        onDragOver={(e) => editMode && e.preventDefault()}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            className="w-full bg-transparent border-b border-accent outline-none text-primary"
                            value={editedValue}
                            onChange={(e) => handleCellEdit(rowIndex, header, e.target.value, cell.itemId)}
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                          />
                        ) : (
                          <>
                            {/* Cell Content */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <span className={`text-[12px] ${editedValue ? 'text-primary' : 'text-muted italic'} block`}>
                                  {editedValue ? formatCheckboxValue(editedValue) : '(empty)'}
                                </span>
                                {cell.cellRef && onCellRefClick && !editMode && (
                                  <button
                                    className="text-[10px] text-accent hover:text-accent-hover font-mono mt-0.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCellRefClick(cell.cellRef!);
                                    }}
                                    title="Go to original cell"
                                  >
                                    {cell.cellRef}
                                  </button>
                                )}
                              </div>

                              {/* Cell Indicators */}
                              {!editMode && (
                                <div className="flex items-center gap-1">
                                  {isVisionCorrected && (
                                    <span className="inline-block w-1.5 h-1.5 bg-orange-500 rounded-full" title="Corrected by Vision" />
                                  )}

                                  {/* Cell Type Badge */}
                                  {cell.type !== 'field' && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-muted/10 text-muted rounded font-mono">
                                      {cell.type}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Review Controls (if in review mode) */}
                            {reviewMode && !editMode && onAccept && onReject && (
                              <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {reviewStatus !== 'accepted' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onAccept(cell.itemId); }}
                                    className="w-4 h-4 bg-green-500 text-white rounded-full text-[8px] hover:bg-green-600 transition-colors"
                                    title="Accept"
                                  >
                                    ✓
                                  </button>
                                )}
                                {reviewStatus !== 'rejected' && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onReject(cell.itemId); }}
                                    className="w-4 h-4 bg-red-500 text-white rounded-full text-[8px] hover:bg-red-600 transition-colors"
                                    title="Reject"
                                  >
                                    ✗
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}

                  {/* Delete row button */}
                  {editMode && (
                    <td className="px-2">
                      <button
                        onClick={() => handleDeleteRow(rowIndex)}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete row"
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}

            {/* New rows */}
            {editMode && newRows.map((newRow, newRowIndex) => (
              <tr key={`new-${newRowIndex}`} className="border-b border-default/50 bg-accent/5 group">
                <td className="px-3 py-2 text-accent font-mono text-[10px]">
                  new
                </td>
                {table.headers.map((header, colIndex) => {
                  const cell = newRow.cells.find(c => c.column === header);
                  return (
                    <td
                      key={colIndex}
                      className="px-3 py-2 cursor-text hover:bg-accent/10"
                      onDrop={(e) => {
                        e.preventDefault();
                        const itemId = e.dataTransfer.getData('itemId');
                        const itemValue = e.dataTransfer.getData('itemValue');
                        if (itemValue) {
                          handleNewRowCellEdit(newRowIndex, header, itemValue);
                        }
                      }}
                      onDragOver={(e) => e.preventDefault()}
                    >
                      <input
                        type="text"
                        className="w-full bg-transparent border-b border-accent/30 focus:border-accent outline-none text-primary placeholder:text-muted/50 text-[12px]"
                        value={cell?.value || ''}
                        onChange={(e) => handleNewRowCellEdit(newRowIndex, header, e.target.value)}
                        placeholder={`Enter ${header}...`}
                      />
                    </td>
                  );
                })}
                <td className="px-2">
                  <button
                    onClick={() => handleDeleteNewRow(newRowIndex)}
                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove new row"
                  >
                    <Trash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Table Footer */}
      <div className="px-3 py-2 bg-app-secondary/30 border-t border-default text-[10px] text-muted flex justify-between">
        <span>Source items: {table.sourceItems.length} cells</span>
        {editMode && (localEdits.size > 0 || newRows.length > 0 || deletedRows.size > 0) && (
          <span className="text-amber-400">
            {localEdits.size} edit{localEdits.size !== 1 ? 's' : ''},
            {newRows.length} new,
            {deletedRows.size} deleted
          </span>
        )}
      </div>
    </div>
  );
};

export default ReconstructedTableComponent;
