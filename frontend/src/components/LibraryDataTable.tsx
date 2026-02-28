import { useState, useMemo } from 'react';
import { CaretDown, CaretRight, MagnifyingGlass } from '@phosphor-icons/react';
import type { AggregatedLibraryItem, GroupedByTopic } from '../types';

interface LibraryDataTableProps {
  groups: GroupedByTopic[];
  selectedSource: string;
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
  cleaning: 'Cleaning & Sanitation',
  pest_control: 'Pest Control',
  hygiene: 'Hygiene',
  training: 'Training',
  premises: 'Premises & Facilities',
  equipment: 'Equipment & Maintenance',
  monitoring: 'Monitoring & Testing',
  crisis: 'Crisis Management',
  food_defense: 'Food Defense',
  raw_materials: 'Raw Materials',
  sustainability: 'Sustainability',
  other: 'Other',
};

export function LibraryDataTable({ groups, selectedSource }: LibraryDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  // Flatten all items from groups and filter
  const filteredItems = useMemo(() => {
    const allItems: Array<AggregatedLibraryItem & { topicKey: string; topicLabel: string }> = [];

    for (const group of groups) {
      const topicLabel = TOPIC_LABELS[group.topic] || group.topic;

      // Add standalone items
      for (const item of group.items) {
        allItems.push({ ...item, topicKey: group.topic, topicLabel });
      }

      // Add items from related groups (but don't group them as "similar" anymore)
      for (const rg of group.relatedGroups) {
        for (const item of rg.items) {
          allItems.push({ ...item, topicKey: group.topic, topicLabel });
        }
      }
    }

    // Filter by search and source
    const query = searchQuery.toLowerCase().trim();
    return allItems.filter(item => {
      // Filter by source
      if (selectedSource !== 'all') {
        if (!item.sources.some(s => s.includes(selectedSource))) {
          return false;
        }
      }
      // Filter by search
      if (!query) return true;
      return (item.label || '').toLowerCase().includes(query) ||
        (item.value || '').toLowerCase().includes(query) ||
        (item.rephrasedQuestion || '').toLowerCase().includes(query);
    });
  }, [groups, searchQuery, selectedSource]);

  // Group filtered items by topic
  const groupedByTopic = useMemo(() => {
    const byTopic = new Map<string, Array<AggregatedLibraryItem & { topicKey: string; topicLabel: string }>>();

    for (const item of filteredItems) {
      if (!byTopic.has(item.topicKey)) {
        byTopic.set(item.topicKey, []);
      }
      byTopic.get(item.topicKey)!.push(item);
    }

    // Sort topics
    return Array.from(byTopic.entries()).sort((a, b) => {
      const labelA = TOPIC_LABELS[a[0]] || a[0];
      const labelB = TOPIC_LABELS[b[0]] || b[0];
      return labelA.localeCompare(labelB);
    });
  }, [filteredItems]);

  const toggleTopic = (topic: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

  const formatSource = (source: string) => {
    const name = source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || source;
    // Truncate long names but keep them readable
    return name.length > 25 ? name.substring(0, 25) + '…' : name;
  };

  return (
    <div className="flex flex-col h-full">
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

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted text-[13px]">
            No library items found
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-app-secondary z-10">
              <tr className="border-b border-default">
                <th className="text-left px-4 py-2 text-muted font-medium w-2/5">Question</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-1/4">Answer</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-1/6">Section</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-1/6">Sources</th>
              </tr>
            </thead>
            <tbody>
              {groupedByTopic.map(([topicKey, items]) => {
                const isExpanded = expandedTopics.has(topicKey);
                const topicLabel = TOPIC_LABELS[topicKey] || topicKey;

                return (
                  <>
                    <tr
                      key={topicKey}
                      className="bg-app-secondary cursor-pointer hover:bg-card-hover"
                      onClick={() => toggleTopic(topicKey)}
                    >
                      <td colSpan={4} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-muted">
                            {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                          </span>
                          <span className="font-medium text-primary">{topicLabel}</span>
                          <span className="text-[11px] text-muted">({items.length})</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && items.map((item) => (
                      <tr key={item.id} className="border-b border-subtle hover:bg-card-hover">
                        <td className="px-4 py-2 text-primary align-top">
                          <span className="whitespace-pre-wrap">{item.rephrasedQuestion || item.label}</span>
                        </td>
                        <td className="px-4 py-2 text-primary align-top">
                          <span className="whitespace-pre-wrap">{item.value || '(empty)'}</span>
                        </td>
                        <td className="px-4 py-2 text-muted text-[12px] align-top">
                          {item.section || '-'}
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {item.sources.map((source, i) => {
                              const cellRef = item.cellRefs?.[source];
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] rounded"
                                  title={`${source}${cellRef ? ` (${cellRef})` : ''}`}
                                >
                                  <span className="truncate max-w-[120px]">{formatSource(source)}</span>
                                  {cellRef && (
                                    <span className="text-accent/70 font-mono">{cellRef}</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
        <span>{filteredItems.length} items</span>
        <span className="mx-2">|</span>
        <span>{groupedByTopic.length} topics</span>
      </div>
    </div>
  );
}
