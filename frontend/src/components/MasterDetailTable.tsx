import { useState, useMemo } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { AggregatedLibraryItem } from '../types';

interface MasterDetailTableProps {
  items: AggregatedLibraryItem[];
  selectedSource?: string;
  emptyMessage?: string;
  itemLabel?: string; // e.g., "Product" or "Entity"
  groupBy?: 'source' | 'entityName'; // How to group items
}

interface GroupedItem {
  name: string;
  displayName: string;
  role?: string;
  fields: Array<{
    label: string;
    value: string;
    sources: string[];
    cellRefs?: Record<string, string>;
    id: string;
  }>;
}

// Patterns to detect entity name fields and their role
// The role is inferred from the label itself, not from a separate field
const ENTITY_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
  // Supplier patterns
  { pattern: /supplier\s*(name|company|organisation|organization)?/i, role: 'Supplier' },
  { pattern: /vendor\s*(name|company)?/i, role: 'Supplier' },

  // Manufacturer/Producer patterns
  { pattern: /manufactur(er|ing)\s*(name|company|site)?/i, role: 'Manufacturer' },
  { pattern: /producer\s*(name|company)?/i, role: 'Producer' },
  { pattern: /production\s*(site|facility|plant)\s*(name)?/i, role: 'Production Site' },

  // Customer patterns
  { pattern: /customer\s*(name|company)?/i, role: 'Customer' },
  { pattern: /client\s*(name|company)?/i, role: 'Customer' },
  { pattern: /buyer\s*(name|company)?/i, role: 'Customer' },

  // Group/Parent patterns
  { pattern: /parent\s*(company|organisation|organization)?/i, role: 'Group' },
  { pattern: /group\s*(name|company)?/i, role: 'Group' },
  { pattern: /holding\s*(company)?/i, role: 'Group' },
  { pattern: /head\s*office/i, role: 'Group' },

  // Generic company patterns (fallback, no specific role)
  { pattern: /company\s*name/i, role: '' },
  { pattern: /organisation\s*name/i, role: '' },
  { pattern: /organization\s*name/i, role: '' },
  { pattern: /business\s*name/i, role: '' },
  { pattern: /legal\s*name/i, role: '' },
  { pattern: /^name$/i, role: '' },
];

// Extract entity name and role from a field label
function extractEntityInfo(label: string): { isNameField: boolean; role: string } {
  const labelLower = label.toLowerCase().trim();

  for (const { pattern, role } of ENTITY_PATTERNS) {
    if (pattern.test(labelLower)) {
      return { isNameField: true, role };
    }
  }

  return { isNameField: false, role: '' };
}

