/**
 * PDF Overlay Viewer Component
 *
 * Renders a PDF with overlaid extracted values for visual validation.
 * Uses PDF.js for rendering and draws colored boxes at bounding box positions.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set the worker source for PDF.js (use local worker from package)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
}

interface OverlayItem {
  id: string;
  label: string;
  value: string;
  polygon?: number[];
  pageNumber?: number;
  hasDiscrepancy?: boolean;
}

interface Props {
  /** Questionnaire ID to load PDF for */
  questionnaireId: string;
  /** Page dimensions from structure */
  pages?: PageInfo[];
  /** Items to overlay (with bounding boxes) */
  items: OverlayItem[];
  /** Currently selected item ID */
  selectedItemId?: string;
  /** Callback when an item is clicked */
  onItemClick?: (itemId: string) => void;
  /** Whether to show the viewer */
  visible: boolean;
  /** Close callback */
  onClose: () => void;
}

export function PdfOverlayViewer({
  questionnaireId,
  pages,
  items,
  selectedItemId,
  onItemClick,
  visible,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load PDF document
  useEffect(() => {
    if (!visible || !questionnaireId) return;

    setLoading(true);
    setError(null);

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
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [visible, questionnaireId]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !overlayRef.current) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d')!;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      } as any).promise;

      // Update overlay container size
      const overlay = overlayRef.current!;
      overlay.style.width = `${viewport.width}px`;
      overlay.style.height = `${viewport.height}px`;

      // Get page dimensions (in inches) for coordinate conversion
      const pageInfo = pages?.find(p => p.pageNumber === currentPage);
      const pageWidthInches = pageInfo?.width || 8.5;
      const pageHeightInches = pageInfo?.height || 11;

      // Calculate pixels per inch based on rendered size
      const pxPerInchX = viewport.width / pageWidthInches;
      const pxPerInchY = viewport.height / pageHeightInches;

      // Clear existing overlays
      overlay.innerHTML = '';

      // Draw overlays for items on this page
      const pageItems = items.filter(item => item.pageNumber === currentPage && item.polygon);

      for (const item of pageItems) {
        if (!item.polygon || item.polygon.length < 8) continue;

        // Polygon is [x1,y1, x2,y2, x3,y3, x4,y4] in inches
        // Convert to pixels
        const x1 = item.polygon[0] * pxPerInchX;
        const y1 = item.polygon[1] * pxPerInchY;
        const x3 = item.polygon[4] * pxPerInchX;
        const y3 = item.polygon[5] * pxPerInchY;

        const left = Math.min(x1, x3);
        const top = Math.min(y1, y3);
        const width = Math.abs(x3 - x1);
        const height = Math.abs(y3 - y1);

        // Create overlay div
        const div = document.createElement('div');
        div.className = 'absolute cursor-pointer transition-all';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;

        // Color based on state
        if (item.id === selectedItemId) {
          div.style.backgroundColor = 'rgba(59, 130, 246, 0.3)'; // blue
          div.style.border = '2px solid rgb(59, 130, 246)';
        } else if (item.hasDiscrepancy) {
          div.style.backgroundColor = 'rgba(249, 115, 22, 0.2)'; // orange
          div.style.border = '2px solid rgb(249, 115, 22)';
        } else {
          div.style.backgroundColor = 'rgba(34, 197, 94, 0.1)'; // green
          div.style.border = '1px solid rgba(34, 197, 94, 0.5)';
        }

        div.style.borderRadius = '2px';

        // Add value label
        const label = document.createElement('div');
        label.className = 'absolute -top-5 left-0 text-[10px] bg-card px-1 rounded whitespace-nowrap max-w-[200px] truncate';
        label.style.color = item.hasDiscrepancy ? 'rgb(249, 115, 22)' : 'rgb(34, 197, 94)';
        label.textContent = item.value || '(empty)';
        div.appendChild(label);

        // Click handler
        div.onclick = () => onItemClick?.(item.id);

        // Tooltip on hover
        div.title = `${item.label}\nValue: ${item.value || '(empty)'}`;

        overlay.appendChild(div);
      }
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, items, selectedItemId, pages, onItemClick]);

  // Navigate to page containing selected item
  useEffect(() => {
    if (!selectedItemId) return;
    const item = items.find(i => i.id === selectedItemId);
    if (item?.pageNumber && item.pageNumber !== currentPage) {
      setCurrentPage(item.pageNumber);
    }
  }, [selectedItemId, items, currentPage]);

  const handlePrevPage = useCallback(() => {
    setCurrentPage(p => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage(p => Math.min(numPages, p + 1));
  }, [numPages]);

  const handleZoomIn = useCallback(() => {
    setScale(s => Math.min(3, s + 0.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(s => Math.max(0.5, s - 0.25));
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-[200] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-default">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium text-primary">PDF Overlay Viewer</span>
          <span className="text-[11px] text-muted">
            Page {currentPage} of {numPages}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            className="px-2 py-1 text-[11px] bg-app-secondary hover:bg-card-hover rounded cursor-pointer"
            onClick={handleZoomOut}
          >
            -
          </button>
          <span className="text-[11px] text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            className="px-2 py-1 text-[11px] bg-app-secondary hover:bg-card-hover rounded cursor-pointer"
            onClick={handleZoomIn}
          >
            +
          </button>

          {/* Page navigation */}
          <button
            className="px-2 py-1 text-[11px] bg-app-secondary hover:bg-card-hover rounded cursor-pointer disabled:opacity-50"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
          >
            Prev
          </button>
          <button
            className="px-2 py-1 text-[11px] bg-app-secondary hover:bg-card-hover rounded cursor-pointer disabled:opacity-50"
            onClick={handleNextPage}
            disabled={currentPage >= numPages}
          >
            Next
          </button>

          {/* Close button */}
          <button
            className="ml-4 text-muted hover:text-primary text-[18px] leading-none cursor-pointer"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex items-start justify-center"
      >
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted">Loading PDF...</div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500">{error}</div>
          </div>
        )}

        {!loading && !error && (
          <div className="relative inline-block shadow-lg">
            <canvas ref={canvasRef} className="block" />
            <div
              ref={overlayRef}
              className="absolute top-0 left-0 pointer-events-auto"
              style={{ pointerEvents: 'auto' }}
            />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 py-2 bg-card border-t border-default text-[11px]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2 border-emerald-500 bg-emerald-500/10" />
          <span className="text-muted">Matched</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2 border-orange-500 bg-orange-500/20" />
          <span className="text-muted">Discrepancy</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-500/30" />
          <span className="text-muted">Selected</span>
        </div>
      </div>
    </div>
  );
}
