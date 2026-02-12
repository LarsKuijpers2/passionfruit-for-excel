import { useState, useEffect } from 'react';
import { X, ChatText } from '@phosphor-icons/react';

interface ItemNote {
  id: string;
  label: string;
  note: string;
  lCell?: string;
}

interface NotesPanelProps {
  visible: boolean;
  questionnaireId: string | null;
  initialNotes: string;
  itemNotes: ItemNote[];
  onClose: () => void;
  onSave: (notes: string) => void;
  onItemClick?: (itemId: string) => void;
}

export function NotesPanel({
  visible,
  questionnaireId,
  initialNotes,
  itemNotes,
  onClose,
  onSave,
  onItemClick,
}: NotesPanelProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setNotes(initialNotes);
    setIsDirty(false);
  }, [initialNotes, questionnaireId]);

  const handleSave = () => {
    onSave(notes);
    setIsDirty(false);
  };

  const handleClose = () => {
    if (isDirty) {
      handleSave();
    }
    onClose();
  };

  if (!visible) return null;

  return (
    <div className="fixed right-0 top-10 bottom-0 w-[400px] bg-app-secondary border-l border-default flex flex-col z-[100] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-default">
        <span className="text-[13px] font-medium text-primary">Notes</span>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] text-amber-400">Unsaved</span>
          )}
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded text-muted hover:text-primary hover:bg-card-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Questionnaire notes */}
        <div className="p-4 border-b border-default">
          <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-2">
            Questionnaire Notes
          </label>
          <textarea
            className="w-full p-3 bg-app border border-default rounded text-[13px] text-primary resize-none focus:outline-none focus:border-accent min-h-[120px]"
            placeholder="Add notes about this questionnaire..."
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setIsDirty(true);
            }}
          />
        </div>

        {/* Item notes */}
        <div className="p-4">
          <label className="block text-[11px] font-medium text-muted uppercase tracking-wide mb-2">
            Item Notes ({itemNotes.length})
          </label>
          {itemNotes.length === 0 ? (
            <p className="text-[12px] text-muted italic">
              No item notes yet. Select items and use Cmd+K to add notes.
            </p>
          ) : (
            <div className="space-y-2">
              {itemNotes.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-app border border-default rounded cursor-pointer hover:border-accent transition-colors"
                  onClick={() => onItemClick?.(item.id)}
                >
                  <div className="flex items-start gap-2">
                    <ChatText size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-medium text-primary truncate">
                          {item.label}
                        </span>
                        {item.lCell && (
                          <span className="text-[10px] text-muted bg-app-secondary px-1.5 py-0.5 rounded">
                            {item.lCell}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted whitespace-pre-wrap">
                        {item.note}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 h-12 px-4 items-center border-t border-default">
        <button
          onClick={handleClose}
          className="h-7 px-3 rounded text-[12px] font-medium bg-app text-muted hover:bg-card-hover transition-colors"
        >
          Close
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            isDirty
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-app-secondary text-muted cursor-not-allowed'
          }`}
        >
          Save
        </button>
      </div>
    </div>
  );
}
