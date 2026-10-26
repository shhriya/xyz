import React from 'react';
import {
  Plus,
  CheckCircle2,
  Server,
  Key,
  Zap,
  Bookmark,
  Database
} from 'lucide-react';

/**
 * Connection identity only. Choosing the database / schema lives in Step 1 of the
 * Semantic Model wizard, so it is not duplicated here — this bar just reports the
 * scope that is currently in effect.
 */
export default function SnowflakeConnectionBar({
  connections = [],
  selectedConnection,
  onSelectConnection,
  activeDatabase,
  activeSchema,
  onOpenNewModal,
  onOpenEditModal
}) {
  const hasPassword = Boolean(selectedConnection?.password);
  const scope = activeDatabase && activeSchema ? `${activeDatabase}.${activeSchema}` : null;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
      {/* Row 1: Account identity + actions + active scope */}
      <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Linked Account Selector */}
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 flex items-center space-x-3 min-w-[240px]">
            <div className="w-8 h-8 rounded-lg bg-[#10338D]/10 border border-[#10338D]/20 flex items-center justify-center shrink-0">
              <Bookmark className="w-4 h-4 text-[#10338D]" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block leading-tight">
                Linked Snowflake Account
              </span>
              <select
                value={selectedConnection?.id || ''}
                onChange={(e) => {
                  const conn = connections.find(c => c.id === e.target.value);
                  if (conn) onSelectConnection(conn);
                }}
                className="bg-transparent text-[#0F172A] font-semibold text-xs focus:outline-none cursor-pointer w-full truncate mt-0.5"
              >
                {connections.length === 0 ? (
                  <option value="" className="bg-white text-[#64748B]">
                    Live Session Active ({selectedConnection?.account || 'Connected'})
                  </option>
                ) : (
                  connections.map((c) => (
                    <option key={c.id} value={c.id} className="bg-white text-[#0F172A]">
                      {c.name} ({c.account || 'Snowflake'})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {selectedConnection && (
            <button
              onClick={onOpenEditModal}
              className="bg-white hover:bg-[#F1F5F9] text-[#1E293B] border border-[#CBD5E1] text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center space-x-2 cursor-pointer transition-all shrink-0"
              title="Edit connection credentials and Cortex settings"
            >
              <Key className="w-3.5 h-3.5 text-[#1C58F6]" />
              <span>Edit Settings</span>
            </button>
          )}

          <button
            onClick={onOpenNewModal}
            className="bg-[#10338D] hover:bg-[#1C58F6] text-white text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center space-x-2 cursor-pointer shadow-sm transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Account</span>
          </button>
        </div>

        {/* Active scope — read-only; selection happens in Step 1 */}
        <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5">
          <Database className="w-4 h-4 text-[#1C58F6] shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block leading-tight">
              Active Scope
            </span>
            {scope ? (
              <span className="text-xs font-mono font-bold text-[#0F172A] truncate block mt-0.5">{scope}</span>
            ) : (
              <span className="text-xs font-medium text-[#94A3B8] block mt-0.5">Choose in Step 1 below</span>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Session status */}
      <div className="px-5 py-2.5 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#475569]">
          <span className="flex items-center space-x-1.5">
            <Server className="w-3.5 h-3.5 text-[#1C58F6]" />
            <span>Warehouse: <strong className="text-[#0F172A] font-semibold">{selectedConnection?.warehouse || 'COMPUTE_WH'}</strong></span>
          </span>
          <span className="text-[#CBD5E1]">•</span>
          <span>Role: <strong className="text-[#0F172A] font-semibold">{selectedConnection?.role || 'ACCOUNTADMIN'}</strong></span>
          <span className="text-[#CBD5E1]">•</span>
          <span>Account: <strong className="text-[#1C58F6] font-semibold">{selectedConnection?.account || 'Not connected'}</strong></span>
        </div>

        <div className="flex items-center">
          {hasPassword ? (
            <span className="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex items-center space-x-1.5 text-[11px]">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Direct SSL Live Session</span>
            </span>
          ) : (
            <span className="text-[#1C58F6] font-bold bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 flex items-center space-x-1.5 text-[11px]">
              <Zap className="w-3 h-3 text-[#1C58F6]" />
              <span>Auto-Detected Metadata Active</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
