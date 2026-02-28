import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { List, MagnifyingGlass, GitMerge, Books, Buildings, Package, FunnelSimple, Export, Files } from '@phosphor-icons/react';
import { fetchAggregatedLibrary, mergeLibraryItems, fetchCuratedLibrary, fetchQuestionnaires } from '../api';
import type { AggregatedLibraryItem, CuratedQuestion, CuratedTopic, QuestionnaireListItem } from '../types';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { LibraryDataTable } from './LibraryDataTable';
import { SimpleDataTable } from './SimpleDataTable';
import { MasterDetailTable } from './MasterDetailTable';

interface AggregatedLibraryPanelProps {
  customer: string;
  onBack: () => void;
  onSidebarToggle?: () => void;
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

export function AggregatedLibraryPanel({ customer, onBack: _onBack, onSidebarToggle }: AggregatedLibraryPanelProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'curated' | 'library' | 'entity' | 'product' | 'metadata' | 'excluded' | 'questionnaires'>('questionnaires');
  const [selectedSource, setSelectedSource] = useState<string>('all');

  // Fetch aggregated library data
  const { data, isLoading, error } = useQuery({
    queryKey: ['aggregated-library', customer],
    queryFn: () => fetchAggregatedLibrary(customer),
  });

  // Get unique sources (questionnaires) for filtering
  const availableSources = useMemo(() => {
    if (!data?.questionnaires) return [];
    return data.questionnaires;
  }, [data?.questionnaires]);

  // Fetch curated library
  const { data: curatedData, isLoading: curatedLoading } = useQuery({
    queryKey: ['curated-library', customer],
    queryFn: () => fetchCuratedLibrary(customer),
  });

  // Fetch questionnaires metadata (for approved/imported info)
  const { data: questionnairesData } = useQuery({
    queryKey: ['questionnaires'],
    queryFn: fetchQuestionnaires,
  });

  // Build a map of questionnaire name to metadata
  const questionnaireMetadata = useMemo(() => {
    const map = new Map<string, QuestionnaireListItem>();
    questionnairesData?.questionnaires
      .filter(q => q.customer === customer)
      .forEach(q => {
        map.set(q.name, q);
        // Also map by display name for matching
        map.set(q.displayName, q);
      });
    return map;
  }, [questionnairesData, customer]);

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

  // Export to Excel
  const handleExportToExcel = useCallback(() => {
    if (!data) return;

    const wb = XLSX.utils.book_new();

    // Helper to format sources
    const formatSources = (sources: string[]) =>
      sources.map(s => s.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || s).join(', ');

    // 1. Library sheet - all library items grouped by topic
    const libraryRows: Record<string, string>[] = [];
    if (data.groups) {
      for (const group of data.groups) {
        const topicLabel = TOPIC_LABELS[group.topic] || group.topic;
        // Add standalone items
        for (const item of group.items) {
          libraryRows.push({
            'Topic': topicLabel,
            'Question': item.rephrasedQuestion || item.label,
            'Answer': item.value,
            'Section': item.section || '',
            'Sources': formatSources(item.sources),
          });
        }
        // Add items from related groups
        for (const rg of group.relatedGroups) {
          for (const item of rg.items) {
            libraryRows.push({
              'Topic': topicLabel,
              'Question': item.rephrasedQuestion || item.label,
              'Answer': item.value,
              'Section': item.section || '',
              'Sources': formatSources(item.sources),
            });
          }
        }
      }
    }
    if (libraryRows.length > 0) {
      const libraryWs = XLSX.utils.json_to_sheet(libraryRows);
      libraryWs['!cols'] = [{ wch: 25 }, { wch: 60 }, { wch: 40 }, { wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, libraryWs, 'Library');
    }

    // 2. Company sheet
    if (data.company?.items?.length > 0) {
      const companyRows = data.company.items.map((item: AggregatedLibraryItem) => ({
        'Field': item.label,
        'Value': item.value,
        'Section': item.section || '',
        'Sources': formatSources(item.sources),
      }));
      const companyWs = XLSX.utils.json_to_sheet(companyRows);
      companyWs['!cols'] = [{ wch: 30 }, { wch: 50 }, { wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, companyWs, 'Company');
    }

    // 3. Product sheet - database format with products as rows
    if (data.product?.items?.length > 0) {
      // Get all unique field labels
      const allFields = [...new Set(data.product.items.map((item: AggregatedLibraryItem) => item.label))];
      // Group by source (product)
      const bySource = new Map<string, Record<string, string>>();
      for (const item of data.product.items) {
        const source = item.sources[0] || 'Unknown';
        if (!bySource.has(source)) {
          bySource.set(source, { 'Product/Source': formatSources([source]) });
        }
        bySource.get(source)![item.label] = item.value;
      }
      const productRows = Array.from(bySource.values());
      if (productRows.length > 0) {
        const headers = ['Product/Source', ...allFields];
        const productWs = XLSX.utils.json_to_sheet(productRows, { header: headers });
        const productCols = [{ wch: 40 }];
        for (let i = 0; i < allFields.length; i++) productCols.push({ wch: 25 });
        productWs['!cols'] = productCols;
        XLSX.utils.book_append_sheet(wb, productWs, 'Product');
      }
    }

    // 4. Questionnaire sheet
    if (data.questionnaire?.items?.length > 0) {
      const questionnaireRows = data.questionnaire.items.map((item: AggregatedLibraryItem) => ({
        'Question': item.label,
        'Answer': item.value,
        'Section': item.section || '',
        'Sources': formatSources(item.sources),
      }));
      const questionnaireWs = XLSX.utils.json_to_sheet(questionnaireRows);
      questionnaireWs['!cols'] = [{ wch: 60 }, { wch: 40 }, { wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, questionnaireWs, 'Questionnaire');
    }

    // 5. Excluded sheet
    if (data.excluded?.items?.length > 0) {
      const excludedRows = data.excluded.items.map((item: AggregatedLibraryItem) => ({
        'Question': item.label,
        'Answer': item.value,
        'Section': item.section || '',
        'Sources': formatSources(item.sources),
      }));
      const excludedWs = XLSX.utils.json_to_sheet(excludedRows);
      excludedWs['!cols'] = [{ wch: 60 }, { wch: 40 }, { wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, excludedWs, 'Excluded');
    }

    // Download
    const filename = `${customer.replace(/ /g, '_')}_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success('Exported to Excel', { description: filename });
  }, [data, customer]);

  const handleMerge = () => {
    if (selectedForMerge.size < 2) return;
    const itemIds = Array.from(selectedForMerge);
    const keepId = itemIds[0]; // Keep the first one
    mergeMutation.mutate({ itemIds, keepId });
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
        {onSidebarToggle && (
          <button
            onClick={onSidebarToggle}
            className="p-1.5 rounded hover:bg-card-hover text-muted hover:text-primary transition-colors"
            title="Open sidebar"
          >
            <List size={18} />
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-[14px] font-medium text-primary">
            Database - {customer}
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
        <button
          onClick={handleExportToExcel}
          disabled={!data}
          className="h-7 px-3 rounded bg-emerald-600 text-white text-[12px] font-medium flex items-center gap-1.5 hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          <Export size={14} />
          Export Excel
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-default bg-app-secondary">
        <button
          onClick={() => setActiveTab('questionnaires')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'questionnaires'
              ? 'bg-cyan-500/20 text-cyan-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          <Files size={14} />
          Questionnaires ({data?.questionnaires.length || 0})
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
          onClick={() => setActiveTab('entity')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'entity'
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          <Buildings size={14} />
          Entities ({data?.company.count || 0})
        </button>
        <button
          onClick={() => setActiveTab('product')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'product'
              ? 'bg-orange-500/20 text-orange-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          <Package size={14} />
          Product ({data?.product.count || 0})
        </button>
        <button
          onClick={() => setActiveTab('metadata')}
          className={`h-7 px-3 rounded text-[12px] font-medium transition-colors ${
            activeTab === 'metadata'
              ? 'bg-purple-500/20 text-purple-400'
              : 'text-muted hover:bg-card-hover'
          }`}
        >
          Metadata ({data?.questionnaire.count || 0})
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
      </div>

      {/* Search and Filter */}
      <div className="px-4 py-2 border-b border-default flex items-center gap-3">
        <div className="relative flex-1">
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
        {availableSources.length > 1 && (
          <div className="flex items-center gap-2">
            <FunnelSimple size={14} className="text-muted" />
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="h-8 px-2 bg-app border border-default rounded text-[12px] text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">All questionnaires</option>
              {availableSources.map((source) => (
                <option key={source} value={source}>
                  {source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '').substring(0, 40) || source}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'curated' && (
          <div className="flex flex-col h-full">
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
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-app-secondary z-10">
                      <tr className="border-b border-default">
                        <th className="text-left px-4 py-2 text-muted font-medium w-2/5">Question</th>
                        <th className="text-left px-4 py-2 text-muted font-medium w-1/3">Answer</th>
                        <th className="text-left px-4 py-2 text-muted font-medium w-24">Type</th>
                        <th className="text-left px-4 py-2 text-muted font-medium w-1/6">Sources</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Company items */}
                      {curatedData.company?.flatMap((topic: CuratedTopic) =>
                        topic.questions.map((q: CuratedQuestion, idx: number) => (
                          <tr key={`company-${topic.topic}-${idx}`} className="border-b border-subtle hover:bg-card-hover">
                            <td className="px-4 py-2 text-primary align-top">
                              <span className="whitespace-pre-wrap">{q.question}</span>
                            </td>
                            <td className="px-4 py-2 text-primary align-top">
                              <span className="whitespace-pre-wrap">{q.answer}</span>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <span className="px-1.5 py-0.5 bg-blue-500/15 text-blue-400 text-[10px] rounded">
                                Entity
                              </span>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <div className="flex flex-wrap gap-1">
                                {q.sources.map((source, i) => (
                                  <span
                                    key={i}
                                    className="inline-block px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] rounded truncate max-w-[100px]"
                                    title={source}
                                  >
                                    {source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '').substring(0, 15) || source}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                      {/* Answer Library items */}
                      {curatedData.answer_library?.flatMap((topic: CuratedTopic) =>
                        topic.questions.map((q: CuratedQuestion, idx: number) => (
                          <tr key={`library-${topic.topic}-${idx}`} className="border-b border-subtle hover:bg-card-hover">
                            <td className="px-4 py-2 text-primary align-top">
                              <span className="whitespace-pre-wrap">{q.question}</span>
                            </td>
                            <td className="px-4 py-2 text-primary align-top">
                              <span className="whitespace-pre-wrap">{q.answer}</span>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 text-[10px] rounded">
                                Library
                              </span>
                            </td>
                            <td className="px-4 py-2 align-top">
                              <div className="flex flex-wrap gap-1">
                                {q.sources.map((source, i) => (
                                  <span
                                    key={i}
                                    className="inline-block px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] rounded truncate max-w-[100px]"
                                    title={source}
                                  >
                                    {source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '').substring(0, 15) || source}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
                  <span>
                    {(curatedData.company?.reduce((sum, t) => sum + t.questions.length, 0) || 0) +
                     (curatedData.answer_library?.reduce((sum, t) => sum + t.questions.length, 0) || 0)} curated questions
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'library' && (
          <LibraryDataTable groups={data?.groups || []} selectedSource={selectedSource} />
        )}

        {activeTab === 'entity' && (
          <MasterDetailTable
            items={data?.company.items || []}
            selectedSource={selectedSource}
            emptyMessage="No entity data found"
            itemLabel="Entity"
            groupBy="entityName"
          />
        )}
        {activeTab === 'product' && (
          <MasterDetailTable
            items={data?.product.items || []}
            selectedSource={selectedSource}
            emptyMessage="No product data found"
            itemLabel="Product"
          />
        )}
        {activeTab === 'metadata' && (
          <SimpleDataTable
            items={data?.questionnaire.items || []}
            selectedSource={selectedSource}
            emptyMessage="No metadata found"
          />
        )}
        {activeTab === 'excluded' && (
          <SimpleDataTable
            items={data?.excluded.items || []}
            selectedSource={selectedSource}
            emptyMessage="No excluded items"
          />
        )}
        {activeTab === 'questionnaires' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-app-secondary z-10">
                  <tr className="border-b border-default">
                    <th className="text-left px-4 py-2 text-muted font-medium">Questionnaire</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-20">Total</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-20">Library</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-20">Entity</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-20">Product</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-24">Approved</th>
                    <th className="text-center px-4 py-2 text-muted font-medium w-24">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.questionnaires.map((source) => {
                    const countFromSource = (items: AggregatedLibraryItem[]) =>
                      items.filter(item => item.sources.includes(source)).length;

                    const libraryCount = data.groups.reduce((sum, g) => {
                      return sum +
                        countFromSource(g.items) +
                        g.relatedGroups.reduce((s, rg) => s + countFromSource(rg.items), 0);
                    }, 0);
                    const companyCount = countFromSource(data.company.items);
                    const productCount = countFromSource(data.product.items);
                    const questionnaireCount = countFromSource(data.questionnaire.items);
                    const excludedCount = countFromSource(data.excluded.items);
                    const totalCount = libraryCount + companyCount + productCount + questionnaireCount + excludedCount;

                    const sourceName = source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || source;

                    // Get metadata for this questionnaire
                    const metadata = questionnaireMetadata.get(sourceName) || questionnaireMetadata.get(source);

                    const formatRelativeTime = (dateStr: string) => {
                      const date = new Date(dateStr);
                      const now = new Date();
                      const diffMs = now.getTime() - date.getTime();
                      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                      const diffDays = Math.floor(diffHours / 24);
                      if (diffDays > 0) return `${diffDays}d ago`;
                      if (diffHours > 0) return `${diffHours}h ago`;
                      return 'just now';
                    };

                    return (
                      <tr key={source} className="border-b border-subtle hover:bg-card-hover">
                        <td className="px-4 py-2 text-primary" title={source}>
                          {sourceName}
                        </td>
                        <td className="px-4 py-2 text-center text-primary font-medium">
                          {totalCount}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {libraryCount > 0 ? (
                            <span className="text-emerald-400">{libraryCount}</span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {companyCount > 0 ? (
                            <span className="text-blue-400">{companyCount}</span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {productCount > 0 ? (
                            <span className="text-orange-400">{productCount}</span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {metadata?.approvedCount ? (
                            <div className="flex flex-col items-center">
                              <span className="text-emerald-400 font-medium">{metadata.approvedCount}</span>
                              {metadata.approvedAt && (
                                <span className="text-[10px] text-muted">{formatRelativeTime(metadata.approvedAt)}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {metadata?.apiReadyCount ? (
                            <div className="flex flex-col items-center">
                              <span className="text-blue-400 font-medium">{metadata.apiReadyCount}</span>
                              {metadata.apiReadyAt && (
                                <span className="text-[10px] text-muted">{formatRelativeTime(metadata.apiReadyAt)}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
              <span>{data?.questionnaires.length || 0} questionnaires</span>
            </div>
          </div>
        )}
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
