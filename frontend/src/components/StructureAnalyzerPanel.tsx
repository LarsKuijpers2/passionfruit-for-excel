import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, List, CircleNotch, Table, FileText, Download, CaretDown, CaretRight } from "@phosphor-icons/react";

interface StructureFile {
  customer: string;
  file: string;
  path: string;
}

interface Cell {
  ref: string;
  value: string;
  type: string;
  filled: boolean;
  role?: 'label' | 'value' | 'header' | 'empty';
  format?: {
    bold?: boolean;
    fontSize?: number;
    isMerged?: boolean;
    isMergeOrigin?: boolean;
    mergeRange?: string; // e.g., "A3:C3"
  };
}

interface Row {
  row: number;
  cells: Record<string, Cell>;
  isEmpty: boolean;
  rowType?: 'header' | 'data' | 'section';
}

interface Sheet {
  name: string;
  index: number;
  rows: Row[];
}

interface StructureData {
  source: {
    filename: string;
    filepath: string;
    documentType: string;
  };
  sheets: Sheet[];
}

interface Section {
  id: string;
  title: string;
  startRowIdx: number;
  endRowIdx: number;
  rows: Row[];
  columns: string[];
  columnTypes: Record<string, 'label' | 'value' | 'ignore'>;
  collapsed: boolean;
}

interface StructureAnalyzerPanelProps {
  customer: string;
  onBack: () => void;
  onSidebarToggle: () => void;
}

// Fetch list of structure files
async function fetchStructureFiles(): Promise<{ files: StructureFile[] }> {
  const res = await fetch("/api/structure-files");
  if (!res.ok) throw new Error("Failed to fetch structure files");
  return res.json();
}

// Fetch a specific structure file
async function fetchStructureFile(path: string): Promise<StructureData> {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Failed to fetch structure file");
  return res.json();
}

function Header({ customer, onBack, onSidebarToggle }: { customer: string; onBack: () => void; onSidebarToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-app-secondary border-b border-default">
      <button onClick={onSidebarToggle} className="p-1.5 hover:bg-hover rounded">
        <List className="w-4 h-4" />
      </button>
      <button onClick={onBack} className="p-1.5 hover:bg-hover rounded">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <Table className="w-4 h-4 text-accent" />
      <span className="text-[13px] font-medium">Structure Analyzer</span>
      <span className="text-[12px] text-muted">/ {customer}</span>
    </div>
  );
}

