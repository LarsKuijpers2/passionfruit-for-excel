import type { ExcelSheet } from '../types';

interface OriginalPanelProps {
  visible: boolean;
  sheet?: ExcelSheet;
}

export function OriginalPanel({ visible, sheet }: OriginalPanelProps) {
  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col border-r border-border overflow-hidden min-w-0">
      <div className="flex-1 overflow-y-auto p-4">
        {sheet ? (
          <table className="excel-table">
            <thead>
              <tr>
                <th className="row-header">#</th>
                {sheet.rows[0]?.map((_, colIndex) => (
                  <th key={colIndex}>{getColumnLetter(colIndex)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="row-header">{rowIndex + 1}</td>
                  {row.map((cell, colIndex) => {
                    if (cell.mergedHidden) return null;

                    const classNames = [
                      cell.bold ? 'cell-bold' : '',
                      cell.italic ? 'cell-italic' : '',
                      cell.type === 'header' ? 'cell-header' : '',
                      cell.type === 'label' ? 'cell-label' : '',
                      cell.type === 'section' ? 'cell-section' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <td key={colIndex} className={classNames || undefined}>
                        {cell.value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground text-center p-10 italic">
            No sheet selected
          </div>
        )}
      </div>
    </div>
  );
}

function getColumnLetter(index: number): string {
  let result = '';
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode((i % 26) + 65) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}
