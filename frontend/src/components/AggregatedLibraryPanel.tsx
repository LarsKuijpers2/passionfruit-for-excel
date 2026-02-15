import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CaretDown, CaretRight, MagnifyingGlass, GitMerge, Warning, CheckCircle, XCircle, ListChecks, Books } from '@phosphor-icons/react';
import { fetchAggregatedLibrary, mergeLibraryItems, fetchStandardQuestions, fetchCuratedLibrary } from '../api';
import type { AggregatedLibraryItem, RelatedItemGroup, GroupedByTopic, CuratedQuestion, CuratedTopic } from '../types';
import { toast } from 'sonner';

interface AggregatedLibraryPanelProps {
  customer: string;
  onBack: () => void;
}

// Topic display names
const TOPIC_LABELS: Record<string, string> = {
  certifications: 'Certifications & Standards',
  food_safety: 'Food Safety & Hygiene',
  allergens: 'Allergens',
  company: 'Company Information',
  contacts: 'Contacts',
  quality: 'Quality Management',
  environment: 'Environment & Sustainability',
  logistics: 'Logistics',
  product: 'Product Information',
  packaging: 'Packaging',
  food_fraud: 'Food Fraud',
  microbiology: 'Microbiology',
  audits: 'Audits',
  traceability: 'Traceability',
  other: 'Other',
};