export function MasterDetailTable({
  items,
  selectedSource = 'all',
  emptyMessage = 'No items found',
  itemLabel = 'Item',
  groupBy = 'source'
}: MasterDetailTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  // Group items by source or entity name
  const groupedItems = useMemo(() => {
    const groups = new Map<string, GroupedItem>();

    if (groupBy === 'entityName') {
      // First, group by source to collect all fields for each entity
      const sourceGroups = new Map<string, AggregatedLibraryItem[]>();

      for (const item of items) {
        // Filter by source if needed
        if (selectedSource !== 'all') {
          if (!item.sources.some(s => s.includes(selectedSource))) {
            continue;
          }
        }

        const sourceName = item.sources[0] || 'Unknown';
        if (!sourceGroups.has(sourceName)) {
          sourceGroups.set(sourceName, []);
        }
        sourceGroups.get(sourceName)!.push(item);
      }

      // Now for each source group, find entity name fields and group by name+role
      // An entity can have MULTIPLE roles across different questionnaires
      for (const [sourceName, sourceItems] of sourceGroups) {
        // Find all name fields and their roles from this source
        const entityNameFields: Array<{ name: string; role: string; item: AggregatedLibraryItem }> = [];

        for (const item of sourceItems) {
          const label = item.rephrasedQuestion || item.label;
          const { isNameField, role: detectedRole } = extractEntityInfo(label);

          // Use entityRole from data if available, otherwise use detected role
          const role = (item as any).entityRole || detectedRole;

          if (isNameField && item.value?.trim()) {
            entityNameFields.push({
              name: item.value.trim(),
              role: role || '',
              item,
            });
          }
        }

        // If we found entity name fields, create groups for EACH unique name+role combination
        // The same company can appear with different roles in different questionnaires
        if (entityNameFields.length > 0) {
          // Process ALL entity name fields found (not just the first one)
          // This handles cases where one questionnaire asks about supplier AND manufacturer
          const processedRoles = new Set<string>();

          for (const { name: entityName, role } of entityNameFields) {
            const displayName = role ? `${entityName} (${role})` : entityName;
            const groupKey = displayName.toLowerCase();

            // Skip if we already processed this role for this source
            if (processedRoles.has(groupKey)) continue;
            processedRoles.add(groupKey);

            if (!groups.has(groupKey)) {
              groups.set(groupKey, {
                name: groupKey,
                displayName,
                role,
                fields: [],
              });
            }

            const group = groups.get(groupKey)!;

            // Add items that match this entity role
            // Items with matching entityRole go to their respective group
            for (const item of sourceItems) {
              const itemRole = (item as any).entityRole || '';
              const fieldLabel = item.rephrasedQuestion || item.label;

              // Only add items that either:
              // 1. Have the same entityRole as this group
              // 2. Have no entityRole (shared fields like address might apply to all)
              const itemMatchesRole = !itemRole || itemRole === role ||
                (itemRole.toLowerCase() === role.toLowerCase());

              if (!itemMatchesRole && entityNameFields.length > 1) {
                // Multiple entities in source - only add matching items
                continue;
              }

              // Check if this field already exists
              const existingField = group.fields.find(f =>
                f.label.toLowerCase() === fieldLabel.toLowerCase()
              );

              if (existingField) {
                // Merge sources if same field from different source
                if (!existingField.sources.includes(item.sources[0])) {
                  existingField.sources.push(...item.sources);
                }
              } else {
                group.fields.push({
                  label: fieldLabel,
                  value: item.value,
                  sources: item.sources,
                  cellRefs: item.cellRefs,
                  id: item.id,
                });
              }
            }
          }
        } else {
          // No entity name found - use source as fallback
          const entityName = sourceName.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || sourceName;
          const groupKey = entityName.toLowerCase();

          if (!groups.has(groupKey)) {
            groups.set(groupKey, {
              name: groupKey,
              displayName: entityName,
              role: '',
              fields: [],
            });
          }

          const group = groups.get(groupKey)!;
          for (const item of sourceItems) {
            group.fields.push({
              label: item.rephrasedQuestion || item.label,
              value: item.value,
              sources: item.sources,
              cellRefs: item.cellRefs,
              id: item.id,
            });
          }
        }
      }
    } else {
      // Original source-based grouping (for products)
      for (const item of items) {
        // Filter by source if needed
        if (selectedSource !== 'all') {
          if (!item.sources.some(s => s.includes(selectedSource))) {
            continue;
          }
        }

        // Use the first source as the group key
        const sourceName = item.sources[0] || 'Unknown';
        const displayName = sourceName.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || sourceName;

        if (!groups.has(sourceName)) {
          groups.set(sourceName, {
            name: sourceName,
            displayName,
            fields: [],
          });
        }

        groups.get(sourceName)!.fields.push({
          label: item.rephrasedQuestion || item.label,
          value: item.value,
          sources: item.sources,
          cellRefs: item.cellRefs,
          id: item.id,
        });
      }
    }

    return Array.from(groups.values());
  }, [items, selectedSource, groupBy]);

  // Filter by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return groupedItems;
    const query = searchQuery.toLowerCase();
    return groupedItems.filter(group =>
      group.displayName.toLowerCase().includes(query) ||
      (group.role && group.role.toLowerCase().includes(query)) ||
      group.fields.some(f =>
        f.label.toLowerCase().includes(query) ||
        f.value.toLowerCase().includes(query)
      )
    );
  }, [groupedItems, searchQuery]);

  // Auto-select first item if none selected
  const effectiveSelectedItem = selectedItem && filteredItems.some(g => g.name === selectedItem)
    ? selectedItem
    : filteredItems[0]?.name || null;

  const selectedGroup = filteredItems.find(g => g.name === effectiveSelectedItem);

  const formatSource = (source: string) => {
    const name = source.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || source;
    return name.length > 20 ? name.substring(0, 20) + '…' : name;
  };

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-[13px]">
        {emptyMessage}
      </div>
    );
  }

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
            placeholder={`Search ${itemLabel.toLowerCase()}s...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Item List */}
        <div className="w-64 border-r border-default flex flex-col overflow-hidden bg-app-secondary">
          <div className="px-3 py-2 text-[11px] text-muted font-medium uppercase tracking-wide border-b border-default">
            {itemLabel}s ({filteredItems.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredItems.map((group) => (
              <button
                key={group.name}
                onClick={() => setSelectedItem(group.name)}
                className={`w-full text-left px-3 py-2 text-[13px] border-b border-subtle transition-colors ${
                  effectiveSelectedItem === group.name
                    ? 'bg-accent/10 text-accent border-l-2 border-l-accent'
                    : 'text-primary hover:bg-card-hover'
                }`}
              >
                <div className="font-medium truncate" title={group.displayName}>
                  {group.displayName}
                </div>
                <div className="text-[11px] text-muted mt-0.5">
                  {group.fields.length} fields
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right Panel - Detail View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedGroup ? (
            <>
              <div className="px-4 py-3 border-b border-default bg-app-secondary">
                <h3 className="text-[14px] font-medium text-primary">
                  {selectedGroup.displayName}
                </h3>
                <div className="text-[11px] text-muted mt-0.5">
                  {selectedGroup.fields.length} fields
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-app-secondary z-10">
                    <tr className="border-b border-default">
                      <th className="text-left px-4 py-2 text-muted font-medium w-1/3">Field</th>
                      <th className="text-left px-4 py-2 text-muted font-medium w-1/2">Value</th>
                      <th className="text-left px-4 py-2 text-muted font-medium w-1/6">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroup.fields.map((field, idx) => (
                      <tr key={`${field.id}-${idx}`} className="border-b border-subtle hover:bg-card-hover">
                        <td className="px-4 py-2 text-muted align-top">
                          <span className="whitespace-pre-wrap">{field.label}</span>
                        </td>
                        <td className="px-4 py-2 text-primary align-top">
                          <span className="whitespace-pre-wrap">{field.value || '(empty)'}</span>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {field.sources.map((source, i) => {
                              const cellRef = field.cellRefs?.[source];
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent/15 text-accent text-[10px] rounded"
                                  title={`${source}${cellRef ? ` (${cellRef})` : ''}`}
                                >
                                  <span className="truncate max-w-[80px]">{formatSource(source)}</span>
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
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted text-[13px]">
              Select a {itemLabel.toLowerCase()} to view details
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
        <span>{filteredItems.length} {itemLabel.toLowerCase()}s</span>
        {selectedGroup && (
          <>
            <span className="mx-2">|</span>
            <span>{selectedGroup.fields.length} fields</span>
          </>
        )}
      </div>
    </div>
  );
}
