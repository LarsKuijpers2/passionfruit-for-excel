/**
 * Visual Q&A Panel
 *
 * Displays visual Q&A training data with annotated images.
 * Shows the bounding boxes, extracted Q&A pairs, and Claude's reasoning.
 */

import { useState, useEffect } from 'react';

interface TextElement {
  content: string;
  pageNumber: number;
  boundingBox?: number[];
}

interface ExtractedPair {
  question: string;
  answer: string;
  pageNumber: number;
  questionIdx: number;
  answerIdx: number;
  confidence?: number;
  visualReason?: string;
}

interface TrainingData {
  pdfPath?: string;
  pageNumber: number;
  imagePath: string;
  imageUrl: string;
  textElements: TextElement[];
  prompt: string;
  rawResponse: string;
  extractedPairs: ExtractedPair[];
  extractedAt: string;
}

interface Props {
  questionnaireId: string;
}

export function VisualQAPanel({ questionnaireId }: Props) {
  const [trainingData, setTrainingData] = useState<TrainingData[]>([]);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    loadTrainingData();
  }, [questionnaireId]);

  const loadTrainingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/questionnaire/${encodeURIComponent(questionnaireId)}/visual-qa`);
      if (!response.ok) throw new Error('Failed to load visual Q&A data');
      const data = await response.json();
      setTrainingData(data.trainingData || []);
      if (data.trainingData?.length > 0) {
        setSelectedPage(data.trainingData[0].pageNumber);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const selectedData = trainingData.find(d => d.pageNumber === selectedPage);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading visual Q&A data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        Error: {error}
      </div>
    );
  }

  if (trainingData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No visual Q&A training data available for this questionnaire.
        <br />
        Run the store command to generate training data.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page selector */}
      <div className="flex items-center gap-2 p-2 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span className="text-sm text-gray-400">Page:</span>
        <div className="flex gap-1 flex-wrap">
          {trainingData.map(d => (
            <button
              key={d.pageNumber}
              onClick={() => setSelectedPage(d.pageNumber)}
              className={`px-2 py-1 text-xs rounded ${
                selectedPage === d.pageNumber
                  ? 'bg-blue-600 text-white'
                  : d.extractedPairs.length > 0
                  ? 'bg-green-800 text-green-200 hover:bg-green-700'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {d.pageNumber}
              {d.extractedPairs.length > 0 && (
                <span className="ml-1 text-xs opacity-75">({d.extractedPairs.length})</span>
              )}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-500">
          {trainingData.reduce((sum, d) => sum + d.extractedPairs.length, 0)} total pairs from {trainingData.length} pages
        </span>
      </div>

      {/* Main content */}
      {selectedData && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-2 gap-4 h-full">
            {/* Left: Annotated image */}
            <div className="flex flex-col">
              <h3 className="text-sm font-medium text-gray-300 mb-2">
                Annotated Page {selectedData.pageNumber}
              </h3>
              <div className="flex-1 bg-gray-900 rounded border border-gray-700 overflow-auto">
                <img
                  src={selectedData.imageUrl}
                  alt={`Page ${selectedData.pageNumber} with bounding boxes`}
                  className="max-w-full"
                />
              </div>
            </div>

            {/* Right: Extracted Q&A pairs and details */}
            <div className="flex flex-col gap-4 overflow-auto">
              {/* Extracted pairs */}
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Extracted Q&A Pairs ({selectedData.extractedPairs.length})
                </h3>
                {selectedData.extractedPairs.length === 0 ? (
                  <div className="text-gray-500 text-sm p-4 bg-gray-800 rounded">
                    No Q&A pairs extracted from this page.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedData.extractedPairs.map((pair, idx) => (
                      <div
                        key={idx}
                        className="bg-gray-800 rounded p-3 border border-gray-700"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">
                            [{pair.questionIdx}→{pair.answerIdx}]
                          </span>
                          {pair.confidence && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              pair.confidence >= 0.9
                                ? 'bg-green-800 text-green-200'
                                : pair.confidence >= 0.7
                                ? 'bg-yellow-800 text-yellow-200'
                                : 'bg-red-800 text-red-200'
                            }`}>
                              {Math.round(pair.confidence * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="mt-2">
                          <div className="text-xs text-gray-400">Question:</div>
                          <div className="text-sm text-gray-200">{pair.question}</div>
                        </div>
                        <div className="mt-2">
                          <div className="text-xs text-gray-400">Answer:</div>
                          <div className="text-sm text-green-400 font-medium">{pair.answer}</div>
                        </div>
                        {pair.visualReason && (
                          <div className="mt-2 text-xs text-gray-500 italic">
                            {pair.visualReason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Text elements */}
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Text Elements ({selectedData.textElements.length})
                </h3>
                <div className="bg-gray-800 rounded border border-gray-700 max-h-48 overflow-auto">
                  <div className="p-2 space-y-1 text-xs font-mono">
                    {selectedData.textElements.map((el, idx) => (
                      <div
                        key={idx}
                        className={`flex gap-2 ${
                          selectedData.extractedPairs.some(
                            p => p.questionIdx === idx || p.answerIdx === idx
                          )
                            ? 'text-green-400'
                            : 'text-gray-400'
                        }`}
                      >
                        <span className="text-blue-400 w-6 flex-shrink-0">[{idx}]</span>
                        <span className="truncate" title={el.content}>
                          {el.content.replace(/\n/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Toggle buttons for prompt/response */}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className={`px-3 py-1 text-xs rounded ${
                    showPrompt ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {showPrompt ? 'Hide' : 'Show'} Prompt
                </button>
                <button
                  onClick={() => setShowRawResponse(!showRawResponse)}
                  className={`px-3 py-1 text-xs rounded ${
                    showRawResponse ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {showRawResponse ? 'Hide' : 'Show'} Raw Response
                </button>
              </div>

              {/* Prompt */}
              {showPrompt && (
                <div className="flex flex-col">
                  <h3 className="text-sm font-medium text-gray-300 mb-2">Prompt</h3>
                  <div className="bg-gray-900 rounded border border-gray-700 p-3 max-h-64 overflow-auto">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap">
                      {selectedData.prompt}
                    </pre>
                  </div>
                </div>
              )}

              {/* Raw response */}
              {showRawResponse && (
                <div className="flex flex-col">
                  <h3 className="text-sm font-medium text-gray-300 mb-2">Raw Claude Response</h3>
                  <div className="bg-gray-900 rounded border border-gray-700 p-3 max-h-64 overflow-auto">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap">
                      {selectedData.rawResponse}
                    </pre>
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="text-xs text-gray-500 mt-auto">
                Extracted at: {new Date(selectedData.extractedAt).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
