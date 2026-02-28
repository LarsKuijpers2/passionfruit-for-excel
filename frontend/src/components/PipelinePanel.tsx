import { useQuery } from "@tanstack/react-query";
import { fetchPipeline } from "../api";
import { ArrowLeft, List, CircleNotch, CheckCircle, Warning, Clock, FileText, Package, Buildings } from "@phosphor-icons/react";

interface PipelinePanelProps {
  customer: string;
  onBack: () => void;
  onSidebarToggle: () => void;
  onQuestionnaireClick: (filename: string) => void;
}

const STATUS_CONFIG = {
  incoming: { icon: Clock, color: "text-gray-400", bg: "bg-gray-500/20", label: "Incoming" },
  stored: { icon: FileText, color: "text-blue-400", bg: "bg-blue-500/20", label: "Stored" },
  indexed: { icon: CircleNotch, color: "text-amber-400", bg: "bg-amber-500/20", label: "Indexed" },
  reviewed: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/20", label: "Reviewed" },
  approved: { icon: CheckCircle, color: "text-emerald-500", bg: "bg-emerald-500/30", label: "Approved" },
};

export function PipelinePanel({ customer, onBack, onSidebarToggle, onQuestionnaireClick }: PipelinePanelProps) {
  const { data: pipeline, isLoading, error } = useQuery({
    queryKey: ["pipeline", customer],
    queryFn: () => fetchPipeline(customer),
    refetchInterval: 5000, // Refresh every 5s to show indexing progress
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-app">
        <Header customer={customer} onBack={onBack} onSidebarToggle={onSidebarToggle} />
        <div className="flex-1 flex items-center justify-center">
          <CircleNotch className="w-6 h-6 animate-spin text-muted" />
        </div>
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="flex flex-col h-screen bg-app">
        <Header customer={customer} onBack={onBack} onSidebarToggle={onSidebarToggle} />
        <div className="flex-1 flex items-center justify-center text-muted">
          Failed to load pipeline data
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-app">
      <Header customer={customer} onBack={onBack} onSidebarToggle={onSidebarToggle} />

      {/* Pipeline stats bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-app-secondary border-b border-default">
        {Object.entries(pipeline.counts).map(([status, count]) => {
          const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
          return (
            <div key={status} className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
                {config.label}
              </span>
              <span className="text-[13px] font-medium text-primary">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Supplier info */}
      {pipeline.supplier && (
        <div className="px-6 py-4 border-b border-default bg-card">
          <div className="flex items-center gap-3">
            <Buildings className="w-5 h-5 text-muted" />
            <div>
              <div className="text-[14px] font-medium text-primary">{pipeline.supplier.name}</div>
              {pipeline.supplier.address && (
                <div className="text-[12px] text-muted">{pipeline.supplier.address}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Products */}
      {pipeline.products && pipeline.products.length > 0 && (
        <div className="px-6 py-3 border-b border-default bg-app-secondary">
          <div className="flex items-center gap-2 flex-wrap">
            <Package className="w-4 h-4 text-muted" />
            <span className="text-[11px] text-muted">Products:</span>
            {pipeline.products.map(product => (
              <span key={product.id} className="text-[11px] px-2 py-0.5 bg-accent/20 text-accent rounded">
                {product.name}
                {product.variants && product.variants.length > 0 && (
                  <span className="text-muted ml-1">({product.variants.length} variants)</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Questionnaires list */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-app-secondary sticky top-0">
            <tr className="text-left text-muted">
              <th className="px-6 py-2 font-medium">Questionnaire</th>
              <th className="px-4 py-2 font-medium w-28">Requested By</th>
              <th className="px-4 py-2 font-medium w-28">Product</th>
              <th className="px-4 py-2 font-medium w-20">Type</th>
              <th className="px-4 py-2 font-medium w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {pipeline.questionnaires.map((q, idx) => {
              const config = STATUS_CONFIG[q.status];
              const StatusIcon = config.icon;

              return (
                <tr
                  key={idx}
                  className="border-t border-default hover:bg-card-hover cursor-pointer transition-colors"
                  onClick={() => onQuestionnaireClick(q.file)}
                >
                  <td className="px-6 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-primary font-medium truncate max-w-[400px]" title={q.file}>
                        {q.file}
                      </span>
                      {q.understanding?.summary && (
                        <span className="text-[11px] text-muted truncate max-w-[500px]" title={q.understanding.summary}>
                          {q.understanding.summary}
                        </span>
                      )}
                      {q.understanding?.needsReview && q.understanding.needsReview.length > 0 && (
                        <div className="flex items-center gap-1 text-[10px] text-amber-400">
                          <Warning size={12} />
                          {q.understanding.needsReview.length} items need review
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {q.requestedBy || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {q.product ? (
                      <span className="text-[11px] px-1.5 py-0.5 bg-accent/20 text-accent rounded">
                        {q.product}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      q.type === 'product' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {q.type || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-1.5 ${config.color}`}>
                      <StatusIcon size={14} className={q.status === 'indexed' ? '' : ''} />
                      <span className="text-[11px]">{config.label}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header({ customer, onBack, onSidebarToggle }: { customer: string; onBack: () => void; onSidebarToggle: () => void }) {
  return (
    <div className="h-10 px-4 flex items-center gap-3 bg-app-secondary border-b border-default shrink-0">
      <button
        onClick={onSidebarToggle}
        className="p-1 rounded hover:bg-card-hover text-muted hover:text-primary transition-colors"
      >
        <List size={18} />
      </button>
      <button
        onClick={onBack}
        className="p-1 rounded hover:bg-card-hover text-muted hover:text-primary transition-colors"
      >
        <ArrowLeft size={18} />
      </button>
      <span className="text-[14px] font-medium text-primary">{customer}</span>
      <span className="text-[12px] text-muted">Pipeline</span>
    </div>
  );
}
