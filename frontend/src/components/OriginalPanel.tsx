import { useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { File, GridFour, PencilSimpleLine, PencilSimple, Plus, X, Check, Trash, SplitHorizontal, FloppyDisk, Code } from '@phosphor-icons/react';
import type { ExcelSheet, IndexedSection, IndexedItem, VisionExtractionData, VisionQAPair, ExtractionView } from '../types';
import { TableAnnotationEditor, type AnnotatedTable } from './TableAnnotationEditor';
import { saveStructure } from '../api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Set the worker source for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ViewTab = 'file' | 'view' | 'split' | 'markdown';

interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
}

// Table edit operations
interface TableEditOp {
  type: 'update' | 'add' | 'delete';
  sectionIndex: number;
  tableIndex: number;
  rowIndex?: number;
  colIndex?: number;
  value?: string;
  newRow?: Record<string, string>;
}

// Processed section type for split view editing
interface ProcessedSection {
  title: string;
  type: string;
  rows: Array<{
    row: number;
    cells: Record<string, { ref?: string; value?: string; filled?: boolean; type?: string; role?: string; pageNumber?: number }>;
    isEmpty?: boolean;
    rowType?: string;
    sectionTitle?: string;
  }>;
  pageLabel?: string;
  textContent: {
    paragraphs: Array<{ content: string }>;
    markdown?: string;
  };
}

interface OriginalPanelProps {
  visible: boolean;
  sheet?: ExcelSheet;
  sections?: IndexedSection[];
  indexedSections?: IndexedSection[]; // Indexed data for unassigned items pool
  textContent?: {
    markdown?: string;
    paragraphs?: Array<{
      content: string;
      pageNumber?: number;
      boundingBox?: number[];
    }>;
    lines?: Array<{
      content: string;
      pageNumber?: number;
      boundingBox?: number[];
    }>;
    keyValuePairs?: Array<{
      key: string;
      value: string;
      pageNumber?: number;
    }>;
  };
  activeCell?: string | null;
  onCellClick?: (cellRef: string, row: number, col: string, pageNumber?: number) => void;
  questionnaireId?: string;
  pages?: PageInfo[];
  onSaveAnnotation?: (pageNumber: number, tables: AnnotatedTable[], notes: string) => void;
  onTableEdit?: (sectionIndex: number, tableIndex: number, edits: TableEditOp[]) => void;
  /** Vision extraction from two-pass Claude Vision pipeline */
  visionExtraction?: VisionExtractionData;
  /** Current extraction view mode - used to hide bounding box controls in vision mode */
  extractionView?: ExtractionView;
}

export interface OriginalPanelHandle {
  scrollToCell: (cellRef: string) => void;
  navigateToPage: (pageNumber: number) => void;
}

