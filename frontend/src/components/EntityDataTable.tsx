import { useState, useMemo } from 'react';
import { MagnifyingGlass, Plus, PencilSimple, Check, X, Trash } from '@phosphor-icons/react';
import type { AggregatedLibraryItem } from '../types';

interface EntityDataTableProps {
  items: AggregatedLibraryItem[];
  onUpdateItem?: (id: string, field: 'label' | 'value', newValue: string) => void;
  onAddEntity?: (entityName: string) => void;
  onDeleteEntity?: (entityName: string) => void;
}

interface EntityRow {
  entityName: string;
  displayName: string;
  fields: Record<string, { value: string; id: string; sources: string[] }>;
}

export function EntityDataTable({ items, onUpdateItem, onAddEntity, onDeleteEntity }: EntityDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState<{ entityName: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');

  // Extract unique field names (columns) from all items
  const columns = useMemo(() => {
    const fieldSet = new Set<string>();
    for (const item of items) {
      fieldSet.add(item.label);
    }
    // Sort columns, but put common entity fields first
    const priorityFields = ['Company Name', 'Legal Name', 'Address', 'City', 'Country', 'VAT', 'GLN', 'Contact'];
    const sorted = Array.from(fieldSet).sort((a, b) => {
      const aIdx = priorityFields.findIndex(f => a.toLowerCase().includes(f.toLowerCase()));
      const bIdx = priorityFields.findIndex(f => b.toLowerCase().includes(f.toLowerCase()));
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [items]);

  // Group items by entity (using source as entity identifier)
  const entities = useMemo(() => {
    const entityMap = new Map<string, EntityRow>();

    for (const item of items) {
      // Use the first source as the entity identifier
      const entityName = item.sources[0] || 'Unknown';
      const displayName = entityName.split('/').pop()?.replace(/\.(xlsx|pdf|docx|json)$/i, '') || entityName;

      if (!entityMap.has(entityName)) {
        entityMap.set(entityName, {
          entityName,
          displayName,
          fields: {},
        });
      }

      const entity = entityMap.get(entityName)!;
      entity.fields[item.label] = {
        value: item.value,
        id: item.id,
        sources: item.sources,
      };
    }

    return Array.from(entityMap.values());
  }, [items]);

  // Filter entities by search
  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const query = searchQuery.toLowerCase();
    return entities.filter(e =>
      (e.displayName || '').toLowerCase().includes(query) ||
      Object.values(e.fields).some(f => (f?.value || '').toLowerCase().includes(query))
    );
  }, [entities, searchQuery]);

  const startEdit = (entityName: string, field: string, currentValue: string) => {
    setEditingCell({ entityName, field });
    setEditValue(currentValue);
  };

  const saveEdit = (entity: EntityRow) => {
    if (editingCell && onUpdateItem) {
      const fieldData = entity.fields[editingCell.field];
      if (fieldData && editValue !== fieldData.value) {
        onUpdateItem(fieldData.id, 'value', editValue);
      }
    }
    setEditingCell(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleAddEntity = () => {
    if (newEntityName.trim() && onAddEntity) {
      onAddEntity(newEntityName.trim());
      setNewEntityName('');
      setShowAddEntity(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-muted">
          <div className="text-[14px] mb-2">No entity data found</div>
          <div className="text-[12px] mb-4">Entity-specific items will appear here</div>
          {onAddEntity && (
            <button
              onClick={() => setShowAddEntity(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
            >
              <Plus size={14} />
              Add Entity
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-default flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            className="w-full h-8 pl-9 pr-3 bg-app border border-default rounded text-[13px] text-primary focus:outline-none focus:border-accent placeholder:text-muted"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {onAddEntity && (
          <button
            onClick={() => setShowAddEntity(true)}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
          >
            <Plus size={14} />
            Add Entity
          </button>
        )}
      </div>

      {/* Add Entity Modal */}
      {showAddEntity && (
        <div className="px-4 py-2 border-b border-default bg-accent/10">
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="flex-1 h-8 px-3 bg-app border border-accent rounded text-[13px] text-primary focus:outline-none"
              placeholder="Enter entity name..."
              value={newEntityName}
              onChange={(e) => setNewEntityName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddEntity();
                if (e.key === 'Escape') setShowAddEntity(false);
              }}
              autoFocus
            />
            <button
              onClick={handleAddEntity}
              className="h-8 px-3 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
            >
              Add
            </button>
            <button
              onClick={() => setShowAddEntity(false)}
              className="h-8 px-3 bg-app border border-default text-muted rounded text-[12px] hover:bg-card-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-0 bg-app-secondary z-10">
            <tr className="border-b border-default">
              <th className="text-left px-3 py-2 text-muted font-medium whitespace-nowrap sticky left-0 bg-app-secondary z-20 border-r border-default min-w-[200px]">
                Entity / Source
              </th>
              {columns.map(col => (
                <th
                  key={col}
                  className="text-left px-3 py-2 text-muted font-medium whitespace-nowrap min-w-[150px]"
                  title={col}
                >
                  <span className="block max-w-[150px] truncate">{col}</span>
                </th>
              ))}
              {onDeleteEntity && <th className="w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredEntities.map((entity) => (
              <tr key={entity.entityName} className="border-b border-subtle hover:bg-card-hover group">
                <td className="px-3 py-2 text-primary font-medium sticky left-0 bg-app z-10 border-r border-default">
                  <span className="block max-w-[200px] truncate" title={entity.entityName}>
                    {entity.displayName}
                  </span>
                </td>
                {columns.map(col => {
                  const field = entity.fields[col];
                  const isEditing = editingCell?.entityName === entity.entityName && editingCell?.field === col;

                  return (
                    <td
                      key={col}
                      className="px-3 py-2 text-primary relative group/cell"
                      onClick={() => field && onUpdateItem && startEdit(entity.entityName, col, field.value)}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            className="flex-1 px-2 py-1 bg-app border border-accent rounded text-[13px] text-primary focus:outline-none"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(entity);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); saveEdit(entity); }}
                            className="p-1 text-emerald-500 hover:bg-emerald-500/20 rounded"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                            className="p-1 text-red-500 hover:bg-red-500/20 rounded"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className={`block max-w-[150px] truncate ${!field?.value ? 'text-muted italic' : ''}`} title={field?.value}>
                            {field?.value || '-'}
                          </span>
                          {field && onUpdateItem && (
                            <button
                              className="p-1 text-muted opacity-0 group-hover/cell:opacity-100 hover:text-primary hover:bg-card-hover rounded"
                              onClick={(e) => { e.stopPropagation(); startEdit(entity.entityName, col, field.value); }}
                            >
                              <PencilSimple size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                {onDeleteEntity && (
                  <td className="px-2 py-2">
                    <button
                      onClick={() => onDeleteEntity(entity.entityName)}
                      className="p-1 text-muted hover:text-red-500 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100"
                    >
                      <Trash size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="h-8 px-4 flex items-center border-t border-default bg-app-secondary text-[11px] text-muted">
        <span>{filteredEntities.length} entities</span>
        <span className="mx-2">|</span>
        <span>{columns.length} fields</span>
      </div>
    </div>
  );
}