export function AggregatedLibraryPanel({ customer, onBack }: AggregatedLibraryPanelProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'standard' | 'curated' | 'library' | 'company' | 'product' | 'questionnaire' | 'excluded'>('standard');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Fetch aggregated library data
  const { data, isLoading, error } = useQuery({
    queryKey: ['aggregated-library', customer],
    queryFn: () => fetchAggregatedLibrary(customer),
  });

  // Fetch standard questions
  const { data: standardData, isLoading: standardLoading } = useQuery({
    queryKey: ['standard-questions', customer],
    queryFn: () => fetchStandardQuestions(customer),
  });

  // Fetch curated library
  const { data: curatedData, isLoading: curatedLoading } = useQuery({
    queryKey: ['curated-library', customer],
    queryFn: () => fetchCuratedLibrary(customer),
  });

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: ({ itemIds, keepId }: { itemIds: string[]; keepId: string }) =>
      mergeLibraryItems(customer, itemIds, keepId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['aggregated-library', customer] });
      setSelectedForMerge(new Set());
      toast.success('Items merged', {
        description: `${result.merged} items merged into one`,
      });
    },
    onError: (error) => {
      toast.error('Merge failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Filter groups by search
  const filteredGroups = useMemo(() => {
    if (!data?.groups) return [];
    if (!searchQuery.trim()) return data.groups;

    const query = searchQuery.toLowerCase();
    return data.groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            item.value.toLowerCase().includes(query) ||
            (item.rephrasedQuestion?.toLowerCase().includes(query))
        ),
        relatedGroups: group.relatedGroups.filter((rg) =>
          rg.items.some(
            (item) =>
              item.label.toLowerCase().includes(query) ||
              item.value.toLowerCase().includes(query)
          )
        ),
      }))
      .filter((group) => group.items.length > 0 || group.relatedGroups.length > 0);
  }, [data?.groups, searchQuery]);

  const toggleTopic = (topic: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const toggleItem = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleMergeSelection = (itemId: string) => {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleMerge = () => {
    if (selectedForMerge.size < 2) return;
    const itemIds = Array.from(selectedForMerge);
    const keepId = itemIds[0]; // Keep the first one
    mergeMutation.mutate({ itemIds, keepId });
  };

  const renderItem = (item: AggregatedLibraryItem, showCheckbox = false) => {
    const isExpanded = expandedItems.has(item.id);
    const isSelected = selectedForMerge.has(item.id);

    return (
      <div
        key={item.id}
        className={`border-b border-subtle ${isSelected ? 'bg-accent/10' : ''}`}
      >
        <div
          className="flex items-start gap-2 py-2 px-3 cursor-pointer hover:bg-card-hover"
          onClick={() => toggleItem(item.id)}
        >
          {showCheckbox && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                toggleMergeSelection(item.id);
              }}
              className="mt-1"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <span className="text-muted mt-0.5">
            {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-primary">
              {item.rephrasedQuestion || item.label}
            </div>
            {item.rephrasedQuestion && item.rephrasedQuestion !== item.label && (
              <div className="text-[11px] text-muted italic">
                Original: {item.label}
              </div>
            )}
            <div className="text-[12px] text-muted mt-0.5 truncate">
              {item.value || '(empty)'}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted">
            {item.sources.length > 1 && (
              <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                {item.sources.length} sources
              </span>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="px-8 pb-3 space-y-2 text-[12px]">
            <div>
              <span className="text-muted">Section:</span>{' '}
              <span className="text-primary">{item.section || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-muted">Sources:</span>
              <ul className="mt-1 ml-4 list-disc">
                {item.sources.map((source) => (
                  <li key={source} className="text-primary">
                    {source}
                    {item.cellRefs[source] && (
                      <span className="text-muted ml-2">({item.cellRefs[source]})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRelatedGroup = (group: RelatedItemGroup, groupIdx: number) => {
    return (
      <div key={groupIdx} className="border border-amber-500/30 rounded mb-2 bg-amber-500/5">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
          <Warning size={14} className="text-amber-500" />
          <span className="text-[12px] text-amber-500 font-medium">
            Similar items ({group.items.length})
          </span>
          {group.suggestedMerge && (
            <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded text-amber-400">
              Suggested merge
            </span>
          )}
        </div>
        <div>
          {group.items.map((item) => renderItem(item, true))}
        </div>
      </div>
    );
  };

  const renderTopicGroup = (group: GroupedByTopic) => {
    const isExpanded = expandedTopics.has(group.topic);
    const totalItems = group.items.length + group.relatedGroups.reduce((sum, rg) => sum + rg.items.length, 0);
    const topicLabel = TOPIC_LABELS[group.topic] || group.topic;

    return (
      <div key={group.topic} className="border-b border-default">
        <div
          className="flex items-center gap-2 h-10 px-4 bg-app-secondary cursor-pointer hover:bg-card-hover sticky top-0 z-10"
          onClick={() => toggleTopic(group.topic)}
        >
          <span className="text-muted">
            {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </span>
          <span className="text-[13px] font-medium text-primary flex-1">
            {topicLabel}
          </span>
          <span className="text-[11px] text-muted">
            {totalItems} items
            {group.relatedGroups.length > 0 && (
              <span className="text-amber-500 ml-2">
                ({group.relatedGroups.length} groups to review)
              </span>
            )}
          </span>
        </div>

        {isExpanded && (
          <div>
            {/* Related groups first (need attention) */}
            {group.relatedGroups.length > 0 && (
              <div className="p-3">
                {group.relatedGroups.map((rg, idx) => renderRelatedGroup(rg, idx))}
              </div>
            )}

            {/* Standalone items */}
            {group.items.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    );
  };

  const renderItemList = (items: AggregatedLibraryItem[]) => {
    if (items.length === 0) {
      return (
        <div className="text-center py-12 text-muted text-[13px]">
          No items
        </div>
      );
    }
    return items.map((item) => renderItem(item));
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-red-500">Error loading library data</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-app overflow-hidden">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-default bg-app-secondary">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-muted hover:text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="text-[12px]">Back</span>
        </button>
        <div className="flex-1">
          <h1 className="text-[14px] font-medium text-primary">
            Answer Library - {customer}
          </h1>
          <div className="text-[11px] text-muted">
            {data?.uniqueItems} unique items from {data?.questionnaires.length} questionnaires
          </div>
        </div>
        {selectedForMerge.size >= 2 && (
          <button
            onClick={handleMerge}
            disabled={mergeMutation.isPending}
            className="h-7 px-3 rounded bg-accent text-white text-[12px] font-medium flex items-center gap-1.5 hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            <GitMerge size={14} />
            Merge {selectedForMerge.size} items
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-default bg-app-secondary">
        <button
          onClick={() => setActiveTab('standard')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'standard'
              ? 'bg-cyan-500/20 text-cyan-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          <ListChecks size={14} />
          Standard Questions ({standardData?.totalQuestions || 0})
        </button>
        <button
          onClick={() => setActiveTab('curated')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'curated'
              ? 'bg-violet-500/20 text-violet-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          <Books size={14} />
          Curated ({(curatedData?.company?.reduce((sum, t) => sum + t.questions.length, 0) || 0) + (curatedData?.answer_library?.reduce((sum, t) => sum + t.questions.length, 0) || 0)})
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'library'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Library ({data?.stats.standaloneItems || 0})
        </button>
        <button
          onClick={() => setActiveTab('company')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'company'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Company ({data?.company.count || 0})
        </button>
        <button
          onClick={() => setActiveTab('product')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'product'
              ? 'bg-orange-500/20 text-orange-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Product ({data?.product.count || 0})
        </button>
        <button
          onClick={() => setActiveTab('questionnaire')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'questionnaire'
              ? 'bg-purple-500/20 text-purple-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Questionnaire ({data?.questionnaire.count || 0})
        </button>
        <button
          onClick={() => setActiveTab('excluded')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'excluded'
              ? 'bg-gray-500/20 text-gray-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Excluded ({data?.excluded.count || 0})
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-default">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            className="w-full h-8 pl-9 pr-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent placeholder:text-muted"
            placeholder="Search questions and answers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'standard' && (
          <>
            {standardLoading ? (
              <div className="text-center py-12 text-muted text-[13px]">
                Loading standard questions...
              </div>
            ) : !standardData?.sections?.length ? (
              <div className="text-center py-12 text-muted text-[13px]">
                No standard questions configured
              </div>
            ) : (
              standardData.sections.map((section) => {
                const isExpanded = expandedSections.has(section.section);
                const answeredCount = section.questions.filter(q => q.suggestedAnswer).length;

                return (
                  <div key={section.section} className="border-b border-default">
                    <div
                      className="flex items-center gap-2 h-10 px-4 bg-app-secondary cursor-pointer hover:bg-card-hover sticky top-0 z-10"
                      onClick={() => toggleSection(section.section)}
                    >
                      <span className="text-muted">
                        {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                      </span>
                      <span className="text-[13px] font-medium text-primary flex-1">
                        {section.section}
                      </span>
                      <span className="text-[11px] text-muted">
                        {answeredCount}/{section.questions.length} answered
                      </span>
                      {answeredCount === section.questions.length ? (
                        <CheckCircle size={14} className="text-emerald-500" />
                      ) : answeredCount > 0 ? (
                        <Warning size={14} className="text-amber-500" />
                      ) : (
                        <XCircle size={14} className="text-red-500" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="divide-y divide-subtle">
                        {section.questions.map((question) => {
                          const isQuestionExpanded = expandedItems.has(question.id);

                          return (
                            <div key={question.id} className="px-4 py-3">
                              <div
                                className="flex items-start gap-2 cursor-pointer"
                                onClick={() => toggleItem(question.id)}
                              >
                                <span className="text-muted mt-0.5">
                                  {isQuestionExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted bg-app px-1.5 py-0.5 rounded">
                                      {question.id}
                                    </span>
                                    {question.suggestedAnswer ? (
                                      <CheckCircle size={12} className="text-emerald-500" />
                                    ) : (
                                      <XCircle size={12} className="text-red-400" />
                                    )}
                                  </div>
                                  <div className="text-[13px] text-primary mt-1">
                                    {question.question}
                                  </div>
                                  {question.suggestedAnswer && (
                                    <div className="text-[12px] text-emerald-400 mt-1 font-medium">
                                      {question.suggestedAnswer}
                                    </div>
                                  )}
                                  {question.sources.length > 0 && (
                                    <div className="text-[10px] text-muted mt-1">
                                      From: {question.sources.join(', ')}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {isQuestionExpanded && question.libraryMatches.length > 0 && (
                                <div className="ml-6 mt-3 space-y-2">
                                  <div className="text-[11px] text-muted font-medium">
                                    Library Matches ({question.libraryMatches.length}):
                                  </div>
                                  {question.libraryMatches.map((match, idx) => (
                                    <div
                                      key={idx}
                                      className="bg-app border border-subtle rounded p-2 text-[12px]"
                                    >
                                      <div className="text-muted">{match.label}</div>
                                      <div className="text-primary mt-0.5">{match.value}</div>
                                      <div className="text-[10px] text-muted mt-1">
                                        Sources: {match.sources.join(', ')}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'curated' && (
          <>
            {curatedLoading ? (
              <div className="text-center py-12 text-muted text-[13px]">
                Loading curated library...
              </div>
            ) : !curatedData ? (
              <div className="text-center py-12 text-muted text-[13px]">
                No curated library found. Run the curation process first.
              </div>
            ) : (
              <>
                {/* Company items */}
                {curatedData.company?.length > 0 && (
                  <div className="border-b-2 border-blue-500/30">
                    <div className="px-4 py-2 bg-blue-500/10 text-blue-400 text-[12px] font-medium">
                      Company Information
                    </div>
                    {curatedData.company.map((topic: CuratedTopic) => {
                      const isExpanded = expandedTopics.has(`curated-company-${topic.topic}`);
                      return (
                        <div key={topic.topic} className="border-b border-default">
                          <div
                            className="flex items-center gap-2 h-10 px-4 bg-app-secondary cursor-pointer hover:bg-card-hover sticky top-0 z-10"
                            onClick={() => toggleTopic(`curated-company-${topic.topic}`)}
                          >
                            <span className="text-muted">
                              {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                            </span>
                            <span className="text-[13px] font-medium text-primary flex-1">
                              {topic.topicLabel}
                            </span>
                            <span className="text-[11px] text-muted">
                              {topic.questions.length} questions
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="divide-y divide-subtle">
                              {topic.questions.map((q: CuratedQuestion, idx: number) => {
                                const qId = `curated-company-${topic.topic}-${idx}`;
                                const isQuestionExpanded = expandedItems.has(qId);
                                return (
                                  <div key={idx} className="px-4 py-3">
                                    <div
                                      className="flex items-start gap-2 cursor-pointer"
                                      onClick={() => toggleItem(qId)}
                                    >
                                      <span className="text-muted mt-0.5">
                                        {isQuestionExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-[13px] text-primary">
                                          {q.question}
                                        </div>
                                        <div className="text-[12px] text-emerald-400 mt-1 whitespace-pre-wrap">
                                          {q.answer}
                                        </div>
                                      </div>
                                    </div>
                                    {isQuestionExpanded && (
                                      <div className="ml-6 mt-3 space-y-2">
                                        {q.originalLabels.length > 0 && (
                                          <div>
                                            <div className="text-[11px] text-muted font-medium">
                                              Original Labels ({q.originalLabels.length}):
                                            </div>
                                            <ul className="mt-1 ml-4 list-disc text-[11px] text-muted">
                                              {q.originalLabels.map((label, i) => (
                                                <li key={i}>{label}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {q.sources.length > 0 && (
                                          <div className="text-[10px] text-muted">
                                            Sources: {q.sources.join(', ')}
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
                      );
                    })}
                  </div>
                )}
                {/* Answer Library items */}
                {curatedData.answer_library?.map((topic: CuratedTopic) => {
                  const isExpanded = expandedTopics.has(`curated-${topic.topic}`);
                  return (
                    <div key={topic.topic} className="border-b border-default">
                      <div
                        className="flex items-center gap-2 h-10 px-4 bg-app-secondary cursor-pointer hover:bg-card-hover sticky top-0 z-10"
                        onClick={() => toggleTopic(`curated-${topic.topic}`)}
                      >
                        <span className="text-muted">
                          {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                        </span>
                        <span className="text-[13px] font-medium text-primary flex-1">
                          {topic.topicLabel}
                        </span>
                        <span className="text-[11px] text-muted">
                          {topic.questions.length} questions
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="divide-y divide-subtle">
                          {topic.questions.map((q: CuratedQuestion, idx: number) => {
                            const qId = `curated-${topic.topic}-${idx}`;
                            const isQuestionExpanded = expandedItems.has(qId);
                            return (
                              <div key={idx} className="px-4 py-3">
                                <div
                                  className="flex items-start gap-2 cursor-pointer"
                                  onClick={() => toggleItem(qId)}
                                >
                                  <span className="text-muted mt-0.5">
                                    {isQuestionExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-primary">
                                      {q.question}
                                    </div>
                                    <div className="text-[12px] text-emerald-400 mt-1 whitespace-pre-wrap">
                                      {q.answer}
                                    </div>
                                  </div>
                                </div>
                                {isQuestionExpanded && (
                                  <div className="ml-6 mt-3 space-y-2">
                                    {q.originalLabels.length > 0 && (
                                      <div>
                                        <div className="text-[11px] text-muted font-medium">
                                          Original Labels ({q.originalLabels.length}):
                                        </div>
                                        <ul className="mt-1 ml-4 list-disc text-[11px] text-muted">
                                          {q.originalLabels.map((label, i) => (
                                            <li key={i}>{label}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {q.sources.length > 0 && (
                                      <div className="text-[10px] text-muted">
                                        Sources: {q.sources.join(', ')}
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
                  );
                })}
              </>
            )}
          </>
        )}

        {activeTab === 'library' && (
          <>
            {filteredGroups.length === 0 ? (
              <div className="text-center py-12 text-muted text-[13px]">
                No library items found
              </div>
            ) : (
              filteredGroups.map((group) => renderTopicGroup(group))
            )}
          </>
        )}

        {activeTab === 'company' && renderItemList(data?.company.items || [])}
        {activeTab === 'product' && renderItemList(data?.product.items || [])}
        {activeTab === 'questionnaire' && renderItemList(data?.questionnaire.items || [])}
        {activeTab === 'excluded' && renderItemList(data?.excluded.items || [])}
      </div>

      {/* Stats footer */}
      <div className="h-8 px-4 flex items-center gap-4 border-t border-default bg-app-secondary text-[11px] text-muted">
        <span>{data?.stats.totalTopics} topics</span>
        <span>{data?.stats.relatedGroups} groups to review</span>
        <span>{data?.stats.suggestedMerges} suggested merges</span>
      </div>
    </div>
  );
}
