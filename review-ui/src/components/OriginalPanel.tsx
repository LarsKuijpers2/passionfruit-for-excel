import { useState } from 'react';
import { X, Tag, Question, ChatText, Prohibit, CheckCircle } from '@phosphor-icons/react';
import type { ExcelSheet, CellSelection, CellFeedbackType } from '../types';

interface OriginalPanelProps {
  visible: boolean;
  sheet?: ExcelSheet;
  reviewMode?: boolean;
  onCellFeedback?: (cellRef: string, feedbackType: CellFeedbackType, topic?: string, reason?: string) => void;
}

export function OriginalPanel({ visible, sheet, reviewMode, onCellFeedback }: OriginalPanelProps) {
  const [selectedCell, setSelectedCell] = useState<CellSelection | null>(null);
  const [feedbackTopic, setFeedbackTopic] = useState('');

  if (!visible) return null;

  const handleCellClick = (cell: { value: string; row: number; col: number }, sheetName: string) => {
    if (!reviewMode) return;

    const cellRef = `${getColumnLetter(cell.col)}${cell.row + 1}`;
    setSelectedCell({
      sheet: sheetName,
      row: cell.row,
      col: cell.col,
      cellRef,
      value: cell.value,
    });
    setFeedbackTopic('');
  };

  const handleFeedback = (type: CellFeedbackType) => {
    if (!selectedCell || !onCellFeedback) return;
    onCellFeedback(selectedCell.cellRef, type, feedbackTopic || undefined);
    setSelectedCell(null);
    setFeedbackTopic('');
  };

  return (
    <div className="flex-1 flex flex-col border-r border-border overflow-hidden min-w-0">
      {/* Cell feedback panel */}
      {selectedCell && reviewMode && (
        <div className="bg-muted border-b border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Feedback for {selectedCell.cellRef}
            </span>
            <button
              onClick={() => setSelectedCell(null)}
              className="p-1 rounded hover:bg-hover-bg text-muted-foreground"
            >
              <X size={16} />
            </button>
          </div>
          <div className="text-xs text-muted-foreground mb-2 truncate">
            "{selectedCell.value}"
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              onClick={() => handleFeedback('mark_as_question')}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
            >
              <Question size={12} /> Question
            </button>
            <button
              onClick={() => handleFeedback('mark_as_answer')}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
            >
              <ChatText size={12} /> Answer
            </button>
            <button
              onClick={() => handleFeedback('mark_as_section')}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
            >
              <Tag size={12} /> Section
            </button>
            <button
              onClick={() => handleFeedback('exclude')}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              <Prohibit size={12} /> Exclude
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Correct topic..."
              value={feedbackTopic}
              onChange={(e) => setFeedbackTopic(e.target.value)}
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded text-foreground"
            />
            <button
              onClick={() => handleFeedback('correct_topic')}
              disabled={!feedbackTopic}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-foreground text-background disabled:opacity-50"
            >
              <CheckCircle size={12} /> Set Topic
            </button>
          </div>
        </div>
      )}

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

                    const isSelected =
                      selectedCell?.row === rowIndex &&
                      selectedCell?.col === colIndex &&
                      selectedCell?.sheet === sheet.name;

                    const classNames = [
                      cell.bold ? 'cell-bold' : '',
                      cell.italic ? 'cell-italic' : '',
                      cell.type === 'header' ? 'cell-header' : '',
                      cell.type === 'label' ? 'cell-label' : '',
                      cell.type === 'section' ? 'cell-section' : '',
                      reviewMode ? 'cursor-pointer hover:bg-hover-bg' : '',
                      isSelected ? 'ring-2 ring-foreground ring-inset bg-muted' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <td
                        key={colIndex}
                        className={classNames || undefined}
                        onClick={() => handleCellClick({ ...cell, row: rowIndex, col: colIndex }, sheet.name)}
                      >
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
