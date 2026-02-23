import { useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { File, GridFour } from '@phosphor-icons/react';
import type { ExcelSheet, IndexedSection } from '../types';

// Set the worker source for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ViewTab = 'file' | 'view';

interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
}

interface OriginalPanelProps {
  visible: boolean;
  sheet?: ExcelSheet;
  sections?: IndexedSection[];
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
}

export interface OriginalPanelHandle {
  scrollToCell: (cellRef: string) => void;
}

export const OriginalPanel = forwardRef<OriginalPanelHandle, OriginalPanelProps>(function OriginalPanel(
  { visible, sheet, sections: _sections, textContent, activeCell, onCellClick, questionnaireId, pages: _pages },
  ref
) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  // Tab state
  const [activeTab, setActiveTab] = useState<ViewTab>('view');
  const activeTabRef = useRef<ViewTab>(activeTab);
  activeTabRef.current = activeTab;

  // PDF viewer state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showAllBoxes, setShowAllBoxes] = useState(false);
  const [pdfSearchQuery, setPdfSearchQuery] = useState('');
  const [pdfSearchResults, setPdfSearchResults] = useState<Array<{ ref: string; pageNumber: number; content: string }>>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

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
    if (activeTab !== 'file' || !questionnaireId) return;

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
    if (!activeCell || activeTab !== 'file' || !pdfDoc) return;
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

  // Handle search
  const handlePdfSearch = (query: string) => {
    setPdfSearchQuery(query);
    const results = searchContent(query);
    setPdfSearchResults(results);
    setCurrentSearchIndex(0);
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
    }
  };

  // Render current PDF page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || activeTab !== 'file') return;

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

          // Only show if it's the active item, showAllBoxes is enabled, or it's a search result
          if (!isActive && !showAllBoxes && !isSearchResult) continue;

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
            isCurrentSearchResult
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
            labelEl.className = `text-[8px] leading-tight truncate px-0.5 ${colors.text} font-medium`;
            labelEl.textContent = ref;
            box.appendChild(labelEl);

            if (item.value && boxHeight > 24) {
              const valueEl = document.createElement('div');
              valueEl.className = 'text-[7px] leading-tight truncate px-0.5 text-gray-600 dark:text-gray-300';
              valueEl.textContent = item.value;
              box.appendChild(valueEl);
            }
          }

          box.title = `[${type}] ${ref}: ${item.value || '(empty)'}`;
          box.onclick = (e) => {
            e.stopPropagation();
            if (onCellClick && type === 'cell') {
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
  }, [pdfDoc, currentPage, scale, activeTab, activeCell, sheet, textContent, onCellClick, showAllBoxes, pdfSearchResults, currentSearchIndex]);

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
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 max-w-[300px] mx-4">
          <input
            type="text"
            placeholder="Search..."
            value={pdfSearchQuery}
            onChange={(e) => handlePdfSearch(e.target.value)}
            className="flex-1 h-7 px-2.5 bg-app border border-default rounded text-[12px] text-primary placeholder:text-muted focus:outline-none focus:border-accent"
          />
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
              : (numPages > 0 ? `${currentPage}/${numPages}` : '')}
          </span>
        </div>
      </div>

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
          <div className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex items-start justify-center p-4">
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

                  // Separate header rows from data rows using Azure rowType
                  const headerRows = section.rows.filter(row => row.rowType === 'header');
                  const dataRows = section.rows.filter(row => row.rowType !== 'header' && !row.isEmpty);

                  console.log(`Table structure for "${section.title}":`, {
                    headerRows: headerRows.length,
                    dataRows: dataRows.length,
                    sampleHeaderRow: headerRows[0]?.cells ? Object.keys(headerRows[0].cells) : 'none',
                    sampleDataRow: dataRows[0]?.cells ? Object.keys(dataRows[0].cells) : 'none'
                  });

                  // Find all column letters used
                  const allColumns = new Set<string>();
                  [...headerRows, ...dataRows].forEach(row => {
                    Object.keys(row.cells || {}).forEach(col => allColumns.add(col));
                  });
                  const displayColumns = Array.from(allColumns).sort();

                  return (
                    <div className="bg-card rounded-lg border border-subtle overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          {/* Render header rows */}
                          {headerRows.length > 0 && (
                            <thead>
                              {headerRows.map((headerRow, rowIndex) => (
                                <tr key={`header-${rowIndex}`} className="bg-app-secondary">
                                  {displayColumns.map(col => {
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
                                            <span>{cell.value}</span>
                                          ) : (
                                            <span className="text-muted/50">—</span>
                                          )}
                                        </div>
                                      </th>
                                    );
                                  })}
                                </tr>
                              ))}
                            </thead>
                          )}

                          {/* Render data rows */}
                          <tbody>
                            {dataRows.map((dataRow, rowIndex) => (
                              <tr
                                key={`data-${rowIndex}`}
                                className="border-b border-subtle hover:bg-card-hover transition-colors"
                              >
                                {displayColumns.map(col => {
                                  const cell = dataRow.cells?.[col];
                                  const isLabelCell = cell?.role === 'label';
                                  const isActiveCell = activeCell && cell?.ref === activeCell;
                                  const isSearchMatch = cell?.ref && searchResultRefs.has(cell.ref);
                                  const isCurrentSearchMatch = cell?.ref && cell.ref === currentSearchRef;

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
                                      } transition-colors cursor-pointer hover:bg-card-hover`}
                                      onClick={() => handleCellClick(cell?.ref || `${col}${dataRow.row}`, dataRow.row, col)}
                                    >
                                      <div className="min-h-[18px] flex items-start">
                                        {cell?.value && cell.value.length > 0 ? (
                                          <span>
                                            {cell.value}
                                          </span>
                                        ) : (
                                          <span className="text-muted/50">—</span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
    </div>
  );
});