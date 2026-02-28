#!/usr/bin/env npx tsx
/**
 * Render PDF with extraction grid overlay
 *
 * Creates an HTML file that shows the PDF with bounding boxes
 * drawn around each extracted cell for visual validation.
 *
 * Usage:
 *   npx tsx scripts/render-pdf-grid.ts <structure-file> [--page N]
 */

import { readFile, writeFile } from 'fs/promises';
import { basename } from 'path';

interface Cell {
  value: string;
  polygon?: number[];
  pageNumber?: number;
  ref?: string;
  type?: string;
  role?: string;
}

interface Row {
  index?: number;
  cells: Record<string, Cell>;
}

interface Sheet {
  name: string;
  rows: Row[];
}

interface Structure {
  source: {
    filename: string;
    filepath: string;
    documentType: string;
  };
  sheets: Sheet[];
  pages?: Array<{
    pageNumber: number;
    width: number;
    height: number;
  }>;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: npx tsx scripts/render-pdf-grid.ts <structure-file> [--page N]');
    process.exit(1);
  }

  const structurePath = args[0];
  const pageArg = args.indexOf('--page');
  const targetPage = pageArg >= 0 ? parseInt(args[pageArg + 1]) : 1;

  console.log(`Loading structure from ${structurePath}...`);
  const structure: Structure = JSON.parse(await readFile(structurePath, 'utf-8'));

  if (structure.source.documentType !== 'pdf') {
    console.log('This tool is for PDF documents only.');
    process.exit(1);
  }

  // Collect all cells with polygons for the target page
  const cells: Array<{
    ref: string;
    value: string;
    polygon: number[];
    role?: string;
  }> = [];

  for (const sheet of structure.sheets) {
    for (const row of sheet.rows) {
      for (const [col, cell] of Object.entries(row.cells)) {
        if (cell.polygon && cell.pageNumber === targetPage) {
          cells.push({
            ref: cell.ref || `${col}${row.index}`,
            value: cell.value || '',
            polygon: cell.polygon,
            role: cell.role,
          });
        }
      }
    }
  }

  console.log(`Found ${cells.length} cells on page ${targetPage}`);

  // Get page dimensions (default to letter size in inches * 72 for points)
  const pageInfo = structure.pages?.find(p => p.pageNumber === targetPage);
  const pageWidth = pageInfo?.width || 8.5 * 72;  // Default letter width
  const pageHeight = pageInfo?.height || 11 * 72; // Default letter height

  // Scale factor for display (inches to pixels at 96 DPI for display)
  const scale = 96;

  // Generate HTML with SVG overlay
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>PDF Grid: ${basename(structure.source.filename)} - Page ${targetPage}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
      font-family: system-ui, -apple-system, sans-serif;
    }
    h1 {
      font-size: 16px;
      margin-bottom: 10px;
    }
    .info {
      font-size: 12px;
      color: #888;
      margin-bottom: 20px;
    }
    .container {
      position: relative;
      display: inline-block;
      background: white;
    }
    .pdf-embed {
      display: block;
    }
    .overlay {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    .cell-box {
      fill: none;
      stroke: rgba(0, 200, 255, 0.6);
      stroke-width: 1;
    }
    .cell-box.header {
      stroke: rgba(255, 200, 0, 0.8);
      stroke-width: 2;
    }
    .cell-box:hover {
      fill: rgba(0, 200, 255, 0.2);
    }
    .tooltip {
      position: fixed;
      background: #222;
      color: #fff;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      max-width: 400px;
      white-space: pre-wrap;
      pointer-events: none;
      z-index: 1000;
      display: none;
    }
    .legend {
      margin-top: 20px;
      font-size: 12px;
    }
    .legend span {
      display: inline-block;
      width: 20px;
      height: 10px;
      margin-right: 5px;
      vertical-align: middle;
    }
    .legend .label { background: rgba(0, 200, 255, 0.6); }
    .legend .header { background: rgba(255, 200, 0, 0.8); }
  </style>
</head>
<body>
  <h1>📄 ${basename(structure.source.filename)}</h1>
  <div class="info">
    Page ${targetPage} | ${cells.length} cells extracted |
    Polygons in inches (Azure DI format)
  </div>

  <div class="container">
    <embed
      class="pdf-embed"
      src="file://${structure.source.filepath}#page=${targetPage}"
      type="application/pdf"
      width="${pageWidth * scale / 72}"
      height="${pageHeight * scale / 72}"
    />
    <svg
      class="overlay"
      width="${pageWidth * scale / 72}"
      height="${pageHeight * scale / 72}"
      viewBox="0 0 ${pageWidth / 72} ${pageHeight / 72}"
    >
      ${cells.map((cell, idx) => {
        // Polygon format: [x1, y1, x2, y2, x3, y3, x4, y4]
        const [x1, y1, x2, y2, x3, y3, x4, y4] = cell.polygon;
        const points = `${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4}`;
        const isHeader = cell.role === 'columnHeader' || cell.role === 'rowHeader';
        return `<polygon
          class="cell-box ${isHeader ? 'header' : ''}"
          points="${points}"
          data-ref="${cell.ref}"
          data-value="${cell.value.replace(/"/g, '&quot;').replace(/\n/g, '\\n')}"
          style="pointer-events: all; cursor: pointer;"
        />`;
      }).join('\n      ')}
    </svg>
  </div>

  <div class="legend">
    <span class="label"></span> Content cells
    <span class="header" style="margin-left: 20px;"></span> Header cells
  </div>

  <div class="tooltip" id="tooltip"></div>

  <script>
    const tooltip = document.getElementById('tooltip');
    document.querySelectorAll('.cell-box').forEach(box => {
      box.addEventListener('mouseenter', (e) => {
        const ref = box.dataset.ref;
        const value = box.dataset.value.replace(/\\\\n/g, '\\n');
        tooltip.textContent = ref + ':\\n' + value;
        tooltip.style.display = 'block';
      });
      box.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
      });
      box.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });
  </script>
</body>
</html>`;

  const outputPath = structurePath.replace('.json', `_grid_p${targetPage}.html`);
  await writeFile(outputPath, html);
  console.log(`\n✅ Generated: ${outputPath}`);
  console.log(`\nOpen in browser to see extraction grid overlay.`);
  console.log(`Hover over cells to see extracted values.`);
}

main().catch(console.error);