// Sort columns: A, B, C, ..., Z, AA, AB, ...
function sortColumns(a: string, b: string) {
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

// Check if a cell is a merged non-origin (should be skipped)
function isMergedNonOrigin(cell: Cell | undefined): boolean {
  return cell?.format?.isMerged === true && cell?.format?.isMergeOrigin === false;
}

// Get merge span for a cell (e.g., "A3:C3" -> { startCol: 'A', endCol: 'C' })
function getMergeSpan(cell: Cell | undefined): { startCol: string; endCol: string } | null {
  if (!cell?.format?.mergeRange) return null;
  const match = cell.format.mergeRange.match(/^([A-Z]+)\d+:([A-Z]+)\d+$/);
  if (!match) return null;
  return { startCol: match[1], endCol: match[2] };
}

// Analyze column for a specific set of rows
function analyzeColumnForRows(col: string, rows: Row[]): 'label' | 'value' | 'ignore' {
  let roleLabels = 0;
  let roleValues = 0;
  let filledCells = 0;
  let checkboxes = 0;
  let longText = 0;
  let shortText = 0;
  let mergedCells = 0;

  rows.forEach(row => {
    const cell = row.cells?.[col];
    if (!cell) return;

    // Skip merged non-origin cells (they duplicate the origin value)
    if (isMergedNonOrigin(cell)) {
      mergedCells++;
      return;
    }

    const value = (cell.value || '').trim();
    if (value) {
      filledCells++;
      if (value.length > 30) longText++;
      else shortText++;
    }

    if (cell.role === 'label') roleLabels++;
    if (cell.role === 'value') roleValues++;
    if (/[☒☐✓✗✔✘Xx]/.test(value) && value.length < 5) checkboxes++;
  });

  // If most cells are merged non-origins, this column is probably part of merged ranges
  if (mergedCells > rows.length * 0.5) return 'ignore';

  // Use existing role metadata if strong signal
  if (roleLabels > roleValues && roleLabels > filledCells * 0.5) return 'label';
  if (roleValues > roleLabels && roleValues > filledCells * 0.5) return 'value';

  // Heuristics
  if (checkboxes > filledCells * 0.3) return 'value';
  if (longText > shortText) return 'label';
  if (col === 'A' && filledCells > 0) return 'label';
  if (col === 'B' && filledCells > 0 && rows.every(r => (r.cells?.[col]?.value || '').trim() === ':')) return 'ignore';

  return 'value';
}

// Detect sections from rows
function detectSections(rows: Row[]): Section[] {
  const sections: Section[] = [];
  let currentSection: { title: string; startIdx: number; rows: Row[] } = {
    title: 'Document Header',
    startIdx: 0,
    rows: []
  };

  const saveCurrentSection = (endIdx: number) => {
    if (currentSection.rows.length > 0) {
      const columns = new Set<string>();
      currentSection.rows.forEach((r: Row) => Object.keys(r.cells || {}).forEach(c => columns.add(c)));
      const sortedCols = Array.from(columns).sort(sortColumns);

      const columnTypes: Record<string, 'label' | 'value' | 'ignore'> = {};
      sortedCols.forEach(col => {
        columnTypes[col] = analyzeColumnForRows(col, currentSection.rows);
      });

      sections.push({
        id: `section-${sections.length}`,
        title: currentSection.title,
        startRowIdx: currentSection.startIdx,
        endRowIdx: endIdx,
        rows: currentSection.rows,
        columns: sortedCols,
        columnTypes,
        collapsed: false,
      });
    }
  };

  rows.forEach((row, idx) => {
    const cells = Object.values(row.cells || {});
    const nonEmpty = cells.filter(c => (c.value || '').trim());
    const firstCell = cells[0];
    const firstValue = (firstCell?.value || '').trim();

    // Detect section header
    let isHeader = false;
    let headerTitle = '';

    // Check rowType metadata
    if (row.rowType === 'section' || row.rowType === 'header') {
      isHeader = true;
      headerTitle = firstValue;
    }

    // Bold + merged or single cell with short text
    if (!isHeader && firstCell?.format?.bold && (firstCell.format?.isMerged || nonEmpty.length === 1)) {
      if (firstValue.length < 100) {
        isHeader = true;
        headerTitle = firstValue;
      }
    }

    // Numbered header: "1. Section", "1) Section"
    if (!isHeader && nonEmpty.length === 1 && /^[0-9]+[\.\)\-\s]/.test(firstValue) && firstValue.length < 80) {
      isHeader = true;
      headerTitle = firstValue;
    }

    // All caps header
    if (!isHeader && nonEmpty.length === 1 && firstValue === firstValue.toUpperCase() &&
        firstValue.length > 3 && firstValue.length < 60 && /[A-Z]/.test(firstValue)) {
      isHeader = true;
      headerTitle = firstValue;
    }

    if (isHeader && headerTitle) {
      // Save previous section
      saveCurrentSection(idx - 1);
      currentSection = { title: headerTitle, startIdx: idx, rows: [] };
      return;
    }

    currentSection.rows.push(row);
  });

  // Don't forget last section
  saveCurrentSection(rows.length - 1);

  return sections;
}

