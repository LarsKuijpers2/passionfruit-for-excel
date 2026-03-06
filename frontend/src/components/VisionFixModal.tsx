/**
 * Vision Fix Modal
 *
 * Modal for extracting Q&A pairs from a selected PDF region using Claude Vision.
 * Supports background extraction - user can continue working while extraction runs.
 * Allows users to:
 * 1. See the selected region
 * 2. Provide extraction instructions
 * 3. Start background extraction
 * 4. Review extracted items when ready
 * 5. Choose where to insert items in the list
 * 6. Edit and approve items before saving
 */

import { useState, useEffect, useCallback } from 'react';
import { X, SpinnerGap, Check, Trash, PencilSimple, Eye, CaretDown, ListPlus } from '@phosphor-icons/react';
import type { VisionFixRegion, VisionFixItem, VisionFixResult } from '../api';
import { visionFix, saveVisionFix } from '../api';

interface VisionFixModalProps {
  isOpen: boolean;
  onClose: () => void;
  questionnaireId: string;
  customer?: string;
  pageNumber: number;
  region: VisionFixRegion;
  onSuccess: () => void;
  /** Available sections from indexed data for position selection */
  availableSections?: Array<{ title: string; itemCount: number }>;
  /** Callback to start background extraction - returns promise that resolves when complete */
  onStartBackground?: (taskId: string, extractionPromise: Promise<VisionFixResult>) => void;
  /** Pre-loaded results from a background extraction (opens directly in review mode) */
  preloadedResults?: VisionFixResult;
}

type ModalStep = 'instructions' | 'extracting' | 'review';

/** Position to insert extracted items */
interface InsertPosition {
  type: 'section' | 'end';
  sectionTitle?: string;
  afterItemIndex?: number;
}

const destinationOptions = [
  { value: 'library', label: 'Library', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'entity', label: 'Entity', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'product', label: 'Product', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'excluded', label: 'Excluded', color: 'bg-gray-500/20 text-gray-400' },
];