function OriginalPanelInner(
  { visible, sheet, sections: _sections, indexedSections, textContent, activeCell, onCellClick, questionnaireId, pages: _pages, onSaveAnnotation, onTableEdit, visionExtraction, extractionView }: OriginalPanelProps,
  ref: React.ForwardedRef<OriginalPanelHandle>
) {
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

  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [expandedVisionSections, setExpandedVisionSections] = useState<Set<number>>(new Set());
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const [showAnnotationEditor, setShowAnnotationEditor] = useState(false);

  // Tab state - declared early as it's used by other hooks
  const [activeTab, setActiveTab] = useState<ViewTab>('view');
  const activeTabRef = useRef<ViewTab>(activeTab);
  activeTabRef.current = activeTab;

  // Switch away from hidden tabs when in Vision mode
  useEffect(() => {
    if (extractionView === 'vision' && (activeTab === 'view' || activeTab === 'split')) {
      // In Vision mode, 'view' and 'split' tabs are hidden - switch to 'markdown' if available, else 'file'
      setActiveTab(visionExtraction ? 'markdown' : 'file');
    }
  }, [extractionView, activeTab, visionExtraction]);

  // Table editing state
  const [editingTable, setEditingTable] = useState<{ sectionIndex: number; tableIndex: number } | null>(null);
  const [tableEdits, setTableEdits] = useState<Map<string, Record<string, string>>>(new Map()); // key: "rowIdx-colIdx", value: edited value
  const [newRows, setNewRows] = useState<Record<string, string>[]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [showItemPool, setShowItemPool] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Split view editing state
  const [selectedTableCells, setSelectedTableCells] = useState<Set<string>>(new Set()); // "sectionIdx-rowIdx-col"
  const [selectedPdfElements, setSelectedPdfElements] = useState<Set<string>>(new Set()); // cell refs like "A1", "B2"
  const [lastSelectedCell, setLastSelectedCell] = useState<string | null>(null);

  // PDF region selection for manual annotation
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);
  const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
  const [regionEnd, setRegionEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawnRegions, setDrawnRegions] = useState<Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pageNumber: number;
    text?: string;
  }>>([]);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [regionDrawMode, setRegionDrawMode] = useState(false);

  // Version history for undo/redo
  interface EditAction {
    type: 'delete_rows' | 'add_rows' | 'edit_cell' | 'add_from_pdf';
    data: any;
    timestamp: number;
  }
  const [editHistory, setEditHistory] = useState<EditAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Local table data for split view editing (mutable copy of processedSections)
  const [localTableData, setLocalTableData] = useState<ProcessedSection[] | null>(null);

  // Split view save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // New table creation state - auto-show when PDF elements are selected
  const [showInsertionZones, setShowInsertionZones] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  // Markdown view mode: 'rendered' (with tables) or 'raw' (preformatted text)
  const [markdownViewMode, setMarkdownViewMode] = useState<'rendered' | 'raw'>('rendered');

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Auto-show insertion zones when PDF elements are selected
  useEffect(() => {
    if (activeTab === 'split' && selectedPdfElements.size > 0) {
      setShowInsertionZones(true);
    } else if (selectedPdfElements.size === 0) {
      setShowInsertionZones(false);
    }
  }, [activeTab, selectedPdfElements.size]);

  // Check if there are unsaved changes in split view
  const hasUnsavedChanges = useMemo(() => {
    return historyIndex >= 0; // If we have any history, there are changes
  }, [historyIndex]);

  // Save split view changes to the backend
  const handleSaveSplitViewChanges = useCallback(async () => {
    if (!localTableData || !sheet || !questionnaireId) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      // Reconstruct sheet.rows from localTableData sections
      const newRows: typeof sheet.rows = [];

      for (const section of localTableData) {
        for (const row of section.rows) {
          newRows.push({
            row: row.row,
            cells: row.cells,
            isEmpty: row.isEmpty,
            rowType: row.rowType,
            sectionTitle: row.sectionTitle,
          });
        }
      }

      // Create updated sheet with new rows
      const updatedSheet = {
        ...sheet,
        rows: newRows,
      };

      // Save to backend
      await saveStructure(questionnaireId, updatedSheet);

      // Clear history after successful save
      setEditHistory([]);
      setHistoryIndex(-1);

      console.log('Structure saved successfully');
      setToast({ message: 'Structure saved successfully', type: 'success' });
    } catch (error) {
      console.error('Failed to save structure:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save';
      setSaveError(errorMsg);
      setToast({ message: `Save failed: ${errorMsg}`, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [localTableData, sheet, questionnaireId]);

  // Get unassigned items from indexed sections (items not clearly mapped to current table)
  const unassignedItems = useMemo((): IndexedItem[] => {
    if (!indexedSections) return [];
    const items: IndexedItem[] = [];
    indexedSections.forEach(section => {
      section.items.forEach(item => {
        // Items without clear cell references are "unassigned"
        if (!item.lCell && !item.vCell) {
          items.push(item);
        }
      });
    });
    return items;
  }, [indexedSections]);

  // Table editing handlers
  const startEditingTable = useCallback((sectionIndex: number, tableIndex: number) => {
    setEditingTable({ sectionIndex, tableIndex });
    setTableEdits(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setEditingCell(null);
  }, []);

  const cancelEditingTable = useCallback(() => {
    setEditingTable(null);
    setTableEdits(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setEditingCell(null);
    setShowItemPool(false);
  }, []);

  const handleCellEdit = useCallback((rowIndex: number, colKey: string, value: string) => {
    const key = `${rowIndex}-${colKey}`;
    setTableEdits(prev => {
      const next = new Map(prev);
      const existing = next.get(key) || {};
      next.set(key, { ...existing, [colKey]: value });
      return next;
    });
  }, []);

  const getEditedCellValue = useCallback((rowIndex: number, colKey: string, originalValue: string): string => {
    const key = `${rowIndex}-${colKey}`;
    const edit = tableEdits.get(key);
    return edit?.[colKey] ?? originalValue;
  }, [tableEdits]);

  const handleAddRow = useCallback((columns: string[]) => {
    const newRow: Record<string, string> = {};
    columns.forEach(col => { newRow[col] = ''; });
    setNewRows(prev => [...prev, newRow]);
  }, []);

  const handleNewRowCellEdit = useCallback((newRowIndex: number, colKey: string, value: string) => {
    setNewRows(prev => {
      const next = [...prev];
      next[newRowIndex] = { ...next[newRowIndex], [colKey]: value };
      return next;
    });
  }, []);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    setDeletedRows(prev => new Set([...prev, rowIndex]));
  }, []);

  const handleDeleteNewRow = useCallback((newRowIndex: number) => {
    setNewRows(prev => prev.filter((_, i) => i !== newRowIndex));
  }, []);

  const handleAddItemToCell = useCallback((item: IndexedItem, rowIndex: number, colKey: string, isNewRow: boolean) => {
    const value = item.value || item.label || '';
    if (isNewRow) {
      handleNewRowCellEdit(rowIndex, colKey, value);
    } else {
      handleCellEdit(rowIndex, colKey, value);
    }
    setShowItemPool(false);
  }, [handleCellEdit, handleNewRowCellEdit]);

  const handleSaveTableEdits = useCallback((sectionIndex: number, tableIndex: number) => {
    if (!onTableEdit) return;

    const edits: TableEditOp[] = [];

    // Collect cell updates
    tableEdits.forEach((editData, key) => {
      const [rowIndexStr, colKey] = key.split('-');
      const rowIndex = parseInt(rowIndexStr, 10);
      edits.push({
        type: 'update',
        sectionIndex,
        tableIndex,
        rowIndex,
        value: editData[colKey],
      });
    });

    // Collect deletions
    deletedRows.forEach(rowIndex => {
      edits.push({
        type: 'delete',
        sectionIndex,
        tableIndex,
        rowIndex,
      });
    });

    // Collect new rows
    newRows.forEach(newRow => {
      edits.push({
        type: 'add',
        sectionIndex,
        tableIndex,
        newRow,
      });
    });

    onTableEdit(sectionIndex, tableIndex, edits);
    cancelEditingTable();
  }, [onTableEdit, tableEdits, deletedRows, newRows, cancelEditingTable]);

  // ===== SPLIT VIEW EDITING HANDLERS =====

  // Handle table cell selection (multi-select with shift/cmd)
  const handleTableCellSelect = useCallback((cellKey: string, event: React.MouseEvent, allCellKeys?: string[]) => {
    // Clear section selection when selecting cells
    setSelectedSectionIndex(null);

    setSelectedTableCells(prev => {
      const next = new Set(prev);

      if (event.metaKey || event.ctrlKey) {
        // Toggle selection
        if (next.has(cellKey)) {
          next.delete(cellKey);
        } else {
          next.add(cellKey);
        }
      } else if (event.shiftKey && lastSelectedCell && allCellKeys) {
        // Range selection - select all cells between lastSelectedCell and current
        const lastIdx = allCellKeys.indexOf(lastSelectedCell);
        const currentIdx = allCellKeys.indexOf(cellKey);

        if (lastIdx !== -1 && currentIdx !== -1) {
          const startIdx = Math.min(lastIdx, currentIdx);
          const endIdx = Math.max(lastIdx, currentIdx);

          // Add all cells in range
          for (let i = startIdx; i <= endIdx; i++) {
            next.add(allCellKeys[i]);
          }
        } else {
          next.add(cellKey);
        }
      } else {
        // Single select - clear others
        next.clear();
        next.add(cellKey);
      }

      return next;
    });
    setLastSelectedCell(cellKey);
  }, [lastSelectedCell]);

  // Handle PDF element selection
  const handlePdfElementSelect = useCallback((ref: string, event: React.MouseEvent) => {
    setSelectedPdfElements(prev => {
      const next = new Set(prev);

      if (event.metaKey || event.ctrlKey) {
        if (next.has(ref)) {
          next.delete(ref);
        } else {
          next.add(ref);
        }
      } else {
        next.clear();
        next.add(ref);
      }

      return next;
    });
  }, []);

  // Push action to history (for undo/redo)
  const pushToHistory = useCallback((action: EditAction) => {
    setEditHistory(prev => {
      // Remove any future history if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(action);
      return newHistory;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Delete selected rows from table
  const handleDeleteSelectedRows = useCallback(() => {
    if (selectedTableCells.size === 0 || !localTableData) return;

    // Group selected cells by section and row
    const rowsToDelete = new Map<number, Set<number>>(); // sectionIdx -> rowIndices
    selectedTableCells.forEach(cellKey => {
      const [sectionIdx, rowIdx] = cellKey.split('-').map(Number);
      if (!rowsToDelete.has(sectionIdx)) {
        rowsToDelete.set(sectionIdx, new Set());
      }
      rowsToDelete.get(sectionIdx)!.add(rowIdx);
    });

    // Save to history before modifying
    pushToHistory({
      type: 'delete_rows',
      data: { rowsToDelete: Array.from(rowsToDelete.entries()), previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Create new data with rows removed
    const newData = localTableData.map((section, sectionIdx) => {
      const rowIndicesToDelete = rowsToDelete.get(sectionIdx);
      if (!rowIndicesToDelete) return section;

      return {
        ...section,
        rows: section.rows.filter((_, rowIdx) => !rowIndicesToDelete.has(rowIdx))
      };
    });

    setLocalTableData(newData);
    setSelectedTableCells(new Set());
  }, [selectedTableCells, localTableData, pushToHistory]);

  // Add selected PDF elements to table
  // If table cells are selected, inserts BEFORE the first selected row
  // Otherwise, adds at the end of the first section
  const handleAddPdfElementsToTable = useCallback(() => {
    if (selectedPdfElements.size === 0 || !localTableData || !sheet) return;

    // Find the cell data for selected refs
    const elementsToAdd: Array<{ ref: string; value: string; pageNumber?: number }> = [];
    for (const row of sheet.rows || []) {
      for (const [_col, cell] of Object.entries(row.cells || {})) {
        const c = cell as any;
        if (selectedPdfElements.has(c.ref)) {
          elementsToAdd.push({
            ref: c.ref,
            value: c.value || '',
            pageNumber: c.pageNumber
          });
        }
      }
    }

    if (elementsToAdd.length === 0) return;

    // Determine insertion point from selected table cells
    let targetSectionIdx = 0;
    let targetRowIdx = -1; // -1 means append at end

    if (selectedTableCells.size > 0) {
      // Find the first selected cell to determine insertion point
      const firstSelectedCell = Array.from(selectedTableCells).sort()[0];
      const [sectionIdx, rowIdx] = firstSelectedCell.split('-').map(Number);
      targetSectionIdx = sectionIdx;
      targetRowIdx = rowIdx;
    }

    // Save to history
    pushToHistory({
      type: 'add_from_pdf',
      data: { elements: elementsToAdd, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Create new rows from PDF elements
    const newRows = elementsToAdd.map(el => ({
      row: 0, // Will be renumbered
      cells: {
        'A': { ref: el.ref, value: el.value, filled: true, type: 'string' as const },
      },
      isEmpty: false,
      rowType: 'data' as const
    }));

    // Insert into the target section
    const newData = [...localTableData];
    if (newData.length > targetSectionIdx) {
      const section = { ...newData[targetSectionIdx] };

      if (targetRowIdx >= 0 && targetRowIdx < section.rows.length) {
        // Insert before the selected row
        section.rows = [
          ...section.rows.slice(0, targetRowIdx),
          ...newRows,
          ...section.rows.slice(targetRowIdx)
        ];
      } else {
        // Append at end
        section.rows = [...section.rows, ...newRows];
      }

      newData[targetSectionIdx] = section;
    }

    setLocalTableData(newData);
    setSelectedPdfElements(new Set());
    setSelectedTableCells(new Set());
  }, [selectedPdfElements, selectedTableCells, localTableData, sheet, pushToHistory]);

  // State for inline cell editing in split view
  const [editingSplitCell, setEditingSplitCell] = useState<{ sectionIdx: number; rowIdx: number; col: string } | null>(null);
  const [editingSplitCellValue, setEditingSplitCellValue] = useState('');

  // State for editing section titles
  const [editingSectionTitle, setEditingSectionTitle] = useState<number | null>(null);
  const [editingSectionTitleValue, setEditingSectionTitleValue] = useState('');

  // State for selected section (for deletion)
  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);

  // Update section title
  const handleUpdateSectionTitle = useCallback((sectionIdx: number, newTitle: string) => {
    if (!localTableData) return;

    pushToHistory({
      type: 'edit_cell',
      data: { sectionIdx, field: 'title', previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    const newData = [...localTableData];
    newData[sectionIdx] = { ...newData[sectionIdx], title: newTitle };
    setLocalTableData(newData);
    setEditingSectionTitle(null);
    setEditingSectionTitleValue('');
  }, [localTableData, pushToHistory]);

  // Delete an entire section
  const handleDeleteSection = useCallback((sectionIdx: number) => {
    if (!localTableData || sectionIdx < 0 || sectionIdx >= localTableData.length) return;

    // Save to history
    pushToHistory({
      type: 'delete_rows',
      data: { sectionIdx, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Remove the section
    const newData = localTableData.filter((_, idx) => idx !== sectionIdx);
    setLocalTableData(newData);
    setSelectedSectionIndex(null);
    setToast({ message: 'Section deleted', type: 'success' });
  }, [localTableData, pushToHistory]);

  // Move a row within a section (up or down)
  const handleMoveRow = useCallback((sectionIdx: number, rowIdx: number, direction: 'up' | 'down') => {
    if (!localTableData) return;

    const section = localTableData[sectionIdx];
    if (!section.rows) return;

    const newRowIdx = direction === 'up' ? rowIdx - 1 : rowIdx + 1;
    if (newRowIdx < 0 || newRowIdx >= section.rows.length) return;

    pushToHistory({
      type: 'edit_cell',
      data: { sectionIdx, rowIdx, direction, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    const newData = [...localTableData];
    const newSection = { ...newData[sectionIdx] };
    const newRows = [...newSection.rows];

    // Swap rows
    [newRows[rowIdx], newRows[newRowIdx]] = [newRows[newRowIdx], newRows[rowIdx]];

    newSection.rows = newRows;
    newData[sectionIdx] = newSection;
    setLocalTableData(newData);
  }, [localTableData, pushToHistory]);

  // Add a row at a specific position in a section (using selected PDF elements or empty)
  const handleAddRowToSection = useCallback((sectionIdx: number, insertAtRowIdx: number, position: 'above' | 'below') => {
    if (!localTableData) return;

    const actualInsertIdx = position === 'above' ? insertAtRowIdx : insertAtRowIdx + 1;

    // Get elements to add from selected PDF elements (if any)
    const elementsToAdd: Array<{ ref: string; value: string; pageNumber?: number }> = [];

    if (selectedPdfElements.size > 0) {
      // Search in table cells
      if (sheet) {
        for (const row of sheet.rows || []) {
          for (const [_col, cell] of Object.entries(row.cells || {})) {
            const c = cell as any;
            if (selectedPdfElements.has(c.ref)) {
              elementsToAdd.push({ ref: c.ref, value: c.value || '', pageNumber: c.pageNumber });
            }
          }
        }
      }

      // Search in paragraphs
      if (textContent?.paragraphs) {
        textContent.paragraphs.forEach((p, idx) => {
          const ref = `P${idx + 1}`;
          if (selectedPdfElements.has(ref)) {
            elementsToAdd.push({ ref, value: p.content || '', pageNumber: p.pageNumber });
          }
        });
      }

      // Search in lines
      if (textContent?.lines) {
        textContent.lines.forEach((line, idx) => {
          const ref = `L${idx + 1}`;
          if (selectedPdfElements.has(ref)) {
            elementsToAdd.push({ ref, value: line.content || '', pageNumber: line.pageNumber });
          }
        });
      }
    }

    // Save to history
    pushToHistory({
      type: 'add_rows',
      data: { sectionIdx, insertAtRowIdx: actualInsertIdx, elements: elementsToAdd, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Create new rows - either from PDF elements or empty Q&A row
    const section = localTableData[sectionIdx];
    const columns = section.rows.length > 0
      ? Object.keys(section.rows[0].cells || {}).sort()
      : ['A', 'B'];

    let newRows: ProcessedSection['rows'];

    if (elementsToAdd.length > 0) {
      // Create rows from PDF elements (pair as Q&A if possible)
      newRows = [];
      for (let i = 0; i < elementsToAdd.length; i += 2) {
        const question = elementsToAdd[i];
        const answer = elementsToAdd[i + 1];
        newRows.push({
          row: 0,
          cells: {
            [columns[0] || 'A']: { ref: question.ref, value: question.value, filled: true, type: 'string' as const, role: 'label' as const, pageNumber: question.pageNumber },
            [columns[1] || 'B']: { ref: answer?.ref || '', value: answer?.value || '', filled: !!answer, type: 'string' as const, role: 'value' as const, pageNumber: answer?.pageNumber },
          },
          isEmpty: false,
          rowType: 'data' as const
        });
      }
    } else {
      // Create empty row for manual input
      const emptyCells: Record<string, any> = {};
      columns.forEach((col, idx) => {
        emptyCells[col] = { ref: '', value: '', filled: false, type: 'string' as const, role: idx === 0 ? 'label' : 'value' };
      });
      newRows = [{
        row: 0,
        cells: emptyCells,
        isEmpty: false,
        rowType: 'data' as const
      }];
    }

    // Insert into section
    const newData = [...localTableData];
    const newSection = { ...newData[sectionIdx] };
    newSection.rows = [
      ...newSection.rows.slice(0, actualInsertIdx),
      ...newRows,
      ...newSection.rows.slice(actualInsertIdx)
    ];
    newData[sectionIdx] = newSection;

    setLocalTableData(newData);
    setSelectedPdfElements(new Set());
    setToast({ message: `Added ${newRows.length} row${newRows.length > 1 ? 's' : ''}`, type: 'success' });
  }, [localTableData, selectedPdfElements, sheet, textContent, pushToHistory]);

  // Update a cell value in split view (either from PDF selection or manual input)
  // Note: negative rowIdx values indicate header rows (-1 = first header, -2 = second header, etc.)
  // Positive rowIdx values are the actual index in section.rows (not relative data row index)
  const handleUpdateSplitCell = useCallback((sectionIdx: number, rowIdx: number, col: string, value: string, ref?: string, pageNumber?: number) => {
    if (!localTableData) return;

    // Save to history
    pushToHistory({
      type: 'edit_cell',
      data: { sectionIdx, rowIdx, col, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    const newData = [...localTableData];
    const newSection = { ...newData[sectionIdx] };
    const newRows = [...newSection.rows];

    // Handle header rows (negative indices) vs data rows (positive = actual section.rows index)
    let actualRowIdx: number;
    if (rowIdx < 0) {
      // Find header rows and get the one at the negative index
      const headerRowIndices: number[] = [];
      newRows.forEach((r, idx) => {
        if (r.rowType === 'header') headerRowIndices.push(idx);
      });
      const headerIdx = Math.abs(rowIdx) - 1; // -1 -> 0, -2 -> 1, etc.
      actualRowIdx = headerRowIndices[headerIdx];
      if (actualRowIdx === undefined) {
        console.error('Header row not found for index', rowIdx);
        return;
      }
    } else {
      // Data rows - rowIdx is now the actual index in section.rows
      actualRowIdx = rowIdx;
      if (actualRowIdx >= newRows.length) {
        console.error('Row index out of bounds', rowIdx, 'max:', newRows.length - 1);
        return;
      }
    }

    const newRow = { ...newRows[actualRowIdx] };
    const newCells = { ...newRow.cells };

    newCells[col] = {
      ...newCells[col],
      value,
      filled: value.length > 0,
      ref: ref || newCells[col]?.ref || '',
      pageNumber: pageNumber || newCells[col]?.pageNumber,
    };

    newRow.cells = newCells;
    newRows[actualRowIdx] = newRow;
    newSection.rows = newRows;
    newData[sectionIdx] = newSection;

    setLocalTableData(newData);
    setEditingSplitCell(null);
    setEditingSplitCellValue('');
  }, [localTableData, pushToHistory]);

  // Apply selected PDF element to a cell
  const handleApplyPdfToCell = useCallback((sectionIdx: number, rowIdx: number, col: string) => {
    if (selectedPdfElements.size === 0) return;

    // Get first selected element
    const firstRef = Array.from(selectedPdfElements)[0];
    let elementData: { value: string; ref: string; pageNumber?: number } | null = null;

    // Search in table cells
    if (sheet) {
      for (const row of sheet.rows || []) {
        for (const cell of Object.values(row.cells || {})) {
          const c = cell as any;
          if (c.ref === firstRef) {
            elementData = { value: c.value || '', ref: c.ref, pageNumber: c.pageNumber };
            break;
          }
        }
        if (elementData) break;
      }
    }

    // Search in paragraphs
    if (!elementData && textContent?.paragraphs) {
      textContent.paragraphs.forEach((p, idx) => {
        const ref = `P${idx + 1}`;
        if (ref === firstRef) {
          elementData = { value: p.content || '', ref, pageNumber: p.pageNumber };
        }
      });
    }

    // Search in lines
    if (!elementData && textContent?.lines) {
      textContent.lines.forEach((line, idx) => {
        const ref = `L${idx + 1}`;
        if (ref === firstRef) {
          elementData = { value: line.content || '', ref, pageNumber: line.pageNumber };
        }
      });
    }

    if (elementData) {
      handleUpdateSplitCell(sectionIdx, rowIdx, col, elementData.value, elementData.ref, elementData.pageNumber);
      setSelectedPdfElements(new Set());
      setToast({ message: 'Cell updated from PDF', type: 'success' });
    }
  }, [selectedPdfElements, sheet, textContent, handleUpdateSplitCell]);

  // Undo last action
  const handleUndo = useCallback(() => {
    if (historyIndex < 0) return;

    const action = editHistory[historyIndex];
    if (action && action.data.previousData) {
      setLocalTableData(JSON.parse(JSON.stringify(action.data.previousData)));
    }
    setHistoryIndex(prev => prev - 1);
  }, [historyIndex, editHistory]);

  // Redo last undone action
  const handleRedo = useCallback(() => {
    if (historyIndex >= editHistory.length - 1) return;

    const nextAction = editHistory[historyIndex + 1];
    // Re-apply the action
    if (nextAction.type === 'delete_rows' && localTableData) {
      const rowsToDelete = new Map(nextAction.data.rowsToDelete);
      const newData = localTableData.map((section, sectionIdx) => {
        const rowIndicesToDelete = rowsToDelete.get(sectionIdx) as Set<number> | undefined;
        if (!rowIndicesToDelete) return section;
        return {
          ...section,
          rows: section.rows.filter((_, rowIdx) => !rowIndicesToDelete.has(rowIdx))
        };
      });
      setLocalTableData(newData);
    }
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex, editHistory, localTableData]);

  // Keyboard shortcuts for undo/redo and arrow navigation
  useEffect(() => {
    if (activeTab !== 'split') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when editing a cell or input is focused
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        e.preventDefault();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        handleRedo();
        e.preventDefault();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected section first (takes priority)
        if (selectedSectionIndex !== null) {
          handleDeleteSection(selectedSectionIndex);
          e.preventDefault();
          return;
        }
        // Otherwise delete selected rows
        if (selectedTableCells.size > 0) {
          handleDeleteSelectedRows();
          e.preventDefault();
        }
      }
      // Escape to deselect section or cells
      if (e.key === 'Escape') {
        if (selectedSectionIndex !== null) {
          setSelectedSectionIndex(null);
          e.preventDefault();
        } else if (selectedTableCells.size > 0) {
          setSelectedTableCells(new Set());
          e.preventDefault();
        }
      }

      // Arrow key navigation through table cells
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedTableCells.size === 1) {
        const currentCellKey = Array.from(selectedTableCells)[0];
        const match = currentCellKey.match(/^(\d+)-(\d+)-([A-Z]+)$/);
        if (!match) return;

        const [, sectionIdxStr, rowIdxStr, col] = match;
        const sectionIdx = parseInt(sectionIdxStr, 10);
        const rowIdx = parseInt(rowIdxStr, 10);
        // In split view, localTableData is always set (copied from processedSections when entering split)
        if (!localTableData) return;
        const section = localTableData[sectionIdx];
        if (!section) return;

        // Get columns for this section
        const allColumns = new Set<string>();
        section.rows?.forEach(row => {
          Object.keys(row.cells || {}).forEach(c => allColumns.add(c));
        });
        const columns = Array.from(allColumns).sort();
        const colIdx = columns.indexOf(col);

        let newSectionIdx = sectionIdx;
        let newRowIdx = rowIdx;
        let newCol = col;

        if (e.key === 'ArrowUp') {
          if (rowIdx > 0) {
            newRowIdx = rowIdx - 1;
          } else if (sectionIdx > 0) {
            // Move to previous section's last row
            newSectionIdx = sectionIdx - 1;
            const prevSection = localTableData[newSectionIdx];
            const prevDataRows = prevSection?.rows?.filter(r => r.rowType !== 'header' && !r.isEmpty) || [];
            newRowIdx = Math.max(0, prevDataRows.length - 1);
            // Get columns for previous section
            const prevColumns = new Set<string>();
            prevSection?.rows?.forEach(row => {
              Object.keys(row.cells || {}).forEach(c => prevColumns.add(c));
            });
            const prevColsArray = Array.from(prevColumns).sort();
            newCol = prevColsArray[Math.min(colIdx, prevColsArray.length - 1)] || col;
          }
        } else if (e.key === 'ArrowDown') {
          const dataRows = section.rows?.filter(r => r.rowType !== 'header' && !r.isEmpty) || [];
          if (rowIdx < dataRows.length - 1) {
            newRowIdx = rowIdx + 1;
          } else if (sectionIdx < localTableData.length - 1) {
            // Move to next section's first row
            newSectionIdx = sectionIdx + 1;
            newRowIdx = 0;
            // Get columns for next section
            const nextSection = localTableData[newSectionIdx];
            const nextColumns = new Set<string>();
            nextSection?.rows?.forEach(row => {
              Object.keys(row.cells || {}).forEach(c => nextColumns.add(c));
            });
            const nextColsArray = Array.from(nextColumns).sort();
            newCol = nextColsArray[Math.min(colIdx, nextColsArray.length - 1)] || col;
          }
        } else if (e.key === 'ArrowLeft') {
          if (colIdx > 0) {
            newCol = columns[colIdx - 1];
          }
        } else if (e.key === 'ArrowRight') {
          if (colIdx < columns.length - 1) {
            newCol = columns[colIdx + 1];
          }
        }

        const newCellKey = `${newSectionIdx}-${newRowIdx}-${newCol}`;
        if (newCellKey !== currentCellKey) {
          setSelectedTableCells(new Set([newCellKey]));
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, handleUndo, handleRedo, handleDeleteSelectedRows, selectedTableCells, selectedSectionIndex, handleDeleteSection, localTableData]);

  // Auto-scroll to selected cell when navigating with arrow keys
  useEffect(() => {
    if (activeTab !== 'split' || selectedTableCells.size !== 1) return;
    const cellKey = Array.from(selectedTableCells)[0];
    const cell = document.querySelector(`[data-cell-key="${cellKey}"]`);
    if (cell) {
      cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTab, selectedTableCells]);

  // PDF viewer state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showAllBoxes, setShowAllBoxes] = useState(false);
  const [pdfSearchQuery, setPdfSearchQuery] = useState('');
  const [pdfSearchResults, setPdfSearchResults] = useState<Array<{ ref: string; pageNumber?: number; content: string; polygon?: number[]; type: string }>>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // ===== PDF WHEEL ZOOM HANDLER =====

  // Callback ref to attach wheel handler with { passive: false } to prevent browser zoom
  const pdfContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const handleWheel = (e: WheelEvent) => {
      // Only zoom if Ctrl (Windows) or Meta (Mac) is pressed, or if it's a pinch gesture (ctrlKey is true for pinch)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.01; // Smaller multiplier for smoother zoom
        setScale(s => Math.max(0.5, Math.min(3, s + delta)));
      }
    };

    // Must use { passive: false } to allow preventDefault on wheel events
    node.addEventListener('wheel', handleWheel, { passive: false });
  }, []);

  // ===== PDF REGION DRAWING HANDLERS =====

  // Handle mouse down to start drawing a region
  const handlePdfMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!regionDrawMode || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawingRegion(true);
    setRegionStart({ x, y });
    setRegionEnd({ x, y });
  }, [regionDrawMode]);

  // Handle mouse move while drawing
  const handlePdfMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawingRegion || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    setRegionEnd({ x, y });
  }, [isDrawingRegion]);

  // Handle mouse up to finish drawing
  const handlePdfMouseUp = useCallback(() => {
    if (!isDrawingRegion || !regionStart || !regionEnd) return;

    const minX = Math.min(regionStart.x, regionEnd.x);
    const minY = Math.min(regionStart.y, regionEnd.y);
    const width = Math.abs(regionEnd.x - regionStart.x);
    const height = Math.abs(regionEnd.y - regionStart.y);

    // Only create region if it's big enough (> 10x10 pixels)
    if (width > 10 && height > 10) {
      const newRegion = {
        id: `region-${Date.now()}`,
        x: minX,
        y: minY,
        width,
        height,
        pageNumber: currentPage,
        text: '',
      };

      setDrawnRegions(prev => [...prev, newRegion]);
      setEditingRegionId(newRegion.id);
    }

    setIsDrawingRegion(false);
    setRegionStart(null);
    setRegionEnd(null);
  }, [isDrawingRegion, regionStart, regionEnd, currentPage]);

  // Update region text
  const handleRegionTextChange = useCallback((regionId: string, text: string) => {
    setDrawnRegions(prev =>
      prev.map(r => r.id === regionId ? { ...r, text } : r)
    );
  }, []);

  // Delete a drawn region
  const handleDeleteRegion = useCallback((regionId: string) => {
    setDrawnRegions(prev => prev.filter(r => r.id !== regionId));
    if (editingRegionId === regionId) {
      setEditingRegionId(null);
    }
  }, [editingRegionId]);

  // Create a new Q&A table from selected PDF elements at a specific insertion point
  const handleCreateQATable = useCallback((insertAfterSectionIndex: number) => {
    console.log('handleCreateQATable called:', { insertAfterSectionIndex, selectedPdfElements: Array.from(selectedPdfElements) });

    if (selectedPdfElements.size === 0) {
      setToast({ message: 'No PDF elements selected', type: 'error' });
      return;
    }
    if (!localTableData) {
      setToast({ message: 'Table data not loaded', type: 'error' });
      return;
    }
    if (!sheet) {
      setToast({ message: 'Sheet data not available', type: 'error' });
      return;
    }

    // Find the cell/content data for selected refs
    // Check both table cells AND text content (paragraphs, lines)
    const elementsToAdd: Array<{ ref: string; value: string; pageNumber?: number }> = [];

    // Search in table cells
    for (const row of sheet.rows || []) {
      for (const [_col, cell] of Object.entries(row.cells || {})) {
        const c = cell as any;
        if (selectedPdfElements.has(c.ref)) {
          elementsToAdd.push({
            ref: c.ref,
            value: c.value || '',
            pageNumber: c.pageNumber
          });
        }
      }
    }

    // Also search in text content (paragraphs)
    if (textContent?.paragraphs) {
      textContent.paragraphs.forEach((p, idx) => {
        const ref = `P${idx + 1}`;
        if (selectedPdfElements.has(ref)) {
          elementsToAdd.push({
            ref,
            value: p.content || '',
            pageNumber: p.pageNumber
          });
        }
      });
    }

    // Also search in text content (lines)
    if (textContent?.lines) {
      textContent.lines.forEach((line, idx) => {
        const ref = `L${idx + 1}`;
        if (selectedPdfElements.has(ref)) {
          elementsToAdd.push({
            ref,
            value: line.content || '',
            pageNumber: line.pageNumber
          });
        }
      });
    }

    console.log('Elements found:', elementsToAdd);

    if (elementsToAdd.length === 0) {
      setToast({ message: `Could not find content for selected elements: ${Array.from(selectedPdfElements).join(', ')}`, type: 'error' });
      return;
    }

    // Save to history
    pushToHistory({
      type: 'add_from_pdf',
      data: { elements: elementsToAdd, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Create rows for the new Q&A table
    // If we have pairs of elements, treat odd indices as questions and even as answers
    // Otherwise, each element becomes a question with empty answer
    const newRows: ProcessedSection['rows'] = [];

    if (elementsToAdd.length >= 2) {
      // Try to pair them as Q&A
      for (let i = 0; i < elementsToAdd.length; i += 2) {
        const question = elementsToAdd[i];
        const answer = elementsToAdd[i + 1];
        newRows.push({
          row: newRows.length + 1,
          cells: {
            'A': { ref: question.ref, value: question.value, filled: true, type: 'string' as const, role: 'label' as const, pageNumber: question.pageNumber },
            'B': { ref: answer?.ref || '', value: answer?.value || '', filled: !!answer, type: 'string' as const, role: 'value' as const, pageNumber: answer?.pageNumber },
          },
          isEmpty: false,
          rowType: 'data' as const
        });
      }
    } else {
      // Single element - question with empty answer
      const question = elementsToAdd[0];
      newRows.push({
        row: 1,
        cells: {
          'A': { ref: question.ref, value: question.value, filled: true, type: 'string' as const, role: 'label' as const, pageNumber: question.pageNumber },
          'B': { ref: '', value: '', filled: false, type: 'string' as const, role: 'value' as const },
        },
        isEmpty: false,
        rowType: 'data' as const
      });
    }

    // Create the new section with Q&A table
    const newSection: ProcessedSection = {
      title: 'New Q&A Section',
      type: 'raw_structure',
      rows: [
        // Header row
        {
          row: 0,
          cells: {
            'A': { ref: '', value: 'Question', filled: true, type: 'string' as const, role: 'label' as const },
            'B': { ref: '', value: 'Answer', filled: true, type: 'string' as const, role: 'label' as const },
          },
          isEmpty: false,
          rowType: 'header' as const
        },
        ...newRows
      ],
      textContent: { paragraphs: [] }
    };

    // Insert the new section after the specified index
    const newData = [...localTableData];
    newData.splice(insertAfterSectionIndex + 1, 0, newSection);

    setLocalTableData(newData);
    setSelectedPdfElements(new Set());
    setShowInsertionZones(false);
  }, [selectedPdfElements, localTableData, sheet, textContent, pushToHistory]);

  // Add drawn region to table
  const handleAddRegionToTable = useCallback((regionId: string) => {
    const region = drawnRegions.find(r => r.id === regionId);
    if (!region || !region.text || !localTableData) return;

    // Save to history
    pushToHistory({
      type: 'add_from_pdf',
      data: { region, previousData: JSON.parse(JSON.stringify(localTableData)) },
      timestamp: Date.now()
    });

    // Add as new row to first section
    const newData = [...localTableData];
    if (newData.length > 0) {
      const firstSection = { ...newData[0] };
      const newRow = {
        row: firstSection.rows.length + 1,
        cells: {
          'A': { ref: region.id, value: region.text, filled: true, type: 'string' as const },
        },
        isEmpty: false,
        rowType: 'data' as const
      };
      firstSection.rows = [...firstSection.rows, newRow];
      newData[0] = firstSection;
    }

    setLocalTableData(newData);
    handleDeleteRegion(regionId);
  }, [drawnRegions, localTableData, pushToHistory, handleDeleteRegion]);

  useImperativeHandle(ref, () => ({
    scrollToCell: (cellRef: string) => {
      // For View tab: scroll to the cell in the table
      if (activeTab === 'view') {
        const element = cellRefs.current.get(cellRef);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
      }
      // For File tab: the useEffect will handle page navigation and bounding box
      // The activeCell prop triggers the rendering
    },
    navigateToPage: (pageNumber: number) => {
      if (pageNumber > 0 && pageNumber <= numPages) {
        setCurrentPage(pageNumber);
        // Switch to file tab if not already on a PDF view
        if (activeTab === 'view') {
          setActiveTab('file');
        }
      }
    },
  }));

  const toggleSectionExpanded = (sectionIndex: number) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionIndex)) {
        newSet.delete(sectionIndex);
      } else {
        newSet.add(sectionIndex);
      }
      return newSet;
    });
  };

  // Load PDF when tab switches to 'file'
  useEffect(() => {
    if ((activeTab !== 'file' && activeTab !== 'split' && activeTab !== 'markdown') || !questionnaireId) return;

    setPdfLoading(true);
    setPdfError(null);

    const loadPdf = async () => {
      try {
        const response = await fetch(`/api/questionnaire/${encodeURIComponent(questionnaireId)}/pdf`);
        if (!response.ok) {
          throw new Error('Failed to load PDF');
        }
        const arrayBuffer = await response.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setCurrentPage(1);
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        setPdfLoading(false);
      }
    };

    loadPdf();
  }, [activeTab, questionnaireId]);

  // Find polygon data for a cell reference
  const findCellPolygon = (cellRef: string): { polygon?: number[]; pageNumber?: number } => {
    if (!sheet) {
      console.log('findCellPolygon: no sheet');
      return {};
    }
    for (const row of sheet.rows || []) {
      for (const cell of Object.values(row.cells || {})) {
        const c = cell as any;
        if (c.ref === cellRef && c.polygon) {
          console.log(`findCellPolygon(${cellRef}): found polygon on page ${c.pageNumber}`);
          return { polygon: c.polygon, pageNumber: Number(c.pageNumber) };
        }
      }
    }
    console.log(`findCellPolygon(${cellRef}): not found`);
    return {};
  };

  // Navigate to page when activeCell changes (if on File tab)
  useEffect(() => {
    if (!activeCell || (activeTab !== 'file' && activeTab !== 'split') || !pdfDoc) return;
    const { pageNumber } = findCellPolygon(activeCell);
    if (pageNumber && pageNumber !== currentPage) {
      setCurrentPage(pageNumber);
    }
  }, [activeCell, activeTab, pdfDoc, sheet]);

  // Get all content with polygon/bounding box data for the current page
  // Includes: table cells, paragraphs, lines, key-value pairs
  const getContentForPage = (pageNum: number): Array<{ ref: string; polygon: number[]; value?: string; type: 'cell' | 'paragraph' | 'line' | 'kv' }> => {
    const content: Array<{ ref: string; polygon: number[]; value?: string; type: 'cell' | 'paragraph' | 'line' | 'kv' }> = [];
    const pageNumbers = new Set<number>();

    // Add table cells
    if (sheet) {
      for (const row of sheet.rows || []) {
        for (const cell of Object.values(row.cells || {})) {
          const c = cell as any;
          if (c.polygon && c.pageNumber !== undefined) {
            const cellPage = Number(c.pageNumber);
            pageNumbers.add(cellPage);
            if (cellPage === pageNum) {
              content.push({ ref: c.ref, polygon: c.polygon, value: c.value, type: 'cell' });
            }
          }
        }
      }
    }

    // Add paragraphs with bounding boxes
    if (textContent?.paragraphs) {
      textContent.paragraphs.forEach((p, idx) => {
        if (p.boundingBox && p.pageNumber !== undefined) {
          const pPage = Number(p.pageNumber);
          pageNumbers.add(pPage);
          if (pPage === pageNum) {
            content.push({
              ref: `P${idx + 1}`,
              polygon: p.boundingBox,
              value: p.content?.substring(0, 100),
              type: 'paragraph'
            });
          }
        }
      });
    }

    // Add lines with bounding boxes
    if (textContent?.lines) {
      textContent.lines.forEach((line, idx) => {
        if (line.boundingBox && line.pageNumber !== undefined) {
          const lPage = Number(line.pageNumber);
          pageNumbers.add(lPage);
          if (lPage === pageNum) {
            content.push({
              ref: `L${idx + 1}`,
              polygon: line.boundingBox,
              value: line.content?.substring(0, 100),
              type: 'line'
            });
          }
        }
      });
    }

    console.log(`getContentForPage(${pageNum}): found ${content.length} items (cells: ${content.filter(c => c.type === 'cell').length}, paragraphs: ${content.filter(c => c.type === 'paragraph').length}, lines: ${content.filter(c => c.type === 'line').length}). Pages with data: [${Array.from(pageNumbers).sort((a,b) => a-b).join(', ')}]`);
    return content;
  };

  // Search through all content (cells, paragraphs, lines)
  const searchContent = (query: string): Array<{ ref: string; pageNumber?: number; content: string; polygon?: number[]; type: string }> => {
    if (!query.trim()) return [];
    const results: Array<{ ref: string; pageNumber?: number; content: string; polygon?: number[]; type: string }> = [];
    const lowerQuery = query.toLowerCase();

    // Search table cells (include all cells, not just those with polygons)
    if (sheet) {
      for (const row of sheet.rows || []) {
        for (const cell of Object.values(row.cells || {})) {
          const c = cell as any;
          if (c.value && c.value.toLowerCase().includes(lowerQuery)) {
            results.push({
              ref: c.ref,
              pageNumber: c.pageNumber !== undefined ? Number(c.pageNumber) : undefined,
              content: c.value,
              polygon: c.polygon,
              type: 'cell'
            });
          }
        }
      }
    }

    // Search paragraphs
    if (textContent?.paragraphs) {
      textContent.paragraphs.forEach((p, idx) => {
        if (p.content && p.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            ref: `P${idx + 1}`,
            pageNumber: p.pageNumber !== undefined ? Number(p.pageNumber) : undefined,
            content: p.content,
            polygon: p.boundingBox,
            type: 'paragraph'
          });
        }
      });
    }

    // Search lines
    if (textContent?.lines) {
      textContent.lines.forEach((line, idx) => {
        if (line.content && line.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            ref: `L${idx + 1}`,
            pageNumber: line.pageNumber !== undefined ? Number(line.pageNumber) : undefined,
            content: line.content,
            polygon: line.boundingBox,
            type: 'line'
          });
        }
      });
    }

    // Search vision extraction Q&A pairs
    if (visionExtraction?.qaPairs) {
      visionExtraction.qaPairs.forEach((qa, idx) => {
        const questionMatch = qa.question?.toLowerCase().includes(lowerQuery);
        const answerMatch = qa.answer?.toLowerCase().includes(lowerQuery);
        const sectionMatch = qa.section?.toLowerCase().includes(lowerQuery);
        const rowContextMatch = qa.metadata?.rowContext?.toLowerCase().includes(lowerQuery);
        const columnHeaderMatch = qa.metadata?.columnHeader?.toLowerCase().includes(lowerQuery);

        if (questionMatch || answerMatch || sectionMatch || rowContextMatch || columnHeaderMatch) {
          // Build a descriptive content string
          const contentParts = [];
          if (qa.metadata?.rowContext) contentParts.push(qa.metadata.rowContext);
          if (qa.metadata?.columnHeader) contentParts.push(qa.metadata.columnHeader);
          if (qa.question && !contentParts.includes(qa.question)) contentParts.push(qa.question);
          contentParts.push(qa.answer || '(empty)');

          results.push({
            ref: `V${idx + 1}`,
            pageNumber: qa.page,
            content: contentParts.join(' - '),
            polygon: undefined, // Vision extraction doesn't have bounding boxes
            type: 'vision'
          });
        }
      });
    }

    // Sort by page number, then by ref for consistent ordering
    return results.sort((a, b) => {
      if (a.pageNumber !== undefined && b.pageNumber !== undefined) {
        return a.pageNumber - b.pageNumber;
      }
      if (a.pageNumber !== undefined) return -1;
      if (b.pageNumber !== undefined) return 1;
      return a.ref.localeCompare(b.ref);
    });
  };

  // Set of search result refs for quick lookup (for highlighting)
  const searchResultRefs = useMemo(() => {
    return new Set(pdfSearchResults.map(r => r.ref));
  }, [pdfSearchResults]);

  // Current search result ref
  const currentSearchRef = pdfSearchResults[currentSearchIndex]?.ref;

  // Scroll to current search result when switching to View tab or when result changes
  useEffect(() => {
    if (activeTab === 'view' && currentSearchRef && pdfSearchResults[currentSearchIndex]?.type === 'cell') {
      // Small delay to ensure the DOM has updated
      setTimeout(() => {
        const element = cellRefs.current.get(currentSearchRef);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }, 100);
    }
  }, [activeTab, currentSearchRef, currentSearchIndex, pdfSearchResults]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle search
  const handlePdfSearch = (query: string) => {
    setPdfSearchQuery(query);
    const results = searchContent(query);
    setPdfSearchResults(results);
    setCurrentSearchIndex(0);
    setShowSearchDropdown(query.length > 0 && results.length > 0);
    // Navigate to first result
    if (results.length > 0) {
      const firstResult = results[0];
      if (activeTab === 'file' && firstResult.pageNumber !== undefined) {
        setCurrentPage(firstResult.pageNumber);
      } else if (activeTab === 'view' && firstResult.type === 'cell') {
        // Scroll to cell in table view
        const element = cellRefs.current.get(firstResult.ref);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }
    }
  };

  // Navigate to next/previous search result
  const navigateSearchResult = (direction: 'next' | 'prev') => {
    if (pdfSearchResults.length === 0) return;
    const newIndex = direction === 'next'
      ? (currentSearchIndex + 1) % pdfSearchResults.length
      : (currentSearchIndex - 1 + pdfSearchResults.length) % pdfSearchResults.length;
    setCurrentSearchIndex(newIndex);

    const result = pdfSearchResults[newIndex];
    if (activeTab === 'file' && result.pageNumber !== undefined) {
      setCurrentPage(result.pageNumber);
    } else if (activeTab === 'view' && result.type === 'cell') {
      // Scroll to cell in table view
      const element = cellRefs.current.get(result.ref);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    } else if (activeTab === 'split') {
      // Split view: navigate to page on PDF side
      if (result.pageNumber !== undefined) {
        setCurrentPage(result.pageNumber);
      }
      // Table highlighting happens automatically via currentSearchRef
    }
  };

  // Render current PDF page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || (activeTab !== 'file' && activeTab !== 'split' && activeTab !== 'markdown')) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d')!;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      // @ts-ignore - PDF.js types vary between versions
      await page.render(renderContext).promise;

      // Render bounding box overlays
      if (overlayRef.current) {
        overlayRef.current.innerHTML = '';
        overlayRef.current.style.width = `${viewport.width}px`;
        overlayRef.current.style.height = `${viewport.height}px`;

        // Get page dimensions to calculate coordinate scaling
        // Azure DI returns coordinates in inches, PDF.js viewport is in points (72 per inch)
        const pageWidthInches = viewport.width / 72 / scale;
        const pageHeightInches = viewport.height / 72 / scale;

        // Get all content (cells, paragraphs, lines) for this page
        const contentOnPage = getContentForPage(currentPage);
        if (contentOnPage.length > 0) {
          const sample = contentOnPage[0].polygon;
          console.log('Sample polygon:', sample, 'page size (inches):', pageWidthInches.toFixed(2), 'x', pageHeightInches.toFixed(2));
        }

        // Check if current item is a search result
        const currentSearchResult = pdfSearchResults[currentSearchIndex];
        const searchResultRefs = new Set(pdfSearchResults.filter(r => r.pageNumber === currentPage).map(r => r.ref));

        // Render clickable boxes for content on this page
        for (const item of contentOnPage) {
          const { polygon, ref, type } = item;
          const isActive = activeCell === ref;
          const isSearchResult = searchResultRefs.has(ref);
          const isCurrentSearchResult = currentSearchResult?.ref === ref && currentSearchResult?.pageNumber === currentPage;
          const isPdfSelected = selectedPdfElements.has(ref);
          const isSplitView = activeTabRef.current === 'split';

          // Only show if it's the active item, showAllBoxes is enabled, it's a search result, or selected in split view
          if (!isActive && !showAllBoxes && !isSearchResult && !isPdfSelected && !(isSplitView && showAllBoxes)) continue;

          // Polygon format: [x1,y1, x2,y2, x3,y3, x4,y4]
          // Azure coordinates are in inches from top-left
          // Convert to viewport pixels
          const scaleX = viewport.width / pageWidthInches;
          const scaleY = viewport.height / pageHeightInches;

          const minX = Math.min(polygon[0], polygon[2], polygon[4], polygon[6]) * scaleX;
          const maxX = Math.max(polygon[0], polygon[2], polygon[4], polygon[6]) * scaleX;
          const minY = Math.min(polygon[1], polygon[3], polygon[5], polygon[7]) * scaleY;
          const maxY = Math.max(polygon[1], polygon[3], polygon[5], polygon[7]) * scaleY;

          const boxWidth = maxX - minX;
          const boxHeight = maxY - minY;

          // Different colors for different content types
          const typeColors = {
            cell: { border: 'border-blue-400/60', bg: 'bg-blue-400/10', text: 'text-blue-600 dark:text-blue-300' },
            paragraph: { border: 'border-purple-400/60', bg: 'bg-purple-400/10', text: 'text-purple-600 dark:text-purple-300' },
            line: { border: 'border-emerald-400/60', bg: 'bg-emerald-400/10', text: 'text-emerald-600 dark:text-emerald-300' },
            kv: { border: 'border-orange-400/60', bg: 'bg-orange-400/10', text: 'text-orange-600 dark:text-orange-300' },
          };
          const colors = typeColors[type] || typeColors.cell;

          const box = document.createElement('div');
          box.className = `absolute cursor-pointer transition-colors overflow-hidden ${
            isPdfSelected
              ? 'border-2 border-blue-500 bg-blue-500/30 z-20 ring-2 ring-blue-500/50'
              : isCurrentSearchResult
                ? 'border-2 border-yellow-500 bg-yellow-500/30 z-20'
                : isSearchResult
                  ? 'border-2 border-yellow-400/60 bg-yellow-400/20 z-10'
                  : isActive
                    ? 'border-2 border-accent bg-accent/20 z-10'
                    : `border ${colors.border} ${colors.bg} hover:border-accent hover:bg-accent/10`
          }`;
          box.style.left = `${minX}px`;
          box.style.top = `${minY}px`;
          box.style.width = `${boxWidth}px`;
          box.style.height = `${boxHeight}px`;

          // Add label and value inside the box if there's enough space
          if (boxHeight > 14 && boxWidth > 40) {
            const labelEl = document.createElement('div');
            labelEl.className = `text-[8px] leading-tight truncate px-0.5 ${isPdfSelected ? 'text-blue-200' : colors.text} font-medium`;
            labelEl.textContent = ref;
            box.appendChild(labelEl);

            if (item.value && boxHeight > 24) {
              const valueEl = document.createElement('div');
              valueEl.className = `text-[7px] leading-tight truncate px-0.5 ${isPdfSelected ? 'text-blue-100' : 'text-gray-600 dark:text-gray-300'}`;
              valueEl.textContent = item.value;
              box.appendChild(valueEl);
            }
          }

          box.title = `[${type}] ${ref}: ${item.value || '(empty)'}${isSplitView ? ' (Click to select, Cmd+Click to multi-select)' : ''}`;
          box.onclick = (e) => {
            e.stopPropagation();
            // In split view, handle selection
            if (isSplitView) {
              // Create a synthetic React event for the handler
              const syntheticEvent = {
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                stopPropagation: () => e.stopPropagation(),
                preventDefault: () => e.preventDefault(),
              } as React.MouseEvent;
              handlePdfElementSelect(ref, syntheticEvent);
            } else if (onCellClick && type === 'cell') {
              // Parse cell ref to get row and column
              const match = ref.match(/^([A-Z]+)(\d+)$/);
              if (match) {
                onCellClick(ref, parseInt(match[2], 10), match[1], currentPage);
              }
            }
          };
          overlayRef.current.appendChild(box);
        }
      }
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, activeTab, activeCell, sheet, textContent, onCellClick, showAllBoxes, pdfSearchResults, currentSearchIndex, selectedPdfElements, handlePdfElementSelect]);

  // Derive sections directly from Azure's rowType: 'header' markers - no LLM needed
  const processedSections = useMemo(() => {
    if (!sheet) {
      return [];
    }

    // Group rows by Azure's rowType: 'header' markers - no LLM needed
    const allContentRows = sheet.rows.filter(row => {
      const isPageMarker = Object.values(row.cells).some(cell =>
        cell.value?.includes('=== PAGE')
      );
      return !isPageMarker && !row.isEmpty;
    });

    // Find header row indices
    const headerIndices: number[] = [];
    allContentRows.forEach((row, idx) => {
      if (row.rowType === 'header') {
        headerIndices.push(idx);
      }
    });

    // If no headers found, return all as single section
    if (headerIndices.length === 0) {
      console.log('No header rows found, showing all rows as single section');
      return [{
        title: 'Document Content',
        type: 'raw_structure',
        rows: allContentRows,
        textContent: {
          paragraphs: textContent?.paragraphs || [],
          markdown: textContent?.markdown
        }
      }];
    }

    // Group rows into sections based on header boundaries
    const derivedSections: Array<{
      title: string;
      type: string;
      rows: typeof allContentRows;
      pageLabel?: string;
      textContent: { paragraphs: Array<{ content: string }>; markdown?: string };
    }> = [];

    // Include any text rows that appear BEFORE the first header row
    // These are typically Q&A pairs or section titles that precede tables
    const firstHeaderIdx = headerIndices[0] ?? allContentRows.length;
    if (firstHeaderIdx > 0) {
      const preHeaderRows = allContentRows.slice(0, firstHeaderIdx);
      // Only add if there are actual content rows (not just empty rows)
      const hasContent = preHeaderRows.some(row => !row.isEmpty && row.rowType === 'text');
      if (hasContent) {
        derivedSections.push({
          title: 'Document Info',
          type: 'text_content',
          rows: preHeaderRows,
          textContent: { paragraphs: [] }
        });
      }
    }

    headerIndices.forEach((headerIdx, i) => {
      const nextHeaderIdx = headerIndices[i + 1] ?? allContentRows.length;

      // Get section title from header row (extracted from Azure markdown headings)
      // Fall back to table numbering if not available
      const headerRow = allContentRows[headerIdx];
      const title = headerRow?.sectionTitle || `Table ${i + 1}`;

      // Get rows from header (inclusive) to next header (exclusive)
      const sectionRows = allContentRows.slice(headerIdx, nextHeaderIdx);

      // Get page numbers for this section from cell metadata
      const sectionPages = new Set<number>();
      sectionRows.forEach(row => {
        Object.values(row.cells || {}).forEach((cell: any) => {
          if (cell.pageNumber) sectionPages.add(cell.pageNumber);
        });
      });

      // Collect all cell values from this section (to filter out from paragraphs)
      // Use a more aggressive approach - collect words and phrases from cells
      const tableCellValues = new Set<string>();
      const tableCellWords = new Set<string>();

      sectionRows.forEach(row => {
        Object.values(row.cells || {}).forEach((cell: any) => {
          if (cell.value && cell.value.trim()) {
            const value = cell.value.trim().toLowerCase();
            // Add the full value
            tableCellValues.add(value);
            // Add normalized version (remove extra spaces and punctuation)
            const normalized = value.replace(/\s+/g, ' ').replace(/[(),:;]/g, '');
            tableCellValues.add(normalized);
            // Add words for partial matching (words > 3 chars)
            normalized.split(/\s+/).forEach((word: string) => {
              if (word.length > 3) tableCellWords.add(word);
            });
            // Also add 2-3 word phrases for matching short items
            const words = normalized.split(/\s+/);
            for (let j = 0; j < words.length - 1; j++) {
              tableCellValues.add(words.slice(j, j + 2).join(' '));
              if (j < words.length - 2) {
                tableCellValues.add(words.slice(j, j + 3).join(' '));
              }
            }
          }
        });
      });

      // Filter paragraphs to only those on same pages AND not already in table cells
      const relevantParagraphs = (textContent?.paragraphs || []).filter(p => {
        // Must be on same page
        if (!p.pageNumber || !sectionPages.has(p.pageNumber)) return false;

        // Skip if content is already in the table
        const normalizedContent = p.content.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[(),:;]/g, '');

        // Exact match
        if (tableCellValues.has(normalizedContent)) return false;

        // Check if paragraph content is a substring of any cell value or vice versa
        for (const cellValue of tableCellValues) {
          // Skip very short cell values to avoid false positives
          if (cellValue.length < 4) continue;

          // Content is contained in a cell or cell is contained in content
          if (normalizedContent.includes(cellValue) || cellValue.includes(normalizedContent)) {
            return false;
          }
        }

        // Check for significant word overlap (if >40% of words match table cells, skip it)
        const contentWords = normalizedContent.split(/\s+/).filter(w => w.length > 3);
        if (contentWords.length > 0) {
          const matchingWords = contentWords.filter(w => tableCellWords.has(w));
          if (matchingWords.length / contentWords.length > 0.4) {
            return false;
          }
        }

        return true;
      });

      // Extract clean descriptive text for this section
      // Filter paragraphs to get only meaningful descriptions (not table content)
      const cleanDescriptions: string[] = [];

      for (const p of relevantParagraphs) {
        const content = p.content.trim();

        // Skip HTML artifacts
        if (content.includes('</tr>') || content.includes('</table>') ||
            content.includes('<table') || content.includes('<tr') ||
            content.includes('<td') || content.includes('<th') ||
            content.includes('<figure') || content.includes('</figure>')) {
          continue;
        }

        // Skip page markers and metadata
        if (content.includes('PageNumber=') || content.includes('PageBreak') ||
            content.includes('PageHeader=') || content.startsWith('<!--')) {
          continue;
        }

        // Skip very short content (likely fragments)
        if (content.length < 10) continue;

        // Skip content that looks like table cell fragments
        if (/^[A-Z]{1,2}\d+$/.test(content)) continue; // Cell refs like A1, B2
        if (/^\d+$/.test(content)) continue; // Just numbers
        if (/^(Yes|No|N\/A|—)$/i.test(content)) continue; // Checkbox values

        // Skip Docusign envelope IDs and similar metadata
        if (content.includes('Docusign Envelope ID:')) continue;
        if (content.includes('BARRY CALLEBAUT') && content.length < 20) continue;

        // Skip lines that are just company names or dates repeated from headers
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(content)) continue;

        cleanDescriptions.push(content);
      }

      // Get page number(s) for this section
      const pageNumbers = Array.from(sectionPages).sort((a, b) => a - b);
      const pageLabel = pageNumbers.length === 1
        ? `Page ${pageNumbers[0]}`
        : pageNumbers.length > 1
          ? `Pages ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`
          : '';

      derivedSections.push({
        title,
        type: 'raw_structure',
        rows: sectionRows,
        pageLabel,
        textContent: {
          paragraphs: cleanDescriptions.map(content => ({ content })),
          markdown: undefined // We'll use clean paragraphs instead
        }
      });
    });

    console.log(`Derived ${derivedSections.length} sections from Azure header markers`);
    return derivedSections;
  }, [sheet, textContent]);

  // Initialize local table data when entering split view
  // NOTE: This must be after processedSections is defined
  useEffect(() => {
    if (activeTab === 'split' && processedSections.length > 0 && !localTableData) {
      setLocalTableData(JSON.parse(JSON.stringify(processedSections)));
    }
  }, [activeTab, processedSections, localTableData]);

  // Reset local data when leaving split view
  useEffect(() => {
    if (activeTab !== 'split') {
      setLocalTableData(null);
      setSelectedTableCells(new Set());
      setSelectedPdfElements(new Set());
      setEditHistory([]);
      setHistoryIndex(-1);
      setShowInsertionZones(false);
      setSelectedSectionIndex(null);
    }
  }, [activeTab]);

  if (!visible) return null;

  const handleCellClick = (cellRef: string, row: number, col: string) => {
    if (onCellClick) {
      onCellClick(cellRef, row, col);
    }
  };

  return (
    <div className="flex-1 flex flex-col border-r border-default overflow-hidden min-w-0 bg-app">
      {/* Header with tabs */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-primary">Original</span>
          {/* Tabs - icon only */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('file')}
              className={`p-1.5 rounded transition-colors ${
                activeTab === 'file'
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="File"
            >
              <File size={16} weight={activeTab === 'file' ? 'fill' : 'regular'} />
            </button>
            {/* View and Split tabs - hide in Vision mode since they show Azure structure */}
            {extractionView !== 'vision' && (
              <>
                <button
                  onClick={() => setActiveTab('view')}
                  className={`p-1.5 rounded transition-colors ${
                    activeTab === 'view'
                      ? 'bg-accent text-white'
                      : 'text-muted hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="View"
                >
                  <GridFour size={16} weight={activeTab === 'view' ? 'fill' : 'regular'} />
                </button>
                <button
                  onClick={() => setActiveTab('split')}
                  className={`p-1.5 rounded transition-colors ${
                    activeTab === 'split'
                      ? 'bg-accent text-white'
                      : 'text-muted hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="Split View (File + Table)"
                >
                  <SplitHorizontal size={16} weight={activeTab === 'split' ? 'fill' : 'regular'} />
                </button>
              </>
            )}
            {/* Markdown tab - only shown when vision extraction is available */}
            {visionExtraction && (
              <button
                onClick={() => setActiveTab('markdown')}
                className={`p-1.5 rounded transition-colors ${
                  activeTab === 'markdown'
                    ? 'bg-purple-500 text-white'
                    : 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/20'
                }`}
                title="Vision Extraction (Markdown)"
              >
                <Code size={16} weight={activeTab === 'markdown' ? 'fill' : 'regular'} />
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div ref={searchContainerRef} className="relative flex items-center gap-2 flex-1 max-w-[400px] mx-4">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search questions, answers, sections..."
              value={pdfSearchQuery}
              onChange={(e) => handlePdfSearch(e.target.value)}
              onFocus={() => pdfSearchResults.length > 0 && setShowSearchDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSearchDropdown(false);
                } else if (e.key === 'ArrowDown' && pdfSearchResults.length > 0) {
                  e.preventDefault();
                  setCurrentSearchIndex(i => (i + 1) % pdfSearchResults.length);
                } else if (e.key === 'ArrowUp' && pdfSearchResults.length > 0) {
                  e.preventDefault();
                  setCurrentSearchIndex(i => (i - 1 + pdfSearchResults.length) % pdfSearchResults.length);
                } else if (e.key === 'Enter' && pdfSearchResults.length > 0) {
                  const result = pdfSearchResults[currentSearchIndex];
                  if (result?.pageNumber !== undefined) {
                    setCurrentPage(result.pageNumber);
                  }
                  setShowSearchDropdown(false);
                }
              }}
              className="w-full h-7 px-2.5 bg-app border border-default rounded text-[12px] text-primary placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {/* Search Results Dropdown */}
            {showSearchDropdown && pdfSearchQuery && pdfSearchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-panel border border-default rounded shadow-lg max-h-[300px] overflow-y-auto z-50">
                {pdfSearchResults.slice(0, 50).map((result, idx) => (
                  <button
                    key={`${result.ref}-${idx}`}
                    onClick={() => {
                      setCurrentSearchIndex(idx);
                      if (result.pageNumber !== undefined) {
                        setCurrentPage(result.pageNumber);
                      }
                      setShowSearchDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-[11px] border-b border-subtle last:border-b-0 hover:bg-hover transition-colors ${
                      idx === currentSearchIndex ? 'bg-accent/10 border-l-2 border-l-accent' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        result.type === 'vision' ? 'bg-purple-500/20 text-purple-400' :
                        result.type === 'cell' ? 'bg-blue-500/20 text-blue-400' :
                        result.type === 'paragraph' ? 'bg-green-500/20 text-green-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {result.type === 'vision' ? 'Q&A' : result.type}
                      </span>
                      {result.pageNumber !== undefined && (
                        <span className="text-muted">p.{result.pageNumber}</span>
                      )}
                    </div>
                    <div className="mt-1 text-primary line-clamp-2">
                      {result.content.length > 120 ? result.content.slice(0, 120) + '...' : result.content}
                    </div>
                  </button>
                ))}
                {pdfSearchResults.length > 50 && (
                  <div className="px-3 py-2 text-[10px] text-muted text-center bg-subtle">
                    Showing first 50 of {pdfSearchResults.length} results
                  </div>
                )}
              </div>
            )}
            {pdfSearchQuery && pdfSearchResults.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-panel border border-default rounded shadow-lg p-3 text-[11px] text-muted z-50">
                No results found for "{pdfSearchQuery}"
              </div>
            )}
          </div>
          {pdfSearchResults.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted whitespace-nowrap">
                {currentSearchIndex + 1}/{pdfSearchResults.length}
              </span>
              <button
                onClick={() => navigateSearchResult('prev')}
                className="px-1.5 py-0.5 text-[11px] bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                ↑
              </button>
              <button
                onClick={() => navigateSearchResult('next')}
                className="px-1.5 py-0.5 text-[11px] bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  setPdfSearchQuery('');
                  setPdfSearchResults([]);
                }}
                className="px-1.5 py-0.5 text-[11px] bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                title="Clear search"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {activeCell && (
            <span className="text-[11px] text-accent font-mono">
              {activeCell}
            </span>
          )}
          <span className="text-[11px] text-muted">
            {activeTab === 'view'
              ? (processedSections.length > 0 ? `${processedSections.length} sections` : 'No sections')
              : activeTab === 'split'
                ? (numPages > 0 ? `Page ${currentPage}/${numPages} • ${processedSections.length} sections` : '')
                : (numPages > 0 ? `${currentPage}/${numPages}` : '')}
          </span>
        </div>
      </div>

      {/* Split View Container */}
      {activeTab === 'split' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Split View Toolbar */}
          <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
            <div className="flex items-center gap-2">
              {/* Selection info */}
              {selectedTableCells.size > 0 && (
                <span className="text-[11px] text-accent">
                  {selectedTableCells.size} cell{selectedTableCells.size !== 1 ? 's' : ''} selected
                </span>
              )}
              {selectedPdfElements.size > 0 && (
                <span className="text-[11px] text-blue-400">
                  {selectedPdfElements.size} PDF element{selectedPdfElements.size !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Undo/Redo */}
              <button
                onClick={handleUndo}
                disabled={historyIndex < 0}
                className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-600"
                title="Undo (⌘Z)"
              >
                Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= editHistory.length - 1}
                className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-600"
                title="Redo (⌘⇧Z)"
              >
                Redo
              </button>
              <div className="w-px h-4 bg-default mx-1" />
              {/* Delete selected */}
              <button
                onClick={handleDeleteSelectedRows}
                disabled={selectedTableCells.size === 0}
                className="px-2 py-1 text-[11px] bg-red-500/20 text-red-400 rounded disabled:opacity-30 hover:bg-red-500/30"
                title="Delete selected (Delete/Backspace)"
              >
                <Trash size={14} className="inline mr-1" />
                Delete
              </button>
              {/* Add to table */}
              <button
                onClick={handleAddPdfElementsToTable}
                disabled={selectedPdfElements.size === 0}
                className="px-2 py-1 text-[11px] bg-emerald-500/20 text-emerald-400 rounded disabled:opacity-30 hover:bg-emerald-500/30"
                title={selectedTableCells.size > 0 ? "Insert above selected row" : "Add to end of table"}
              >
                <Plus size={14} className="inline mr-1" />
                {selectedTableCells.size > 0 ? 'Insert Above' : 'Add to Table'}
              </button>
              {/* Create new Q&A table */}
              <button
                onClick={() => setShowInsertionZones(!showInsertionZones)}
                disabled={selectedPdfElements.size === 0}
                className={`px-2 py-1 text-[11px] rounded transition-colors disabled:opacity-30 ${
                  showInsertionZones
                    ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50'
                    : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                }`}
                title="Create a new Q&A table from selected PDF elements"
              >
                <GridFour size={14} className="inline mr-1" />
                {showInsertionZones ? 'Click to Insert' : 'New Table'}
              </button>
              <div className="w-px h-4 bg-default mx-1" />
              {/* Draw region toggle */}
              <button
                onClick={() => setRegionDrawMode(!regionDrawMode)}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  regionDrawMode
                    ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50'
                    : 'bg-gray-100 dark:bg-gray-700 text-muted hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title="Draw a region on the PDF to annotate manually"
              >
                <PencilSimpleLine size={14} className="inline mr-1" />
                {regionDrawMode ? 'Drawing...' : 'Draw Region'}
              </button>
              {drawnRegions.length > 0 && (
                <span className="text-[11px] text-purple-400">
                  {drawnRegions.length} region{drawnRegions.length !== 1 ? 's' : ''}
                </span>
              )}
              <div className="w-px h-4 bg-default mx-1" />
              {/* Save button */}
              <button
                onClick={handleSaveSplitViewChanges}
                disabled={!hasUnsavedChanges || isSaving}
                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                  hasUnsavedChanges
                    ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                    : 'bg-gray-100 dark:bg-gray-700 text-muted/50'
                } disabled:opacity-50`}
                title={hasUnsavedChanges ? "Save changes (⌘S)" : "No unsaved changes"}
              >
                <FloppyDisk size={14} className="inline mr-1" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {saveError && (
                <span className="text-[10px] text-red-400" title={saveError}>
                  Error!
                </span>
              )}
              {hasUnsavedChanges && !isSaving && (
                <span className="text-[10px] text-amber-400">
                  Unsaved
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
          {/* Left: PDF */}
          <div className="w-1/2 flex flex-col overflow-hidden border-r border-default">
            {/* PDF Controls */}
            {numPages > 0 && (
              <div className="h-10 px-3 flex items-center justify-between border-b border-default bg-app-secondary">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                  >
                    ←
                  </button>
                  <span className="text-[10px] text-muted">{currentPage}/{numPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage >= numPages}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                  >
                    →
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Hide bounding box toggle in Vision mode */}
                  {extractionView !== 'vision' && (
                    <button
                      onClick={() => setShowAllBoxes(!showAllBoxes)}
                      className={`px-1.5 py-0.5 text-[10px] rounded ${
                        showAllBoxes ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-muted'
                      }`}
                    >
                      {showAllBoxes ? 'Hide' : 'Show'}
                    </button>
                  )}
                  <div className="flex items-center gap-1">
                    <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="px-1 text-[10px] bg-gray-100 dark:bg-gray-700 rounded">−</button>
                    <span className="text-[10px] text-muted">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="px-1 text-[10px] bg-gray-100 dark:bg-gray-700 rounded">+</button>
                  </div>
                </div>
              </div>
            )}
            <div ref={pdfContainerRef} className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex items-start justify-center p-2" style={{ overscrollBehavior: 'contain' }}>
              {pdfLoading && <div className="text-muted text-center py-8 text-[12px]">Loading PDF...</div>}
              {pdfError && <div className="text-red-500 text-center py-8 text-[12px]">{pdfError}</div>}
              {!pdfLoading && !pdfError && !pdfDoc && (
                <div className="text-muted text-center py-8 text-[12px]">
                  {questionnaireId ? 'No PDF available' : 'Select a questionnaire'}
                </div>
              )}
              {pdfDoc && (
                <div
                  className="relative inline-block shadow-lg"
                  onMouseDown={handlePdfMouseDown}
                  onMouseMove={handlePdfMouseMove}
                  onMouseUp={handlePdfMouseUp}
                  onMouseLeave={handlePdfMouseUp}
                  style={{ cursor: regionDrawMode ? 'crosshair' : 'default' }}
                >
                  <canvas ref={canvasRef} className="bg-white" />
                  <div ref={overlayRef} className="absolute top-0 left-0 pointer-events-auto" />

                  {/* Drawing rectangle while dragging */}
                  {isDrawingRegion && regionStart && regionEnd && (
                    <div
                      className="absolute border-2 border-purple-500 bg-purple-500/20 pointer-events-none z-30"
                      style={{
                        left: Math.min(regionStart.x, regionEnd.x),
                        top: Math.min(regionStart.y, regionEnd.y),
                        width: Math.abs(regionEnd.x - regionStart.x),
                        height: Math.abs(regionEnd.y - regionStart.y),
                      }}
                    />
                  )}

                  {/* Drawn regions with text inputs */}
                  {drawnRegions
                    .filter(r => r.pageNumber === currentPage)
                    .map(region => (
                      <div
                        key={region.id}
                        className={`absolute border-2 bg-purple-500/20 z-20 ${
                          editingRegionId === region.id
                            ? 'border-purple-400 ring-2 ring-purple-400/50'
                            : 'border-purple-500/60'
                        }`}
                        style={{
                          left: region.x,
                          top: region.y,
                          width: region.width,
                          height: region.height,
                        }}
                      >
                        <div className="absolute -top-7 left-0 right-0 flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="Enter text..."
                            value={region.text || ''}
                            onChange={(e) => handleRegionTextChange(region.id, e.target.value)}
                            onFocus={() => setEditingRegionId(region.id)}
                            className="flex-1 h-6 px-1.5 bg-white dark:bg-gray-800 border border-purple-400 rounded text-[11px] text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-purple-400 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          />
                          {region.text && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddRegionToTable(region.id);
                              }}
                              className="h-6 px-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded text-[10px] whitespace-nowrap"
                              title="Add to table"
                            >
                              <Plus size={12} className="inline" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRegion(region.id);
                            }}
                            className="h-6 w-6 flex items-center justify-center bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                            title="Delete region"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Table View */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {(localTableData || processedSections).length > 0 ? (
                <div className="space-y-4 p-3">
                  {/* Insertion zone before first section */}
                  {showInsertionZones && selectedPdfElements.size > 0 && (
                    <button
                      onClick={() => handleCreateQATable(-1)}
                      className="w-full py-3 border-2 border-dashed border-purple-500/50 rounded-lg text-purple-400 text-[12px] hover:bg-purple-500/10 hover:border-purple-500 transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={16} />
                      Create Q&A Table Here ({selectedPdfElements.size} element{selectedPdfElements.size !== 1 ? 's' : ''})
                    </button>
                  )}
                  {(localTableData || processedSections).map((section, sectionIndex) => (
                    <div key={sectionIndex} className="space-y-2">
                      <div
                        className={`border-b pb-1 px-2 py-1 -mx-2 rounded-t transition-colors cursor-pointer group/section ${
                          selectedSectionIndex === sectionIndex
                            ? 'border-red-400/50 bg-red-500/10 ring-1 ring-red-400/30'
                            : 'border-default hover:bg-card-hover'
                        }`}
                        onClick={(e) => {
                          // Don't select if clicking on trash or during editing
                          if (editingSectionTitle === sectionIndex) return;
                          if ((e.target as HTMLElement).closest('button')) return;
                          setSelectedSectionIndex(selectedSectionIndex === sectionIndex ? null : sectionIndex);
                          // Clear cell selection when selecting section
                          setSelectedTableCells(new Set());
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {editingSectionTitle === sectionIndex ? (
                            <input
                              type="text"
                              autoFocus
                              value={editingSectionTitleValue}
                              onChange={(e) => setEditingSectionTitleValue(e.target.value)}
                              onBlur={() => {
                                if (editingSectionTitleValue.trim()) {
                                  handleUpdateSectionTitle(sectionIndex, editingSectionTitleValue);
                                } else {
                                  setEditingSectionTitle(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editingSectionTitleValue.trim()) {
                                  handleUpdateSectionTitle(sectionIndex, editingSectionTitleValue);
                                } else if (e.key === 'Escape') {
                                  setEditingSectionTitle(null);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[13px] font-semibold text-primary bg-transparent border-b border-accent outline-none min-w-[100px]"
                            />
                          ) : (
                            <h3
                              className={`text-[13px] font-semibold transition-colors ${
                                selectedSectionIndex === sectionIndex ? 'text-red-400' : 'text-primary hover:text-accent'
                              }`}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingSectionTitle(sectionIndex);
                                setEditingSectionTitleValue(section.title);
                                setSelectedSectionIndex(null);
                              }}
                              title="Click to select, double-click to edit"
                            >
                              {section.title}
                            </h3>
                          )}
                          {section.pageLabel && (
                            <span className="text-[10px] text-muted">{section.pageLabel}</span>
                          )}
                          <div className="flex-1" />
                          {/* Trash icon - visible on hover or when selected */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSection(sectionIndex);
                            }}
                            className={`p-1 rounded transition-all ${
                              selectedSectionIndex === sectionIndex
                                ? 'opacity-100 text-red-400 hover:bg-red-500/20'
                                : 'opacity-0 group-hover/section:opacity-100 text-muted hover:text-red-400 hover:bg-red-500/10'
                            }`}
                            title="Delete section (or press Backspace)"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                      {/* Chunked render for split view - matches View tab logic */}
                      {section.rows && section.rows.length > 0 && (() => {
                        // Group consecutive rows into chunks (text OR table)
                        type SplitViewChunk =
                          | { type: 'text'; rows: typeof section.rows }
                          | { type: 'table'; headerRows: typeof section.rows; dataRows: typeof section.rows; columns: string[] };

                        const chunks: SplitViewChunk[] = [];
                        let currentTextRows: typeof section.rows = [];
                        let currentTableRows: typeof section.rows = [];

                        const flushTable = () => {
                          if (currentTableRows.length > 0) {
                            const headerRows = currentTableRows.filter(r => r.rowType === 'header');
                            const dataRows = currentTableRows.filter(r => r.rowType !== 'header' && !r.isEmpty);
                            const allColumns = new Set<string>();
                            currentTableRows.forEach(row => {
                              Object.keys(row.cells || {}).forEach(col => allColumns.add(col));
                            });
                            chunks.push({
                              type: 'table',
                              headerRows,
                              dataRows,
                              columns: Array.from(allColumns).sort()
                            });
                            currentTableRows = [];
                          }
                        };

                        const flushText = () => {
                          if (currentTextRows.length > 0) {
                            chunks.push({ type: 'text', rows: currentTextRows });
                            currentTextRows = [];
                          }
                        };

                        // Check if a text row is page header noise
                        const isPageHeaderNoise = (row: typeof section.rows[0]): boolean => {
                          const values = Object.values(row.cells || {}).map((c: any) => c?.value?.trim() || '').filter(Boolean);
                          const combined = values.join(' ').toLowerCase();
                          if (/docusign/i.test(combined)) return true;
                          if (/^barry\s*callebaut$/i.test(combined)) return true;
                          if (/raw material questionnaire/i.test(combined)) return true;
                          if (/^\d{2}\/\d{2}\/\d{4}$/.test(combined)) return true;
                          if (/^[A-F0-9-]{20,}$/i.test(combined)) return true;
                          if (combined.length < 20 && combined === combined.toUpperCase() && !combined.includes('(')) return true;
                          return false;
                        };

                        // Check if text row looks like table continuation
                        // Be conservative - only merge if it's clearly the same table structure
                        const looksLikeTableContinuation = (row: typeof section.rows[0], prevTableRows: typeof section.rows): boolean => {
                          const cellA = row.cells?.['A']?.value?.trim() || '';

                          // Has unit label pattern like "(mg/100g)", "(µg/100g)", "(kcal)", "(g)", "(%)"
                          if (/\((mg|µg|ug|g|kcal|kJ|%|ml|l)\/?\d*\w*\)/i.test(cellA)) return true;

                          // Check if first column pattern matches previous table
                          // If previous table has numeric first column (1, 2, 3...) and this row has text, it's a new table
                          if (prevTableRows.length > 0) {
                            const prevFirstColValues = prevTableRows
                              .map(r => r.cells?.['A']?.value?.trim() || '')
                              .filter(Boolean);

                            // Check if previous table used numeric identifiers
                            const prevHasNumericPattern = prevFirstColValues.some(v => /^\d+\.?$/.test(v));
                            const currentIsNumeric = /^\d+\.?$/.test(cellA);

                            // If previous was numeric but current is long text label, it's a new table
                            if (prevHasNumericPattern && !currentIsNumeric && cellA.length > 10) {
                              return false;
                            }
                          }

                          // Only merge if it has the same column structure (same number of filled cells)
                          const filledCount = Object.values(row.cells || {}).filter((c: any) => c?.value?.trim()).length;
                          if (prevTableRows.length > 0 && filledCount >= 2) {
                            // Check if column count matches
                            const prevFilledCounts = prevTableRows.slice(-3).map(r =>
                              Object.values(r.cells || {}).filter((c: any) => c?.value?.trim()).length
                            );
                            const avgPrevFilled = prevFilledCounts.reduce((a, b) => a + b, 0) / prevFilledCounts.length;
                            // If column count is similar, it might be continuation
                            if (Math.abs(filledCount - avgPrevFilled) <= 1) {
                              // But check if content pattern is similar
                              const currentFirstColIsLabel = cellA.length > 15 && !(/^\d+\.?$/.test(cellA));
                              const prevFirstColIsLabel = prevTableRows.some(r => {
                                const v = r.cells?.['A']?.value?.trim() || '';
                                return v.length > 15 && !(/^\d+\.?$/.test(v));
                              });
                              // Only merge if both have label-style first column, or both have numeric
                              if (currentFirstColIsLabel === prevFirstColIsLabel) {
                                return true;
                              }
                            }
                          }

                          return false;
                        };

                        // Process rows into chunks
                        for (const row of section.rows) {
                          if (row.isEmpty) continue;
                          if (row.rowType === 'text') {
                            if (isPageHeaderNoise(row)) continue;
                            if (currentTableRows.length > 0 && looksLikeTableContinuation(row, currentTableRows)) {
                              currentTableRows.push({ ...row, rowType: 'data' });
                              continue;
                            }
                            flushTable();
                            currentTextRows.push(row);
                          } else {
                            flushText();
                            currentTableRows.push(row);
                          }
                        }
                        flushText();
                        flushTable();

                        // Track global row index for selection
                        let globalRowIndex = 0;

                        return (
                          <div className="space-y-3">
                            {chunks.map((chunk, chunkIdx) => {
                              if (chunk.type === 'text') {
                                // Filter to actual prose content
                                const proseItems: string[] = [];
                                for (const textRow of chunk.rows) {
                                  const cellValues = Object.values(textRow.cells || {})
                                    .map((c: any) => c?.value?.trim())
                                    .filter(Boolean);
                                  const combined = cellValues.join(' ').trim();
                                  if (combined.length >= 15 && !/docusign/i.test(combined) && combined.includes(' ')) {
                                    proseItems.push(combined);
                                  }
                                }
                                const uniqueProse = [...new Set(proseItems)];
                                if (uniqueProse.length === 0) return null;

                                return (
                                  <div key={`text-${chunkIdx}`} className="text-[11px] leading-relaxed space-y-1 text-muted italic border-l-2 border-subtle pl-2">
                                    {uniqueProse.map((text, idx) => (
                                      <p key={idx}>{text}</p>
                                    ))}
                                  </div>
                                );
                              } else {
                                // Table chunk
                                const { headerRows, dataRows, columns } = chunk;
                                if (headerRows.length === 0 && dataRows.length === 0) return null;

                                // Build all cell keys for this table chunk
                                const chunkStartIdx = globalRowIndex;
                                const allCellKeys: string[] = [];
                                dataRows.slice(0, 50).forEach((_, rowIdx) => {
                                  columns.forEach(col => {
                                    allCellKeys.push(`${sectionIndex}-${chunkStartIdx + rowIdx}-${col}`);
                                  });
                                });

                                const tableElement = (
                                  <div
                                    key={`table-${chunkIdx}`}
                                    className="bg-card rounded border border-subtle overflow-hidden"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      // Handle drop from PDF elements
                                      if (selectedPdfElements.size > 0) {
                                        handleAddPdfElementsToTable();
                                      }
                                    }}
                                  >
                                    <div className="overflow-x-auto">
                                      <table className="w-full border-collapse text-[11px]">
                                        {headerRows.length > 0 && (
                                          <thead>
                                            {headerRows.map((headerRow, hIdx) => {
                                              // For headers, we need a special row index (negative to distinguish from data rows)
                                              const headerRowIdx = -(hIdx + 1);
                                              return (
                                                <tr key={`header-${hIdx}`} className="bg-app-secondary group/row">
                                                  {/* Action column header */}
                                                  <th className="w-16 px-1 border-r border-subtle bg-app-secondary"></th>
                                                  {columns.map(col => {
                                                    const cell = headerRow.cells?.[col] as any;
                                                    const isEditingHeader = editingSplitCell?.sectionIdx === sectionIndex &&
                                                                           editingSplitCell?.rowIdx === headerRowIdx &&
                                                                           editingSplitCell?.col === col;
                                                    return (
                                                      <th
                                                        key={col}
                                                        className="px-2 py-1.5 border-r border-subtle last:border-r-0 font-medium text-muted text-left cursor-pointer hover:bg-card-hover transition-colors"
                                                        onDoubleClick={() => {
                                                          setEditingSplitCell({ sectionIdx: sectionIndex, rowIdx: headerRowIdx, col });
                                                          setEditingSplitCellValue(cell?.value || '');
                                                        }}
                                                      >
                                                        {isEditingHeader ? (
                                                          <input
                                                            type="text"
                                                            autoFocus
                                                            value={editingSplitCellValue}
                                                            onChange={(e) => setEditingSplitCellValue(e.target.value)}
                                                            onBlur={() => {
                                                              handleUpdateSplitCell(sectionIndex, headerRowIdx, col, editingSplitCellValue);
                                                            }}
                                                            onKeyDown={(e) => {
                                                              if (e.key === 'Enter') {
                                                                handleUpdateSplitCell(sectionIndex, headerRowIdx, col, editingSplitCellValue);
                                                              } else if (e.key === 'Escape') {
                                                                setEditingSplitCell(null);
                                                                setEditingSplitCellValue('');
                                                              }
                                                            }}
                                                            className="w-full bg-transparent border-b border-accent outline-none text-[11px] font-medium"
                                                            onClick={(e) => e.stopPropagation()}
                                                          />
                                                        ) : (
                                                          cell?.value || ''
                                                        )}
                                                      </th>
                                                    );
                                                  })}
                                                </tr>
                                              );
                                            })}
                                          </thead>
                                        )}
                                        <tbody>
                                          {dataRows.slice(0, 50).map((row, rowIdx) => {
                                            const absoluteRowIdx = chunkStartIdx + rowIdx;
                                            // Find the actual index in section.rows by reference comparison
                                            const actualSectionRowIdx = section.rows.findIndex(r => r === row);
                                            const rowCellKeys = columns.map(col => `${sectionIndex}-${absoluteRowIdx}-${col}`);
                                            const allRowCellsSelected = rowCellKeys.every(k => selectedTableCells.has(k));
                                            const someRowCellsSelected = rowCellKeys.some(k => selectedTableCells.has(k));

                                            return (
                                              <tr
                                                key={rowIdx}
                                                className={`border-b border-subtle transition-colors group/row relative ${
                                                  allRowCellsSelected ? 'bg-accent/20' :
                                                  someRowCellsSelected ? 'bg-accent/10' :
                                                  'hover:bg-card-hover'
                                                }`}
                                              >
                                                {/* Action column */}
                                                <td className="w-16 px-1 py-0.5 border-r border-subtle bg-app-secondary/50">
                                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleMoveRow(sectionIndex, actualSectionRowIdx >= 0 ? actualSectionRowIdx : absoluteRowIdx, 'up');
                                                      }}
                                                      disabled={rowIdx === 0}
                                                      className="p-0.5 text-[9px] text-gray-400 hover:bg-gray-500/30 rounded disabled:opacity-30"
                                                      title="Move up"
                                                    >
                                                      ▲
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleMoveRow(sectionIndex, actualSectionRowIdx >= 0 ? actualSectionRowIdx : absoluteRowIdx, 'down');
                                                      }}
                                                      disabled={rowIdx === dataRows.length - 1}
                                                      className="p-0.5 text-[9px] text-gray-400 hover:bg-gray-500/30 rounded disabled:opacity-30"
                                                      title="Move down"
                                                    >
                                                      ▼
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddRowToSection(sectionIndex, actualSectionRowIdx >= 0 ? actualSectionRowIdx : absoluteRowIdx, 'above');
                                                      }}
                                                      className="p-0.5 text-[9px] text-emerald-400 hover:bg-emerald-500/30 rounded"
                                                      title={selectedPdfElements.size > 0 ? `Add ${selectedPdfElements.size} above` : 'Add row above'}
                                                    >
                                                      +↑
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddRowToSection(sectionIndex, actualSectionRowIdx >= 0 ? actualSectionRowIdx : absoluteRowIdx, 'below');
                                                      }}
                                                      className="p-0.5 text-[9px] text-emerald-400 hover:bg-emerald-500/30 rounded"
                                                      title={selectedPdfElements.size > 0 ? `Add ${selectedPdfElements.size} below` : 'Add row below'}
                                                    >
                                                      +↓
                                                    </button>
                                                  </div>
                                                </td>
                                                {columns.map((col) => {
                                                  const cell = row.cells?.[col] as any;
                                                  const pageNum = cell?.pageNumber as number | undefined;
                                                  const cellKey = `${sectionIndex}-${absoluteRowIdx}-${col}`;
                                                  const isSelected = selectedTableCells.has(cellKey);
                                                  // Use actualSectionRowIdx for editing, which is the real index in section.rows
                                                  const editRowIdx = actualSectionRowIdx >= 0 ? actualSectionRowIdx : absoluteRowIdx;
                                                  const isEditing = editingSplitCell?.sectionIdx === sectionIndex &&
                                                                    editingSplitCell?.rowIdx === editRowIdx &&
                                                                    editingSplitCell?.col === col;
                                                  // Search highlighting
                                                  const isSearchMatch = cell?.ref && searchResultRefs.has(cell.ref);
                                                  const isCurrentSearchMatch = cell?.ref && cell.ref === currentSearchRef;

                                                  return (
                                                    <td
                                                      key={col}
                                                      data-cell-key={cellKey}
                                                      className={`px-2 py-1.5 border-r border-subtle last:border-r-0 cursor-pointer transition-colors relative ${
                                                        cell?.role === 'label' ? 'font-medium text-muted' : 'text-primary'
                                                      } ${
                                                        isCurrentSearchMatch
                                                          ? 'bg-yellow-400/40 ring-2 ring-yellow-500 ring-inset'
                                                          : isSearchMatch
                                                            ? 'bg-yellow-300/20'
                                                            : isSelected ? 'bg-accent/30 ring-1 ring-accent/50 ring-inset' : 'hover:bg-card-hover'
                                                      }`}
                                                      onClick={(e) => {
                                                        if (isEditing) return;
                                                        handleTableCellSelect(cellKey, e, allCellKeys);
                                                        if (pageNum && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                                                          setCurrentPage(pageNum);
                                                        }
                                                      }}
                                                      onDoubleClick={() => {
                                                        setEditingSplitCell({ sectionIdx: sectionIndex, rowIdx: editRowIdx, col });
                                                        setEditingSplitCellValue(cell?.value || '');
                                                      }}
                                                    >
                                                      {isEditing ? (
                                                        <div className="flex items-center gap-1">
                                                          <input
                                                            type="text"
                                                            autoFocus
                                                            value={editingSplitCellValue}
                                                            onChange={(e) => setEditingSplitCellValue(e.target.value)}
                                                            onBlur={() => {
                                                              handleUpdateSplitCell(sectionIndex, editRowIdx, col, editingSplitCellValue);
                                                            }}
                                                            onKeyDown={(e) => {
                                                              if (e.key === 'Enter') {
                                                                handleUpdateSplitCell(sectionIndex, editRowIdx, col, editingSplitCellValue);
                                                              } else if (e.key === 'Escape') {
                                                                setEditingSplitCell(null);
                                                                setEditingSplitCellValue('');
                                                              }
                                                            }}
                                                            className="flex-1 bg-transparent border-b border-accent outline-none text-[11px] min-w-0"
                                                            onClick={(e) => e.stopPropagation()}
                                                          />
                                                          {selectedPdfElements.size > 0 && (
                                                            <button
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleApplyPdfToCell(sectionIndex, editRowIdx, col);
                                                              }}
                                                              className="px-1 py-0.5 text-[9px] bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 whitespace-nowrap"
                                                              title="Paste from PDF selection"
                                                            >
                                                              Paste PDF
                                                            </button>
                                                          )}
                                                        </div>
                                                      ) : (
                                                        formatCheckboxValue(cell?.value) || <span className="text-muted/50">—</span>
                                                      )}
                                                    </td>
                                                  );
                                                })}
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    {dataRows.length > 50 && (
                                      <div className="px-2 py-1 text-[10px] text-muted bg-app-secondary">
                                        +{dataRows.length - 50} more rows
                                      </div>
                                    )}
                                  </div>
                                );

                                // Update global index for next chunk
                                globalRowIndex += dataRows.length;
                                return tableElement;
                              }
                            })}
                          </div>
                        );
                      })()}
                      {/* Insertion zone after this section */}
                      {showInsertionZones && selectedPdfElements.size > 0 && (
                        <button
                          onClick={() => handleCreateQATable(sectionIndex)}
                          className="w-full py-3 mt-2 border-2 border-dashed border-purple-500/50 rounded-lg text-purple-400 text-[12px] hover:bg-purple-500/10 hover:border-purple-500 transition-colors flex items-center justify-center gap-2"
                        >
                          <Plus size={16} />
                          Create Q&A Table Here ({selectedPdfElements.size} element{selectedPdfElements.size !== 1 ? 's' : ''})
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted text-center py-8 text-[12px]">No sections found</div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* PDF File View */}
      {activeTab === 'file' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* PDF Controls */}
          {numPages > 0 && (
            <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-app-secondary">
              {/* Page navigation */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  ←
                </button>
                <span className="text-[11px] text-muted whitespace-nowrap">
                  {currentPage}/{numPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                  disabled={currentPage >= numPages}
                  className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                >
                  →
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Hide annotation controls in Vision mode - no bounding box data available */}
                {extractionView !== 'vision' && (
                  <>
                    <button
                      onClick={() => setShowAnnotationEditor(true)}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30 transition-colors"
                      title="Annotate this page - add missing tables/data for training"
                    >
                      <PencilSimpleLine size={14} />
                      Annotate
                    </button>
                    <button
                      onClick={() => setShowAllBoxes(!showAllBoxes)}
                      className={`px-2 py-1 text-[11px] rounded transition-colors ${
                        showAllBoxes
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-muted hover:text-primary'
                      }`}
                    >
                      {showAllBoxes ? 'Hide Boxes' : 'Show Boxes'}
                    </button>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
                    className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded"
                  >
                    −
                  </button>
                  <span className="text-[11px] text-muted">{Math.round(scale * 100)}%</span>
                  <button
                    onClick={() => setScale(s => Math.min(3, s + 0.25))}
                    className="px-2 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 rounded"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PDF Canvas */}
          <div ref={pdfContainerRef} className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex items-start justify-center p-4">
            {pdfLoading && (
              <div className="text-muted text-center py-12">Loading PDF...</div>
            )}
            {pdfError && (
              <div className="text-red-500 text-center py-12">{pdfError}</div>
            )}
            {!pdfLoading && !pdfError && !pdfDoc && (
              <div className="text-muted text-center py-12">
                {questionnaireId ? 'No PDF available' : 'Select a questionnaire'}
              </div>
            )}
            {pdfDoc && (
              <div className="relative inline-block shadow-lg">
                <canvas ref={canvasRef} className="bg-white" />
                <div ref={overlayRef} className="absolute top-0 left-0 pointer-events-auto" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table View (existing content) */}
      {activeTab === 'view' && (
        <div className="flex-1 overflow-y-auto">
        {processedSections.length > 0 ? (
          <div className="space-y-6 p-4">
            {processedSections.map((section, sectionIndex) => (
              <div key={sectionIndex} className="space-y-3">
                {/* Section Header */}
                <div className="border-b border-default pb-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[14px] font-semibold text-primary">
                      {section.title}
                    </h3>
                    {section.pageLabel && (
                      <span className="text-[11px] text-muted">
                        {section.pageLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Collapsible descriptive text - clean paragraphs only */}
                {(section as any).textContent?.paragraphs?.length > 0 && (
                  <div className="mb-3">
                    <button
                      onClick={() => toggleSectionExpanded(sectionIndex)}
                      className="flex items-center gap-1.5 text-[12px] text-muted hover:text-primary transition-colors"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${
                          expandedSections.has(sectionIndex) ? 'rotate-90' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span>Description</span>
                    </button>

                    {expandedSections.has(sectionIndex) && (
                      <div className="mt-2 pl-4 space-y-2 border-l-2 border-subtle">
                        {(section as any).textContent.paragraphs.map((paragraph: any, pIndex: number) => (
                          <p key={pIndex} className="text-[12px] text-muted leading-relaxed">
                            {paragraph.content}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Render HTML table using Azure role information */}
                {section.type === 'raw_structure' && (() => {
                  if (!section.rows || section.rows.length === 0) {
                    return (
                      <div className="bg-card rounded-lg border border-subtle overflow-hidden">
                        <div className="p-4 text-center text-muted">
                          <p>No table data available</p>
                        </div>
                      </div>
                    );
                  }

                  // Group consecutive rows into chunks to preserve document order
                  // A chunk is either: text rows OR table rows (header + data)
                  type ContentChunk =
                    | { type: 'text'; rows: typeof section.rows }
                    | { type: 'table'; headerRows: typeof section.rows; dataRows: typeof section.rows; columns: string[] };

                  const chunks: ContentChunk[] = [];
                  let currentTextRows: typeof section.rows = [];
                  let currentTableRows: typeof section.rows = [];

                  const flushTable = () => {
                    if (currentTableRows.length > 0) {
                      const headerRows = currentTableRows.filter(r => r.rowType === 'header');
                      const dataRows = currentTableRows.filter(r => r.rowType !== 'header' && !r.isEmpty);
                      const allColumns = new Set<string>();
                      currentTableRows.forEach(row => {
                        Object.keys(row.cells || {}).forEach(col => allColumns.add(col));
                      });
                      chunks.push({
                        type: 'table',
                        headerRows,
                        dataRows,
                        columns: Array.from(allColumns).sort()
                      });
                      currentTableRows = [];
                    }
                  };

                  const flushText = () => {
                    if (currentTextRows.length > 0) {
                      chunks.push({ type: 'text', rows: currentTextRows });
                      currentTextRows = [];
                    }
                  };

                  // Check if a text row is page header noise (should be skipped entirely)
                  const isPageHeaderNoise = (row: typeof section.rows[0]): boolean => {
                    const values = Object.values(row.cells || {}).map((c: any) => c?.value?.trim() || '').filter(Boolean);
                    const combined = values.join(' ').toLowerCase();
                    if (/docusign/i.test(combined)) return true;
                    if (/^barry\s*callebaut$/i.test(combined)) return true;
                    if (/raw material questionnaire/i.test(combined)) return true;
                    if (/^\d{2}\/\d{2}\/\d{4}$/.test(combined)) return true;
                    if (/^[A-F0-9-]{20,}$/i.test(combined)) return true;
                    if (combined.length < 20 && combined === combined.toUpperCase() && !combined.includes('(')) return true;
                    return false;
                  };

                  // Check if a text row looks like table data continuation
                  // Be conservative - only merge if it's clearly the same table structure
                  const looksLikeTableContinuation = (row: typeof section.rows[0], prevTableRows: typeof section.rows): boolean => {
                    const cellA = row.cells?.['A']?.value?.trim() || '';

                    // Has unit label pattern like "(mg/100g)", "(µg/100g)", "(kcal)", "(g)", "(%)"
                    if (/\((mg|µg|ug|g|kcal|kJ|%|ml|l)\/?\d*\w*\)/i.test(cellA)) return true;

                    // Check if first column pattern matches previous table
                    // If previous table has numeric first column (1, 2, 3...) and this row has text, it's a new table
                    if (prevTableRows.length > 0) {
                      const prevFirstColValues = prevTableRows
                        .map(r => r.cells?.['A']?.value?.trim() || '')
                        .filter(Boolean);

                      // Check if previous table used numeric identifiers
                      const prevHasNumericPattern = prevFirstColValues.some(v => /^\d+\.?$/.test(v));
                      const currentIsNumeric = /^\d+\.?$/.test(cellA);

                      // If previous was numeric but current is long text label, it's a new table
                      if (prevHasNumericPattern && !currentIsNumeric && cellA.length > 10) {
                        return false;
                      }
                    }

                    // Only merge if it has the same column structure (same number of filled cells)
                    const filledCount = Object.values(row.cells || {}).filter((c: any) => c?.value?.trim()).length;
                    if (prevTableRows.length > 0 && filledCount >= 2) {
                      // Check if column count matches
                      const prevFilledCounts = prevTableRows.slice(-3).map(r =>
                        Object.values(r.cells || {}).filter((c: any) => c?.value?.trim()).length
                      );
                      const avgPrevFilled = prevFilledCounts.reduce((a, b) => a + b, 0) / prevFilledCounts.length;
                      // If column count is similar, it might be continuation
                      if (Math.abs(filledCount - avgPrevFilled) <= 1) {
                        // But check if content pattern is similar
                        const currentFirstColIsLabel = cellA.length > 15 && !(/^\d+\.?$/.test(cellA));
                        const prevFirstColIsLabel = prevTableRows.some(r => {
                          const v = r.cells?.['A']?.value?.trim() || '';
                          return v.length > 15 && !(/^\d+\.?$/.test(v));
                        });
                        // Only merge if both have label-style first column, or both have numeric
                        if (currentFirstColIsLabel === prevFirstColIsLabel) {
                          return true;
                        }
                      }
                    }

                    return false;
                  };

                  // Process rows in order, grouping by type
                  for (const row of section.rows) {
                    if (row.isEmpty) continue;

                    if (row.rowType === 'text') {
                      // Skip page header noise entirely (don't break tables or show as text)
                      if (isPageHeaderNoise(row)) {
                        continue;
                      }
                      // If there's a table in progress and this looks like table continuation, include it
                      if (currentTableRows.length > 0 && looksLikeTableContinuation(row, currentTableRows)) {
                        currentTableRows.push({ ...row, rowType: 'data' });
                        continue;
                      }
                      // Otherwise, it's actual text content
                      flushTable();
                      currentTextRows.push(row);
                    } else {
                      // Table rows (header/data) go to table chunks
                      flushText();
                      currentTableRows.push(row);
                    }
                  }
                  // Flush any remaining rows
                  flushText();
                  flushTable();

                  return (
                    <div className="space-y-4">
                      {chunks.map((chunk, chunkIdx) => {
                        if (chunk.type === 'text') {
                          // Only show actual prose/instruction text, not table spillover
                          // Be aggressive about filtering - better to show nothing than garbage
                          const isActualProse = (text: string): boolean => {
                            if (!text || text.length < 15) return false;
                            // Filter Docusign metadata and envelope IDs
                            if (/docusign/i.test(text)) return false;
                            if (/^[A-F0-9]{8,}$/i.test(text)) return false; // Hex IDs
                            // Filter page markers
                            if (/^page\s*\d+/i.test(text)) return false;
                            // Filter repeated words (table spillover like "No No No No")
                            const words = text.split(/\s+/);
                            if (words.length >= 3) {
                              const uniqueWords = new Set(words.map(w => w.toLowerCase()));
                              if (uniqueWords.size <= 2) return false;
                            }
                            // Filter short standalone words (brand names, fragments)
                            if (text.length < 20 && !text.includes(' ')) return false;
                            // Filter checkbox values
                            if (/^(yes|no|n\/a|—|x|✓|✗)$/i.test(text)) return false;
                            // Filter date patterns
                            if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return false;
                            // Must look like a sentence (has punctuation or multiple words and decent length)
                            const hasSentenceStructure = text.length >= 40 && text.includes(' ');
                            const looksLikeInstruction = /please|must|should|complete|table|section|note|important/i.test(text);
                            return hasSentenceStructure || looksLikeInstruction;
                          };

                          // Collect only genuine prose content
                          const proseItems: string[] = [];

                          for (const textRow of chunk.rows) {
                            // Combine all cell values
                            const cellValues = Object.values(textRow.cells || {})
                              .map((c: any) => c?.value?.trim())
                              .filter(Boolean);
                            const combined = cellValues.join(' ').trim();
                            if (isActualProse(combined)) {
                              proseItems.push(combined);
                            }
                          }

                          // Deduplicate and skip empty
                          const uniqueProse = [...new Set(proseItems)];
                          if (uniqueProse.length === 0) return null;

                          return (
                            <div key={`text-chunk-${chunkIdx}`} className="text-[13px] leading-relaxed space-y-2 text-muted italic border-l-2 border-subtle pl-3 my-2">
                              {uniqueProse.map((text, idx) => (
                                <p key={idx}>{text}</p>
                              ))}
                            </div>
                          );
                        } else {
                          // Table chunk
                          const { headerRows, dataRows, columns } = chunk;
                          if (headerRows.length === 0 && dataRows.length === 0) return null;

                          const isEditing = editingTable?.sectionIndex === sectionIndex && editingTable?.tableIndex === chunkIdx;

                          return (
                            <div key={`table-chunk-${chunkIdx}`} className="bg-card rounded-lg border border-subtle overflow-hidden">
                              {/* Table Header with Edit Button */}
                              <div className="px-3 py-2 bg-app-secondary border-b border-default flex items-center justify-between">
                                <span className="text-[11px] text-muted">
                                  {dataRows.length} row{dataRows.length !== 1 ? 's' : ''} × {columns.length} column{columns.length !== 1 ? 's' : ''}
                                  {isEditing && newRows.length > 0 && <span className="text-accent ml-1">+{newRows.length} new</span>}
                                  {isEditing && deletedRows.size > 0 && <span className="text-red-400 ml-1">-{deletedRows.size} deleted</span>}
                                </span>
                                <div className="flex items-center gap-2">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={() => handleAddRow(columns)}
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
                                        onClick={cancelEditingTable}
                                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-muted/20 text-muted hover:bg-muted/30 rounded transition-colors"
                                      >
                                        <X size={12} weight="bold" />
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleSaveTableEdits(sectionIndex, chunkIdx)}
                                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors"
                                      >
                                        <Check size={12} weight="bold" />
                                        Save
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => startEditingTable(sectionIndex, chunkIdx)}
                                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-muted/20 text-muted hover:bg-muted/30 rounded transition-colors"
                                      title="Edit table"
                                    >
                                      <PencilSimple size={12} />
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Unassigned Items Pool */}
                              {isEditing && showItemPool && unassignedItems.length > 0 && (
                                <div className="px-3 py-2 bg-blue-500/5 border-b border-blue-500/20 max-h-32 overflow-y-auto">
                                  <div className="text-[10px] text-blue-400 font-medium mb-1">
                                    Unassigned Items (drag to cells)
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {unassignedItems.slice(0, 20).map((item, idx) => (
                                      <div
                                        key={item.id || idx}
                                        className="px-2 py-1 bg-blue-500/10 text-[10px] text-blue-300 rounded cursor-grab hover:bg-blue-500/20 max-w-[200px] truncate"
                                        title={`${item.label}: ${item.value}`}
                                        draggable
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData('application/json', JSON.stringify(item));
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

                              <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                  {headerRows.length > 0 && (
                                    <thead>
                                      {headerRows.map((headerRow, rowIndex) => (
                                        <tr key={`header-${rowIndex}`} className="bg-app-secondary">
                                          {columns.map(col => {
                                            const cell = headerRow.cells?.[col];
                                            const isActiveCell = activeCell && cell?.ref === activeCell;
                                            const isSearchMatch = cell?.ref && searchResultRefs.has(cell.ref);
                                            const isCurrentSearchMatch = cell?.ref && cell.ref === currentSearchRef;
                                            return (
                                              <th
                                                key={col}
                                                ref={(el) => {
                                                  if (el && cell?.ref) cellRefs.current.set(cell.ref, el);
                                                }}
                                                className={`px-3 py-2 text-[13px] border-r border-subtle last:border-r-0 font-medium text-muted text-left cursor-pointer hover:bg-card-hover ${
                                                  isCurrentSearchMatch
                                                    ? 'bg-yellow-500/30 ring-2 ring-yellow-500 ring-inset'
                                                    : isSearchMatch
                                                      ? 'bg-yellow-400/20'
                                                      : isActiveCell
                                                        ? 'bg-selected ring-1 ring-accent/50 ring-inset'
                                                        : ''
                                                }`}
                                                onClick={() => handleCellClick(cell?.ref || `${col}${headerRow.row}`, headerRow.row, col)}
                                              >
                                                <div className="min-h-[18px] flex items-start">
                                                  {cell?.value && cell.value.length > 0 ? (
                                                    formatCheckboxValue(cell.value)
                                                  ) : (
                                                    <span className="text-muted/50">—</span>
                                                  )}
                                                </div>
                                              </th>
                                            );
                                          })}
                                          {isEditing && <th className="w-8"></th>}
                                        </tr>
                                      ))}
                                    </thead>
                                  )}
                                  <tbody>
                                    {dataRows.map((dataRow, rowIndex) => {
                                      // Skip deleted rows
                                      if (isEditing && deletedRows.has(rowIndex)) return null;

                                      return (
                                        <tr
                                          key={`data-${rowIndex}`}
                                          className={`border-b border-subtle hover:bg-card-hover transition-colors ${isEditing ? 'group' : ''}`}
                                        >
                                          {columns.map((col, colIndex) => {
                                            const cell = dataRow.cells?.[col];
                                            const isLabelCell = cell?.role === 'label';
                                            const isActiveCell = activeCell && cell?.ref === activeCell;
                                            const isSearchMatch = cell?.ref && searchResultRefs.has(cell.ref);
                                            const isCurrentSearchMatch = cell?.ref && cell.ref === currentSearchRef;
                                            const isEditingThisCell = isEditing && editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex;
                                            const editedValue = isEditing ? getEditedCellValue(rowIndex, col, cell?.value || '') : (cell?.value || '');

                                            return (
                                              <td
                                                key={col}
                                                ref={(el) => {
                                                  if (el && cell?.ref) cellRefs.current.set(cell.ref, el);
                                                }}
                                                className={`px-3 py-2 text-[13px] border-r border-subtle last:border-r-0 ${
                                                  isLabelCell ? 'font-medium text-muted' : 'text-primary'
                                                } ${
                                                  isCurrentSearchMatch
                                                    ? 'bg-yellow-500/30 ring-2 ring-yellow-500 ring-inset'
                                                    : isSearchMatch
                                                      ? 'bg-yellow-400/20'
                                                      : isActiveCell
                                                        ? 'bg-selected ring-1 ring-accent/50 ring-inset'
                                                        : ''
                                                } ${isEditing ? 'cursor-text' : 'cursor-pointer'} transition-colors hover:bg-card-hover`}
                                                onClick={() => {
                                                  if (isEditing) {
                                                    setEditingCell({ rowIndex, colIndex });
                                                  } else {
                                                    handleCellClick(cell?.ref || `${col}${dataRow.row}`, dataRow.row, col);
                                                  }
                                                }}
                                                onDrop={(e) => {
                                                  if (!isEditing) return;
                                                  e.preventDefault();
                                                  try {
                                                    const itemData = e.dataTransfer.getData('application/json');
                                                    if (itemData) {
                                                      const item = JSON.parse(itemData) as IndexedItem;
                                                      handleAddItemToCell(item, rowIndex, col, false);
                                                    }
                                                  } catch {}
                                                }}
                                                onDragOver={(e) => isEditing && e.preventDefault()}
                                              >
                                                <div className="min-h-[18px] flex items-start">
                                                  {isEditingThisCell ? (
                                                    <input
                                                      type="text"
                                                      autoFocus
                                                      className="w-full bg-transparent border-b border-accent outline-none text-primary text-[13px]"
                                                      value={editedValue}
                                                      onChange={(e) => handleCellEdit(rowIndex, col, e.target.value)}
                                                      onBlur={() => setEditingCell(null)}
                                                      onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
                                                    />
                                                  ) : editedValue && editedValue.length > 0 ? (
                                                    formatCheckboxValue(editedValue)
                                                  ) : (
                                                    <span className="text-muted/50">—</span>
                                                  )}
                                                </div>
                                              </td>
                                            );
                                          })}
                                          {/* Delete row button */}
                                          {isEditing && (
                                            <td className="px-2 w-8">
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
                                    {isEditing && newRows.map((newRow, newRowIndex) => (
                                      <tr key={`new-${newRowIndex}`} className="border-b border-subtle bg-accent/5 group">
                                        {columns.map((col) => (
                                          <td
                                            key={col}
                                            className="px-3 py-2 cursor-text hover:bg-accent/10"
                                            onDrop={(e) => {
                                              e.preventDefault();
                                              try {
                                                const itemData = e.dataTransfer.getData('application/json');
                                                if (itemData) {
                                                  const item = JSON.parse(itemData) as IndexedItem;
                                                  handleAddItemToCell(item, newRowIndex, col, true);
                                                }
                                              } catch {}
                                            }}
                                            onDragOver={(e) => e.preventDefault()}
                                          >
                                            <input
                                              type="text"
                                              className="w-full bg-transparent border-b border-accent/30 focus:border-accent outline-none text-primary placeholder:text-muted/50 text-[13px]"
                                              value={newRow[col] || ''}
                                              onChange={(e) => handleNewRowCellEdit(newRowIndex, col, e.target.value)}
                                              placeholder={`${col}...`}
                                            />
                                          </td>
                                        ))}
                                        <td className="px-2 w-8">
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
                            </div>
                          );
                        }
                      })}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-center py-12 text-[13px]">
            No sections found
          </div>
        )}
        </div>
      )}

      {/* Markdown View (Vision Extraction) - PDF left, Markdown right */}
      {activeTab === 'markdown' && visionExtraction && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: PDF */}
          <div className="w-1/2 flex flex-col overflow-hidden border-r border-default">
            {/* PDF Controls */}
            {numPages > 0 && (
              <div className="h-10 px-3 flex items-center justify-between border-b border-default bg-app-secondary">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                  >
                    ←
                  </button>
                  <span className="text-[10px] text-muted">{currentPage}/{numPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage >= numPages}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                  >
                    →
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="px-1 text-[10px] bg-gray-100 dark:bg-gray-700 rounded">−</button>
                    <span className="text-[10px] text-muted">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="px-1 text-[10px] bg-gray-100 dark:bg-gray-700 rounded">+</button>
                  </div>
                </div>
              </div>
            )}
            <div ref={pdfContainerRef} className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex items-start justify-center p-2" style={{ overscrollBehavior: 'contain' }}>
              {pdfLoading && <div className="text-muted text-center py-8 text-[12px]">Loading PDF...</div>}
              {pdfError && <div className="text-red-500 text-center py-8 text-[12px]">{pdfError}</div>}
              {!pdfLoading && !pdfError && !pdfDoc && (
                <div className="text-muted text-center py-8 text-[12px]">
                  {questionnaireId ? 'No PDF available' : 'Select a questionnaire'}
                </div>
              )}
              {pdfDoc && (
                <div className="relative inline-block shadow-lg">
                  <canvas ref={canvasRef} className="bg-white" />
                  <div ref={overlayRef} className="absolute top-0 left-0 pointer-events-auto" />
                </div>
              )}
            </div>
          </div>

          {/* Right: Vision Extraction Data */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="h-10 px-4 flex items-center justify-between border-b border-default bg-purple-500/10">
              <div className="flex items-center gap-2">
                <Code size={16} className="text-purple-400" />
                <span className="text-[13px] font-medium text-purple-300">Vision Extraction</span>
                {/* View mode toggle - only show for markdown format */}
                {visionExtraction.markdown && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => setMarkdownViewMode('rendered')}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                        markdownViewMode === 'rendered'
                          ? 'bg-purple-500/30 text-purple-300'
                          : 'text-muted hover:text-purple-300 hover:bg-purple-500/10'
                      }`}
                      title="Render markdown with formatted tables"
                    >
                      Rendered
                    </button>
                    <button
                      onClick={() => setMarkdownViewMode('raw')}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                        markdownViewMode === 'raw'
                          ? 'bg-purple-500/30 text-purple-300'
                          : 'text-muted hover:text-purple-300 hover:bg-purple-500/10'
                      }`}
                      title="Show raw markdown text"
                    >
                      Raw
                    </button>
                  </div>
                )}
                {/* Q&A count for new format */}
                {visionExtraction.qaPairs && (
                  <span className="ml-2 px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded">
                    {visionExtraction.qaPairs.length} Q&A pairs
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted">
                {visionExtraction.metadata?.pageCount && (
                  <span>{visionExtraction.metadata.pageCount} pages</span>
                )}
                {visionExtraction.metadata?.processingTimeMs && (
                  <span>• {(visionExtraction.metadata.processingTimeMs / 1000).toFixed(1)}s</span>
                )}
                {visionExtraction.metadata?.modelId && (
                  <span>• {visionExtraction.metadata.modelId.split('/').pop()?.split(':')[0]}</span>
                )}
              </div>
            </div>
            {/* Content - New Q&A format or Legacy Markdown */}
            {visionExtraction.qaPairs ? (
              // New Q&A pairs format - grouped by section with collapsible headers
              <div className="flex-1 overflow-y-auto">
                {/* Group Q&A pairs by section */}
                {(() => {
                  const bySection = visionExtraction.qaPairs!.reduce((acc, qa) => {
                    const section = qa.section || 'Uncategorized';
                    if (!acc[section]) acc[section] = [];
                    acc[section].push(qa);
                    return acc;
                  }, {} as Record<string, VisionQAPair[]>);

                  // Build clean question label
                  const buildLabel = (qa: VisionQAPair) => {
                    const parts: string[] = [];
                    if (qa.metadata?.rowContext) {
                      parts.push(qa.metadata.rowContext);
                    }
                    // Use column header if different from question, otherwise use question
                    if (qa.metadata?.columnHeader && qa.metadata.columnHeader !== qa.question) {
                      parts.push(qa.metadata.columnHeader);
                    } else if (qa.question) {
                      parts.push(qa.question);
                    }
                    return parts.join(' - ') || qa.question;
                  };

                  return Object.entries(bySection).map(([section, pairs], sectionIdx) => {
                    const isExpanded = expandedVisionSections.has(sectionIdx);
                    return (
                      <div key={section} className="border-b border-subtle last:border-b-0">
                        {/* Collapsible section header */}
                        <button
                          onClick={() => {
                            setExpandedVisionSections(prev => {
                              const next = new Set(prev);
                              if (next.has(sectionIdx)) {
                                next.delete(sectionIdx);
                              } else {
                                next.add(sectionIdx);
                              }
                              return next;
                            });
                          }}
                          className="w-full px-4 py-2.5 bg-app-secondary/50 hover:bg-app-secondary transition-colors flex items-center gap-2 text-left"
                        >
                          <span className={`text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          <span className="flex-1 text-[12px] font-medium text-primary">{section}</span>
                          <span className="text-[10px] text-muted px-2 py-0.5 bg-app rounded">{pairs!.length}</span>
                        </button>
                        {/* Section content */}
                        {isExpanded && (
                          <div className="divide-y divide-subtle/50">
                            {pairs!.map((qa, idx) => (
                              <div key={idx} className="px-4 py-2 hover:bg-app-secondary/30 transition-colors">
                                <div className="text-[11px] text-muted mb-1">
                                  {buildLabel(qa)}
                                </div>
                                <div className="text-[12px] text-primary font-medium">
                                  {qa.answer || <span className="text-muted/50 italic font-normal">—</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : visionExtraction.markdown ? (
              // Legacy markdown format
              markdownViewMode === 'rendered' ? (
                <div className="flex-1 overflow-y-auto p-4 bg-app prose prose-sm prose-invert max-w-none
                  prose-headings:text-primary prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
                  prose-h1:text-[16px] prose-h2:text-[14px] prose-h3:text-[13px]
                  prose-p:text-[12px] prose-p:text-muted prose-p:my-2 prose-p:leading-relaxed
                  prose-table:text-[11px] prose-table:border-collapse prose-table:w-full prose-table:my-3
                  prose-th:bg-app-secondary prose-th:border prose-th:border-subtle prose-th:px-2 prose-th:py-1.5 prose-th:text-left prose-th:font-medium prose-th:text-muted
                  prose-td:border prose-td:border-subtle prose-td:px-2 prose-td:py-1.5 prose-td:text-primary
                  prose-strong:text-primary prose-strong:font-semibold
                  prose-ul:my-2 prose-ul:pl-4 prose-li:text-[12px] prose-li:text-muted
                  prose-code:text-[11px] prose-code:bg-app-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                ">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {visionExtraction.markdown}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 bg-app">
                  <pre className="text-[11px] text-primary font-mono whitespace-pre-wrap leading-relaxed">
                    {visionExtraction.markdown}
                  </pre>
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted text-[12px]">
                No vision extraction data available
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table Annotation Editor Modal */}
      <TableAnnotationEditor
        visible={showAnnotationEditor}
        pageNumber={currentPage}
        onSave={(tables, pageNotes) => {
          if (onSaveAnnotation) {
            onSaveAnnotation(currentPage, tables, pageNotes);
          }
          setShowAnnotationEditor(false);
        }}
        onCancel={() => setShowAnnotationEditor(false)}
      />

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2 text-[13px] font-medium transition-all ${
            toast.type === 'error'
              ? 'bg-red-500 text-white'
              : toast.type === 'success'
                ? 'bg-emerald-500 text-white'
                : 'bg-blue-500 text-white'
          }`}
        >
          {toast.type === 'error' && <X size={16} weight="bold" />}
          {toast.type === 'success' && <Check size={16} weight="bold" />}
          {toast.message}
          <button
            onClick={() => setToast(null)}
            className="ml-2 hover:opacity-70"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export const OriginalPanel = forwardRef(OriginalPanelInner);