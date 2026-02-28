import { useState, useMemo } from 'react';
import { CaretDown, CaretRight, MagnifyingGlass, PencilSimple, Check, X } from '@phosphor-icons/react';
import type { AggregatedLibraryItem } from '../types';

interface CompanyDataTableProps {
  items: AggregatedLibraryItem[];
  onUpdateItem?: (id: string, field: 'label' | 'value', newValue: string) => void;
}

// Group company items by topic/section for better organization
const FIELD_GROUPS: Record<string, string[]> = {
  'Basic Information': ['company name', 'legal name', 'trading name', 'street', 'address', 'post code', 'postal code', 'zip', 'city', 'state', 'country', 'phone', 'telephone', 'fax', 'email', 'website', 'url'],
  'Registration': ['registration', 'vat', 'tax', 'chamber of commerce', 'duns', 'gln', 'company number'],
  'Contacts': ['contact', 'name', 'position', 'title', 'role', 'responsible', 'manager', 'director'],
  'Business': ['employees', 'staff', 'headcount', 'turnover', 'revenue', 'founded', 'established', 'ownership', 'parent company', 'subsidiary'],
};

export function CompanyDataTable({ items, onUpdateItem }: CompanyDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Basic Information', 'Registration', 'Contacts', 'Business', 'Other']));
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, AggregatedLibraryItem[]> = {
      'Basic Information': [],
      'Registration': [],
      'Contacts': [],
      'Business': [],
      'Other': [],
    };

    const filteredItems = items.filter(item => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return item.label.toLowerCase().includes(query) ||
             item.value.toLowerCase().includes(query);
    });

    for (const item of filteredItems) {
      const labelLower = item.label.toLowerCase();
      let placed = false;

      for (const [group, keywords] of Object.entries(FIELD_GROUPS)) {
        if (keywords.some(kw => labelLower.includes(kw))) {
          groups[group].push(item);
          placed = true;
          break;
        }
      }

      if (!placed) {
        groups['Other'].push(item);
      }
    }

    return groups;
  }, [items, searchQuery]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const startEdit = (item: AggregatedLibraryItem) => {
    setEditingItem(item.id);
    setEditValue(item.value);
  };

  const saveEdit = (item: AggregatedLibraryItem) => {
    if (onUpdateItem && editValue !== item.value) {
      onUpdateItem(item.id, 'value', editValue);
    }
    setEditingItem(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditValue('');
  };

  const totalItems = Object.values(groupedItems).reduce((sum, arr) => sum + arr.length, 0);

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
            placeholder="Search company information..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {totalItems === 0 ? (
          <div className="text-center py-12 text-muted text-[13px]">
            No company information found
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-app-secondary z-10">
              <tr className="border-b border-default">
                <th className="text-left px-4 py-2 text-muted font-medium w-1/3">Field</th>
                <th className="text-left px-4 py-2 text-muted font-medium">Value</th>
                <th className="text-left px-4 py-2 text-muted font-medium w-24">Sources</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedItems).map(([group, groupItems]) => {
                if (groupItems.length === 0) return null;
                const isExpanded = expandedGroups.has(group);

                return (
                  <>
                    <tr
                      key={group}
                      className="bg-app-secondary cursor-pointer hover:bg-card-hover"
                      onClick={() => toggleGroup(group)}
                    >
                      <td colSpan={4} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-muted">
                            {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                          </span>
                          <span className="font-medium text-primary">{group}</span>
                          <span className="text-[11px] text-muted">({groupItems.length})</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && groupItems.map((item) => (
                      <tr key={item.id} className="border-b border-subtle hover:bg-card-hover">
                        <td className="px-4 py-2 text-primary align-top">
                          {item.label}
                        </td>
                        <td className="px-4 py-2 text-primary align-top">
                          {editingItem === item.id ? (
                            <input
                              type="text"
                              className="w-full px-2 py-1 bg-app border border-accent rounded text-[13px] text-primary focus:outline-none"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(item);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              autoFocus
                            />
                          ) : (
                            <span className="whitespace-pre-wrap">{item.value || '(empty)'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted text-[11px] align-top">
                          {item.sources.length > 1 ? (
                            <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                              {item.sources.length}
                            </span>
                          ) : (
                            <span className="truncate block max-w-[100px]" title={item.sources[0]}>
                              {item.sources[0]?.split('/').pop()?.split('.')[0] || '?'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          {editingItem === item.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => saveEdit(item)}
                                className="p-1 text-emerald-500 hover:bg-emerald-500/20 rounded"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="p-1 text-red-500 hover:bg-red-500/20 rounded"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : onUpdateItem ? (
                            <button
                              onClick={() => startEdit(item)}
                              className="p-1 text-muted hover:text-primary hover:bg-card-hover rounded"
                            >
                              <PencilSimple size={14} />
                            </button>
                          ) : null}
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
        <span>{totalItems} fields</span>
      </div>
    </div>
  );
}