export function VisionFixModal({
  isOpen,
  onClose,
  questionnaireId,
  customer,
  pageNumber,
  region,
  onSuccess,
  availableSections = [],
  onStartBackground,
  preloadedResults,
}: VisionFixModalProps) {
  const [step, setStep] = useState<ModalStep>('instructions');
  const [instructions, setInstructions] = useState('');
  const [items, setItems] = useState<VisionFixItem[]>([]);
  const [debugInfo, setDebugInfo] = useState<VisionFixResult['debugInfo'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [insertPosition, setInsertPosition] = useState<InsertPosition>({ type: 'end' });
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);
  const [runInBackground, setRunInBackground] = useState(true);

  // Reset state when modal opens, or load preloaded results
  useEffect(() => {
    if (isOpen) {
      if (preloadedResults && preloadedResults.success) {
        // Open directly in review mode with preloaded results
        setStep('review');
        setItems(preloadedResults.items);
        setDebugInfo(preloadedResults.debugInfo || null);
        setError(null);
      } else {
        setStep('instructions');
        setInstructions('');
        setItems([]);
        setDebugInfo(null);
        setError(null);
      }
      setEditingId(null);
      setSaving(false);
      setInsertPosition({ type: 'end' });
      setShowPositionDropdown(false);
    }
  }, [isOpen, preloadedResults]);

  // Handle background extraction completion
  const handleExtractionComplete = useCallback((result: VisionFixResult) => {
    if (result.success) {
      setItems(result.items);
      setDebugInfo(result.debugInfo);
      setStep('review');
    } else {
      setError(result.error || 'Extraction failed');
      setStep('instructions');
    }
  }, []);

  const handleExtract = async () => {
    if (!instructions.trim()) {
      setError('Please provide extraction instructions');
      return;
    }

    setError(null);

    if (runInBackground && onStartBackground) {
      // Start background extraction - close modal and let user continue
      const taskId = `vision-fix-${Date.now()}`;

      // Create the extraction promise
      const extractionPromise = visionFix(questionnaireId, pageNumber, region, instructions, customer);

      // Pass both taskId and promise to parent so it can handle completion
      onStartBackground(taskId, extractionPromise);

      onClose();
      return;
    }

    // Foreground extraction (blocking)
    setStep('extracting');

    try {
      const result = await visionFix(questionnaireId, pageNumber, region, instructions, customer);
      handleExtractionComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setStep('instructions');
    }
  };

  const handleSave = async () => {
    if (items.length === 0) {
      setError('No items to save');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await saveVisionFix(
        questionnaireId,
        items,
        {
          pageNumber,
          region,
          instructions,
          insertPosition: insertPosition.type === 'section' ? insertPosition.sectionTitle : undefined,
        },
        customer
      );
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const handleUpdateItem = (id: string, updates: Partial<VisionFixItem>) => {
    setItems(prev =>
      prev.map(item => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleDeleteItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-app border border-default rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-purple-400" />
            <span className="font-medium text-primary">Vision Fix</span>
            <span className="text-muted text-sm">Page {pageNumber}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-card-hover text-muted hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Step 1: Instructions */}
          {step === 'instructions' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-primary mb-2">
                  What should be extracted from this region?
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="E.g., 'Extract the traceability table with all rows' or 'Get the signature info: name, title, date'"
                  className="w-full h-32 px-3 py-2 bg-app border border-default rounded text-primary placeholder:text-muted focus:outline-none focus:border-accent resize-none"
                  autoFocus
                />
              </div>

              <div className="bg-card-hover rounded p-3">
                <div className="text-xs text-muted mb-2">Selected region:</div>
                <div className="text-sm text-primary font-mono">
                  x: {(region.x * 100).toFixed(1)}%, y: {(region.y * 100).toFixed(1)}%,
                  w: {(region.width * 100).toFixed(1)}%, h: {(region.height * 100).toFixed(1)}%
                </div>
              </div>

              {/* Background extraction toggle */}
              {onStartBackground && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={runInBackground}
                    onChange={(e) => setRunInBackground(e.target.checked)}
                    className="rounded border-default bg-app text-accent focus:ring-accent"
                  />
                  <span className="text-sm text-muted">
                    Run in background (continue working while extracting)
                  </span>
                </label>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Extracting */}
          {step === 'extracting' && (
            <div className="flex flex-col items-center justify-center py-12">
              <SpinnerGap size={40} className="text-purple-400 animate-spin mb-4" />
              <div className="text-primary font-medium">Extracting with Claude Vision...</div>
              <div className="text-muted text-sm mt-1">This may take a few seconds</div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Debug info */}
              {debugInfo && (
                <div className="bg-card-hover rounded p-3 text-xs text-muted flex gap-4">
                  <span>Tokens: {debugInfo.tokensUsed.input + debugInfo.tokensUsed.output}</span>
                  <span>Time: {debugInfo.processingTimeMs}ms</span>
                  <span>Region: {debugInfo.croppedSize.width}x{debugInfo.croppedSize.height}px</span>
                </div>
              )}

              {/* Position selector */}
              {availableSections.length > 0 && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ListPlus size={16} className="text-purple-400" />
                    <span className="text-sm font-medium text-purple-300">Insert position</span>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setShowPositionDropdown(!showPositionDropdown)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-app border border-default rounded text-sm text-primary hover:border-purple-400 transition-colors"
                    >
                      <span>
                        {insertPosition.type === 'end'
                          ? 'Add at end of extraction'
                          : `Add to: ${insertPosition.sectionTitle}`}
                      </span>
                      <CaretDown size={14} className={`text-muted transition-transform ${showPositionDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    {showPositionDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-app border border-default rounded shadow-lg max-h-48 overflow-y-auto z-10">
                        <button
                          onClick={() => {
                            setInsertPosition({ type: 'end' });
                            setShowPositionDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-card-hover transition-colors ${
                            insertPosition.type === 'end' ? 'bg-purple-500/10 text-purple-300' : 'text-primary'
                          }`}
                        >
                          Add at end of extraction
                        </button>
                        <div className="border-t border-default my-1" />
                        {availableSections.map((section) => (
                          <button
                            key={section.title}
                            onClick={() => {
                              setInsertPosition({ type: 'section', sectionTitle: section.title });
                              setShowPositionDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-card-hover transition-colors flex items-center justify-between ${
                              insertPosition.type === 'section' && insertPosition.sectionTitle === section.title
                                ? 'bg-purple-500/10 text-purple-300'
                                : 'text-primary'
                            }`}
                          >
                            <span className="truncate">{section.title}</span>
                            <span className="text-xs text-muted ml-2">{section.itemCount}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Items list */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-primary">
                  Extracted {items.length} items
                </div>

                {items.length === 0 ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-amber-400 text-sm">
                    No items were extracted. Try adjusting your instructions or selecting a different region.
                  </div>
                ) : (
                  <div className="border border-default rounded divide-y divide-default">
                    {items.map((item) => (
                      <div key={item.id} className="p-3">
                        {editingId === item.id ? (
                          /* Edit mode */
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) =>
                                handleUpdateItem(item.id, { label: e.target.value })
                              }
                              className="w-full px-2 py-1 bg-app border border-default rounded text-sm text-primary focus:outline-none focus:border-accent"
                              placeholder="Label"
                            />
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) =>
                                handleUpdateItem(item.id, { value: e.target.value })
                              }
                              className="w-full px-2 py-1 bg-app border border-default rounded text-sm text-primary focus:outline-none focus:border-accent"
                              placeholder="Value"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                value={item.destination}
                                onChange={(e) =>
                                  handleUpdateItem(item.id, {
                                    destination: e.target.value as VisionFixItem['destination'],
                                  })
                                }
                                className="px-2 py-1 bg-app border border-default rounded text-sm text-primary focus:outline-none focus:border-accent"
                              >
                                {destinationOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-2 py-1 bg-accent/20 text-accent rounded text-sm hover:bg-accent/30"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-muted truncate">{item.label}</div>
                              <div className="text-sm text-primary truncate">
                                {item.value || '(empty)'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  destinationOptions.find((o) => o.value === item.destination)
                                    ?.color || ''
                                }`}
                              >
                                {item.destination}
                              </span>
                              <button
                                onClick={() => setEditingId(item.id)}
                                className="p-1 rounded hover:bg-card-hover text-muted hover:text-primary"
                                title="Edit"
                              >
                                <PencilSimple size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1 rounded hover:bg-red-500/20 text-muted hover:text-red-400"
                                title="Delete"
                              >
                                <Trash size={14} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-default">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {step === 'instructions' && (
              <button
                onClick={handleExtract}
                disabled={!instructions.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Eye size={14} />
                Extract with Vision
              </button>
            )}

            {step === 'review' && (
              <>
                <button
                  onClick={() => setStep('instructions')}
                  className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={items.length === 0 || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded text-sm font-medium hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <SpinnerGap size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Add {items.length} Items
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
