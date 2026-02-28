import { useState, useMemo } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { AggregatedLibraryItem } from '../types';

interface SimpleDataTableProps {
  items: AggregatedLibraryItem[];
  selectedSource?: string;
  emptyMessage?: string;
}

export function SimpleDataTable({ items, selectedSource = 'all', emptyMessage = 'No items found' }: SimpleDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter items by search and source
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return items.filter(item => {
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
  }, [items, searchQuery, selectedSource]);

  const formatSource = (source: string) => {
    const name = source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || source;
    return name.length > 20 ? name.substring(0, 20) + '…' : name;
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
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted text-[13px]">
            {emptyMessage}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-app-secondary z-10">
              <tr className="border-b border-default">
                <th className="text-left px-4 py-2 text-muted font-medium w-2/5">Label</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-1/3">Value</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-1/6">Sources</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-b border-subtle hover:bg-card-hover">
                  <td className="px-4 py-2 text-primary align-top">
                    <span className="whitespace-pre-wrap">{item.rephrasedQuestion || item.label}</span>
                  </td>
                  <td className="px-4 py-2 text-primary align-top">
                    <span className="whitespace-pre-wrap">{item.value || '(empty)'}</span>
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
                            <span className="truncate max-w-[100px]">{formatSource(source)}</span>
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
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
        <span>{filteredItems.length} items</span>
      </div>
    </div>
  );
}
