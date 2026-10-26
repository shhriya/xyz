import React, { useState } from 'react';
import {
  Search,
  UserCheck,
  Clock,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Database,
  Coins,
  X,
  Filter,
} from 'lucide-react';

export default function UserCostTable({ users = [] }) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [selectedUserForModal, setSelectedUserForModal] = useState(null);
  const [copiedQueryId, setCopiedQueryId] = useState(null);
  const [modalSearch, setModalSearch] = useState('');

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.username.toLowerCase().includes(search.toLowerCase()) || 
                          (u.email && u.email.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const rolesList = ['ALL', ...new Set(users.map(u => u.role).filter(Boolean))];

  const handleCopySql = (queryId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedQueryId(queryId);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  const formatDuration = (sec) => {
    if (sec == null) return '0s';
    if (sec < 60) return `${sec.toFixed(1)}s`;
    if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
    return `${(sec / 3600).toFixed(1)}h`;
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  };

  // Filter queries inside the modal
  const modalQueries = (selectedUserForModal?.queries || []).filter(q =>
    (q.queryText || '').toLowerCase().includes(modalSearch.toLowerCase()) ||
    (q.queryType || '').toLowerCase().includes(modalSearch.toLowerCase())
  );

  return (
    <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-xs space-y-5 min-w-0 max-w-full overflow-hidden">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#ECEFFF] min-w-0">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 bg-[#ECEFFF] text-[#10338D] px-2.5 py-0.5 rounded-full text-xs font-bold border border-[#D1DEFF] mb-1">
            <UserCheck className="w-3.5 h-3.5 text-[#1C58F6]" />
            <span>User Cost &amp; Compute Attribution</span>
          </div>
          <h2 className="text-lg font-black text-[#10338D] tracking-tight">
            Team Member Usage &amp; Spend Attribution
          </h2>
          <p className="text-xs text-[#666666]">
            Summary of compute credits consumed per user account with on-demand query execution auditing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Role Filter */}
          <div className="flex items-center gap-1.5 bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl px-3 py-1.5">
            <Filter className="w-3.5 h-3.5 text-[#666666]" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-[#10338D] outline-none cursor-pointer"
            >
              {rolesList.map(r => (
                <option key={r} value={r}>{r === 'ALL' ? 'All Roles' : r}</option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search user or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl text-xs pl-8 pr-3 py-1.5 outline-none focus:border-[#1C58F6] w-48 sm:w-56 text-[#10338D]"
            />
          </div>
        </div>
      </div>

      {/* Unified Full-Width Table (100% Screen Fit, Zero Horizontal Scroll) */}
      <div className="w-full max-w-full min-w-0 overflow-x-auto rounded-xl border border-[#D1DEFF]">
        <table className="w-full min-w-[620px] sm:min-w-0 text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAFC] border-b border-[#D1DEFF] text-[#666666] font-bold uppercase tracking-wider text-[11px]">
              <th className="py-3 px-4 w-1/3">User / Account</th>
              <th className="py-3 px-4 w-1/5">Primary Warehouse</th>
              <th className="py-3 px-4 w-1/6 text-right">Queries Run</th>
              <th className="py-3 px-4 w-1/6 text-right">Credits Consumed</th>
              <th className="py-3 px-4 w-1/6 text-center">SQL Forensics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ECEFFF]">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-[#666666] text-xs">
                  No team members match the search criteria.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const queryCount = u.queries?.length || 0;
                return (
                  <tr key={u.userId} className="hover:bg-[#F8FAFC] transition-colors">
                    {/* User info */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#ECEFFF] text-[#10338D] font-mono text-xs font-black flex items-center justify-center border border-[#D1DEFF] shrink-0">
                          {u.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-[#10338D] truncate">{u.username}</span>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-[#ECEFFF] text-[#1C58F6] border border-[#D1DEFF]">
                              {u.role}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#666666] truncate mt-0.5">{u.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Warehouse */}
                    <td className="py-3.5 px-4 font-mono text-[#10338D] font-medium">
                      <div className="flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-[#1C58F6] shrink-0" />
                        <span className="truncate">{u.topWarehouse}</span>
                      </div>
                    </td>

                    {/* Queries Run */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="font-mono font-bold text-[#10338D]">
                        {u.queriesRun.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-[#666666] font-mono">
                        avg {u.avgQueryTimeSec}s
                      </div>
                    </td>

                    {/* Credits Consumed */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="font-mono font-black text-[#10338D]">
                        {u.creditsConsumed} cr
                      </div>
                      {u.estimatedCostUsd != null && (
                        <div className="text-[10px] font-bold text-emerald-600 font-mono">
                          ${u.estimatedCostUsd.toFixed(2)}
                        </div>
                      )}
                    </td>

                    {/* Action Button: View Queries */}
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={() => {
                          setSelectedUserForModal(u);
                          setModalSearch('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-[#ECEFFF] text-[#10338D] hover:text-[#1C58F6] border border-[#D1DEFF] text-xs font-bold transition-all shadow-2xs cursor-pointer"
                      >
                        <Terminal className="w-3 h-3 text-[#1C58F6]" />
                        <span>View Queries</span>
                        {queryCount > 0 && (
                          <span className="text-[10px] font-mono bg-[#ECEFFF] text-[#1C58F6] px-1.5 py-0.2 rounded font-black">
                            {queryCount}
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ============================================================ */}
      {/* EXECUTIVE QUERY FORENSICS MODAL (Focused, Clean, Non-Awkward) */}
      {/* ============================================================ */}
      {selectedUserForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-[#D1DEFF] shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-[#ECEFFF] flex items-center justify-between bg-[#F8FAFC]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#10338D] text-white font-mono text-xs font-black flex items-center justify-center">
                  {selectedUserForModal.username.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-[#10338D]">
                      SQL Execution Forensics: {selectedUserForModal.username}
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#ECEFFF] text-[#1C58F6] border border-[#D1DEFF] font-bold">
                      {selectedUserForModal.role}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#666666]">
                    Total Compute: <strong className="text-[#10338D] font-mono">{selectedUserForModal.creditsConsumed} cr</strong> • {selectedUserForModal.queriesRun.toLocaleString()} queries executed
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedUserForModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-200 text-[#666666] hover:text-[#10338D] transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Filter Bar */}
            <div className="p-4 border-b border-[#ECEFFF] bg-white flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search SQL query text or type..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl text-xs pl-8 pr-3 py-2 outline-none focus:border-[#1C58F6] text-[#10338D]"
                />
              </div>
              <span className="text-[11px] text-[#666666] font-mono shrink-0">
                Showing {modalQueries.length} of {selectedUserForModal.queries?.length || 0} queries
              </span>
            </div>

            {/* Modal Query Cards List */}
            <div className="p-5 overflow-y-auto space-y-3 bg-[#F8FAFC] flex-1">
              {modalQueries.length === 0 ? (
                <div className="bg-white border border-[#D1DEFF] rounded-xl p-8 text-center text-xs text-[#666666]">
                  No query statements found matching "{modalSearch}".
                </div>
              ) : (
                modalQueries.map((q, qIdx) => (
                  <div
                    key={q.queryId || qIdx}
                    className="bg-white border border-[#D1DEFF] rounded-xl p-4 shadow-2xs space-y-2 hover:border-[#1C58F6] transition-all"
                  >
                    {/* Metadata Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          q.queryType === 'SELECT' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          q.queryType === 'INSERT' ? 'bg-green-50 text-green-700 border border-green-200' :
                          q.queryType === 'CREATE_TABLE_AS_SELECT' || q.queryType === 'CREATE' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                          q.queryType === 'ALTER' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                          q.queryType === 'DELETE' || q.queryType === 'DROP' ? 'bg-red-50 text-red-700 border border-red-200' :
                          'bg-gray-50 text-gray-700 border border-gray-200'
                        }`}>
                          {q.queryType}
                        </span>

                        <span className="text-[11px] font-mono text-[#666666] flex items-center gap-1">
                          <Database className="w-3 h-3 text-[#1C58F6]" />
                          {q.warehouseName}
                        </span>

                        <span className="text-[10px] text-[#666666]">
                          {formatTimestamp(q.startTime)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-[#666666] flex items-center gap-1 text-[11px]">
                          <Clock className="w-3 h-3" />
                          {formatDuration(q.elapsedSec)}
                        </span>

                        <span className="font-bold text-amber-700 flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px]">
                          <Coins className="w-3 h-3" />
                          {q.estimatedCredits.toFixed(4)} cr
                        </span>

                        {q.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            SUCCESS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 font-bold">
                            <AlertTriangle className="w-3 h-3 text-red-600" />
                            FAIL
                          </span>
                        )}
                      </div>
                    </div>

                    {/* SQL Statement Code Block */}
                    <div className="relative group">
                      <pre className="bg-[#F8FAFC] border border-[#D1DEFF] rounded-lg p-3 text-[11px] font-mono text-[#10338D] whitespace-pre-wrap break-all leading-relaxed max-h-36 overflow-y-auto">
                        {q.queryText}
                      </pre>

                      <button
                        onClick={() => handleCopySql(q.queryId, q.queryText)}
                        className="absolute right-2 top-2 p-1.5 rounded-md bg-white border border-[#D1DEFF] text-[#666666] hover:text-[#10338D] shadow-2xs hover:bg-[#ECEFFF] transition-all cursor-pointer"
                        title="Copy SQL Query"
                      >
                        {copiedQueryId === q.queryId ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Query ID & Rows Footer */}
                    <div className="flex items-center justify-between text-[10px] text-[#666666] pt-0.5">
                      <span>Query ID: <strong className="font-mono text-[#10338D]">{q.queryId}</strong></span>
                      <span>Rows: <strong className="font-mono text-[#10338D]">{q.rowsProduced?.toLocaleString() || 0}</strong></span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-white border-t border-[#ECEFFF] flex items-center justify-end">
              <button
                onClick={() => setSelectedUserForModal(null)}
                className="px-4 py-1.5 rounded-xl bg-[#10338D] text-white text-xs font-bold hover:bg-[#0D266B] transition-colors cursor-pointer shadow-xs"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