// Extract Q&A pairs for a section
function extractQAPairsForSection(section: Section): Array<{ row: number; label: string; value: string }> {
  const labelCols = section.columns.filter(c => section.columnTypes[c] === 'label');
  const valueCols = section.columns.filter(c => section.columnTypes[c] === 'value');

  if (!labelCols.length || !valueCols.length) return [];

  const pairs: Array<{ row: number; label: string; value: string }> = [];

  section.rows.forEach(row => {
    if (row.rowType === 'header' || row.rowType === 'section') return;

    // Get label - skip merged non-origins
    const labelParts: string[] = [];
    labelCols.forEach(col => {
      const cell = row.cells?.[col];
      if (isMergedNonOrigin(cell)) return;
      const val = (cell?.value || '').trim();
      if (val) labelParts.push(val);
    });
    const label = labelParts.join(' > ');
    if (!label) return;

    // Get values - skip merged non-origins
    const valueParts: string[] = [];
    valueCols.forEach(col => {
      const cell = row.cells?.[col];
      if (isMergedNonOrigin(cell)) return;
      const val = (cell?.value || '').trim();
      if (val) valueParts.push(val);
    });
    let value = valueParts.join(' | ') || '(no value)';

    // Normalize checkboxes
    if (/^[☒✓✔Xx]$/.test(value)) value = 'Yes';
    if (/^[☐✗✘]$/.test(value)) value = 'No';

    pairs.push({ row: row.row, label, value });
  });

  return pairs;
}

