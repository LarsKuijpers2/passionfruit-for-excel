import { useState, useMemo } from 'react';
import { MagnifyingGlass, Plus, PencilSimple, Check, X, Trash } from '@phosphor-icons/react';
import type { AggregatedLibraryItem } from '../types';

interface ProductDataTableProps {
  items: AggregatedLibraryItem[];
  onUpdateItem?: (id: string, field: 'label' | 'value', newValue: string) => void;
  onAddProduct?: (productName: string) => void;
  onDeleteProduct?: (productName: string) => void;
}

interface ProductRow {
  productName: string;
  fields: Record<string, { value: string; id: string; sources: string[] }>;
}

export function ProductDataTable({ items, onUpdateItem, onAddProduct, onDeleteProduct }: ProductDataTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState<{ productName: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  // Extract unique field names (columns) from all items
  const columns = useMemo(() => {
    const fieldSet = new Set<string>();
    for (const item of items) {
      // Use the label as the field name
      fieldSet.add(item.label);
    }
    // Sort columns, but put common ones first
    const priorityFields = ['Product Name', 'Product Supplied', 'ORGANIC', 'HALAL', 'KOSHER'];
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

  // Group items by product (using source or a product identifier)
  // For now, we'll group by the source questionnaire as a proxy for different products
  const products = useMemo(() => {
    const productMap = new Map<string, ProductRow>();

    for (const item of items) {
      // Use the first source as the product identifier
      // In a real scenario, this would be the actual product name
      const productName = item.sources[0] || 'Unknown';

      if (!productMap.has(productName)) {
        productMap.set(productName, {
          productName,
          fields: {},
        });
      }

      const product = productMap.get(productName)!;
      product.fields[item.label] = {
        value: item.value,
        id: item.id,
        sources: item.sources,
      };
    }

    return Array.from(productMap.values());
  }, [items]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const query = searchQuery.toLowerCase();
    return products.filter(p =>
      (p.productName || '').toLowerCase().includes(query) ||
      Object.values(p.fields).some(f => (f?.value || '').toLowerCase().includes(query))
    );
  }, [products, searchQuery]);

  const startEdit = (productName: string, field: string, currentValue: string) => {
    setEditingCell({ productName, field });
    setEditValue(currentValue);
  };

  const saveEdit = (product: ProductRow) => {
    if (editingCell && onUpdateItem) {
      const fieldData = product.fields[editingCell.field];
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

  const handleAddProduct = () => {
    if (newProductName.trim() && onAddProduct) {
      onAddProduct(newProductName.trim());
      setNewProductName('');
      setShowAddProduct(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-muted">
          <div className="text-[14px] mb-2">No product data found</div>
          <div className="text-[12px] mb-4">Product-specific items will appear here</div>
          {onAddProduct && (
            <button
              onClick={() => setShowAddProduct(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
            >
              <Plus size={14} />
              Add Product
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
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {onAddProduct && (
          <button
            onClick={() => setShowAddProduct(true)}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
          >
            <Plus size={14} />
            Add Product
          </button>
        )}
      </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="px-4 py-2 border-b border-default bg-accent/10">
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="flex-1 h-8 px-3 bg-app border border-accent rounded text-[13px] text-primary focus:outline-none"
              placeholder="Enter product name..."
              value={newProductName}
              onChange={(e) => setNewProductName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddProduct();
                if (e.key === 'Escape') setShowAddProduct(false);
              }}
              autoFocus
            />
            <button
              onClick={handleAddProduct}
              className="h-8 px-3 bg-accent text-white rounded text-[12px] hover:bg-accent-hover"
            >
              Add
            </button>
            <button
              onClick={() => setShowAddProduct(false)}
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
                Product
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
              {onDeleteProduct && <th className="w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.productName} className="border-b border-subtle hover:bg-card-hover">
                <td className="px-3 py-2 text-primary font-medium sticky left-0 bg-app z-10 border-r border-default">
                  <span className="block max-w-[200px] truncate" title={product.productName}>
                    {product.productName.split('/').pop()?.split('.')[0] || product.productName}
                  </span>
                </td>
                {columns.map(col => {
                  const field = product.fields[col];
                  const isEditing = editingCell?.productName === product.productName && editingCell?.field === col;

                  return (
                    <td
                      key={col}
                      className="px-3 py-2 text-primary relative group"
                      onClick={() => field && onUpdateItem && startEdit(product.productName, col, field.value)}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            className="flex-1 px-2 py-1 bg-app border border-accent rounded text-[13px] text-primary focus:outline-none"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(product);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); saveEdit(product); }}
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
                              className="p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-card-hover rounded"
                              onClick={(e) => { e.stopPropagation(); startEdit(product.productName, col, field.value); }}
                            >
                              <PencilSimple size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                {onDeleteProduct && (
                  <td className="px-2 py-2">
                    <button
                      onClick={() => onDeleteProduct(product.productName)}
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
        <span>{filteredProducts.length} products</span>
        <span className="mx-2">|</span>
        <span>{columns.length} fields</span>
      </div>
    </div>
  );
}