export function StructureAnalyzerPanel({ customer, onBack, onSidebarToggle }: StructureAnalyzerPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentSheet, setCurrentSheet] = useState(0);
  const [sections, setSections] = useState<Section[]>([]);

  // Fetch file list
  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: ["structure-files"],
    queryFn: fetchStructureFiles,
  });

  // Filter files for current customer
  const customerFiles = useMemo(() => {
    return filesData?.files.filter(f => f.customer === customer) || [];
  }, [filesData, customer]);

  // Fetch selected structure file
  const { data: structureData, isLoading: structureLoading } = useQuery({
    queryKey: ["structure-file", selectedFile],
    queryFn: () => fetchStructureFile(selectedFile!),
    enabled: !!selectedFile,
  });

  // Get current sheet rows
  const currentRows = useMemo(() => {
    return structureData?.sheets?.[currentSheet]?.rows || [];
  }, [structureData, currentSheet]);

  // Detect sections when rows change
  useEffect(() => {
    if (currentRows.length > 0) {
      setSections(detectSections(currentRows));
    } else {
      setSections([]);
    }
  }, [currentRows]);

  // Update column type for a section
  const updateSectionColumnType = (sectionId: string, col: string, type: 'label' | 'value' | 'ignore') => {
    setSections(prev => prev.map(s =>
      s.id === sectionId
        ? { ...s, columnTypes: { ...s.columnTypes, [col]: type } }
        : s
    ));
  };

  // Toggle section collapse
  const toggleSection = (sectionId: string) => {
    setSections(prev => prev.map(s =>
      s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s
    ));
  };

  // Export analysis
  const exportAnalysis = () => {
    if (!structureData) return;

    const analysis = {
      source: structureData.source,
      sheet: structureData.sheets[currentSheet]?.name,
      sections: sections.map(s => ({
        title: s.title,
        rowRange: `${s.startRowIdx + 1}-${s.endRowIdx + 1}`,
        columns: s.columns,
        columnTypes: s.columnTypes,
        extractedPairs: extractQAPairsForSection(s),
      })),
      summary: {
        totalSections: sections.length,
        totalQAPairs: sections.reduce((sum, s) => sum + extractQAPairsForSection(s).length, 0),
      },
      exportedAt: new Date().toISOString(),
    };

    const filename = structureData.source.filename.replace(/\.\w+$/, '');
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_section-rules.json`;
    a.click();
  };

  if (filesLoading) {
    return (
      <div className="flex flex-col h-screen bg-app">
        <Header customer={customer} onBack={onBack} onSidebarToggle={onSidebarToggle} />
        <div className="flex-1 flex items-center justify-center">
          <CircleNotch className="w-6 h-6 animate-spin text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-app">
      <Header customer={customer} onBack={onBack} onSidebarToggle={onSidebarToggle} />

      {/* File selector and actions */}
      <div className="flex items-center gap-4 px-6 py-3 bg-app-secondary border-b border-default">
        <select
          value={selectedFile || ''}
          onChange={(e) => {
            setSelectedFile(e.target.value || null);
            setCurrentSheet(0);
            setSections([]);
          }}
          className="flex-1 max-w-md px-3 py-1.5 text-[13px] bg-input border border-default rounded focus:outline-none focus:border-accent"
        >
          <option value="">-- Select a structure file --</option>
          {customerFiles.map(f => (
            <option key={f.path} value={f.path}>{f.file}</option>
          ))}
        </select>

        {structureData && (
          <>
            <span className="text-[11px] px-2 py-0.5 rounded bg-accent/20 text-accent">
              {structureData.source.documentType.toUpperCase()}
            </span>
            <span className="text-[11px] text-muted">
              {sections.length} sections
            </span>
            <button onClick={exportAnalysis} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-hover hover:bg-hover-strong rounded">
              <Download className="w-3.5 h-3.5" />
              Export Rules
            </button>
          </>
        )}
      </div>

      {/* Sheet tabs */}
      {structureData && structureData.sheets.length > 1 && (
        <div className="flex gap-1 px-6 py-2 bg-app-secondary border-b border-default overflow-x-auto">
          {structureData.sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCurrentSheet(idx);
                setSections([]);
              }}
              className={`px-3 py-1 text-[12px] rounded ${
                idx === currentSheet ? 'bg-accent text-white' : 'bg-hover text-muted hover:text-primary'
              }`}
            >
              {sheet.name} ({sheet.rows?.length || 0})
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {!selectedFile ? (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <FileText className="w-12 h-12 mb-3 opacity-50" />
            <p>Select a structure file to analyze</p>
          </div>
        ) : structureLoading ? (
          <div className="flex items-center justify-center h-full">
            <CircleNotch className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map(section => {
              const qaPairs = extractQAPairsForSection(section);

              return (
                <div key={section.id} className="border border-default rounded-lg overflow-hidden">
                  {/* Section header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 cursor-pointer hover:bg-amber-500/15"
                    onClick={() => toggleSection(section.id)}
                  >
                    {section.collapsed ? (
                      <CaretRight className="w-4 h-4 text-amber-500" />
                    ) : (
                      <CaretDown className="w-4 h-4 text-amber-500" />
                    )}
                    <span className="font-medium text-amber-500">{section.title}</span>
                    <span className="text-[11px] text-muted">
                      {section.rows.length} rows, {section.columns.length} cols, {qaPairs.length} Q&A
                    </span>
                  </div>

                  {!section.collapsed && (
                    <div className="p-4 space-y-4">
                      {/* Column type controls for this section */}
                      <div className="flex flex-wrap gap-2 p-3 bg-app-secondary rounded">
                        <span className="text-[11px] text-muted mr-2">Columns:</span>
                        {section.columns.map(col => (
                          <div key={col} className="flex items-center gap-1">
                            <span className="text-[11px] font-mono font-semibold">{col}</span>
                            <select
                              value={section.columnTypes[col]}
                              onChange={(e) => updateSectionColumnType(section.id, col, e.target.value as any)}
                              className={`text-[10px] px-1.5 py-0.5 rounded border-0 ${
                                section.columnTypes[col] === 'label'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : section.columnTypes[col] === 'value'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}
                            >
                              <option value="label">Label</option>
                              <option value="value">Value</option>
                              <option value="ignore">Ignore</option>
                            </select>
                          </div>
                        ))}
                      </div>

                      {/* Table preview */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] border-collapse">
                          <thead className="bg-app-secondary">
                            <tr>
                              <th className="px-2 py-1 text-left text-muted border border-default w-10">#</th>
                              {section.columns.map(col => (
                                <th
                                  key={col}
                                  className={`px-2 py-1 text-left border border-default min-w-[80px] ${
                                    section.columnTypes[col] === 'label'
                                      ? 'bg-blue-500/10 text-blue-400'
                                      : section.columnTypes[col] === 'value'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-gray-500/10 text-gray-400'
                                  }`}
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {section.rows.slice(0, 10).map((row, idx) => {
                              // Track which columns are covered by merges
                              const mergedCols = new Set<string>();
                              section.columns.forEach(col => {
                                const cell = row.cells?.[col];
                                if (cell?.format?.isMergeOrigin) {
                                  const span = getMergeSpan(cell);
                                  if (span) {
                                    // Mark all columns in range except origin as merged
                                    section.columns.forEach(c => {
                                      if (c > span.startCol && c <= span.endCol) {
                                        mergedCols.add(c);
                                      }
                                    });
                                  }
                                }
                              });

                              return (
                                <tr key={idx}>
                                  <td className="px-2 py-1 text-muted border border-default text-center">{row.row}</td>
                                  {section.columns.map(col => {
                                    const cell = row.cells?.[col];
                                    const value = (cell?.value || '').trim();
                                    const type = section.columnTypes[col];
                                    const isMergeOrigin = cell?.format?.isMergeOrigin;
                                    const isPartOfMerge = mergedCols.has(col);

                                    // Calculate colspan for merge origins
                                    let colSpan = 1;
                                    if (isMergeOrigin) {
                                      const span = getMergeSpan(cell);
                                      if (span) {
                                        const startIdx = section.columns.indexOf(span.startCol);
                                        const endIdx = section.columns.indexOf(span.endCol);
                                        if (startIdx >= 0 && endIdx >= 0) {
                                          colSpan = endIdx - startIdx + 1;
                                        }
                                      }
                                    }

                                    // Skip cells that are part of a merge (not origin)
                                    if (isPartOfMerge) return null;

                                    let displayValue = value;
                                    if (/^[☒✓✔]$/.test(displayValue)) displayValue = '✓ Yes';
                                    if (/^[☐✗✘]$/.test(displayValue)) displayValue = '✗ No';
                                    // Handle Azure checkbox markers
                                    displayValue = displayValue
                                      .replace(/:selected:/g, '☑')
                                      .replace(/:unselected:/g, '☐');

                                    return (
                                      <td
                                        key={col}
                                        colSpan={colSpan}
                                        className={`px-2 py-1 border border-default ${
                                          type === 'label' ? 'bg-blue-500/5' :
                                          type === 'value' ? 'bg-emerald-500/5' : 'opacity-50'
                                        } ${!value ? 'text-muted/30' : ''} ${isMergeOrigin ? 'bg-purple-500/10 border-purple-500/30' : ''}`}
                                      >
                                        <div className="max-w-[200px] truncate">
                                          {isMergeOrigin && <span className="text-[9px] text-purple-400 mr-1">⊞</span>}
                                          {value ? displayValue : '—'}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                            {section.rows.length > 10 && (
                              <tr>
                                <td colSpan={section.columns.length + 1} className="px-2 py-1 text-center text-muted border border-default">
                                  ... {section.rows.length - 10} more rows
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Extraction preview */}
                      {qaPairs.length > 0 && (
                        <div>
                          <div className="text-[11px] text-muted mb-2">Extracted Q&A ({qaPairs.length}):</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[200px] overflow-auto">
                            {qaPairs.slice(0, 6).map((pair, idx) => (
                              <div key={idx} className="p-2 bg-card rounded border-l-2 border-emerald-500">
                                <div className="text-[10px] text-blue-400 font-medium truncate">{pair.label}</div>
                                <div className="text-[11px] text-primary truncate">{pair.value}</div>
                              </div>
                            ))}
                          </div>
                          {qaPairs.length > 6 && (
                            <div className="text-[10px] text-muted mt-1">+ {qaPairs.length - 6} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
