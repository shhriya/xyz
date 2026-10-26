import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, Eye, User, Layers, Clock, AlertCircle, ArrowUpDown } from 'lucide-react';
import { fmtMoney, fmtNum } from './executive/ExecOverviewPrimitives';
import { fetchCortexRequests, fetchCortexSingleRequest } from '@/api';
import CortexRequestDetailModal from './CortexRequestDetailModal';

export function fmtCortexCost(v) {
  const n = Number(v) || 0;
  if (n === 0) return '$0.00';
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n >= 0.0001) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

export default function CortexRequestExplorer({ credentials, initialUserFilter = null, initialModelFilter = null }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, totalCount: 0, totalPages: 1 });

  // Filter States
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(initialUserFilter || '');
  const [selectedModel, setSelectedModel] = useState(initialModelFilter || '');
  const [sortBy, setSortBy] = useState('START_TIME');
  const [sortOrder, setSortOrder] = useState('DESC');

  // Request Inspection Modal State
  const [activeRequest, setActiveRequest] = useState(null);
  const [requestDetail, setRequestDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (initialUserFilter !== null) setSelectedUser(initialUserFilter);
  }, [initialUserFilter]);

  useEffect(() => {
    if (initialModelFilter !== null) setSelectedModel(initialModelFilter);
  }, [initialModelFilter]);

  const loadRequests = async (page = 1) => {
    if (!credentials?.account) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCortexRequests({
        ...credentials,
        scope: 'costing',
        filters: {
          user: selectedUser || undefined,
          model: selectedModel || undefined,
          search: search || undefined,
        },
        page,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      });

      if (res?.status === 'success') {
        setRequests(res.requests || []);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      } else {
        setError(res?.message || 'Could not load Cortex requests.');
      }
    } catch (err) {
      setError(err?.message || 'Network error fetching requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, selectedUser, selectedModel, sortBy, sortOrder]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadRequests(1);
  };

  const handleInspect = async (req) => {
    setActiveRequest(req);
    setRequestDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetchCortexSingleRequest(req.queryId, { ...credentials, scope: 'costing' });
      setRequestDetail(res);
    } finally {
      setDetailLoading(false);
    }
  };

  const uniqueUsers = Array.from(new Set(requests.map((r) => r.userName).filter(Boolean)));
  const uniqueModels = Array.from(new Set(requests.map((r) => r.model).filter(Boolean)));

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortOrder('DESC');
    }
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4 shadow-xs">
      
      {/* Title & Filter Bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#1C58F6]" />
            Cortex AI Request Explorer &amp; Audit Log
          </h3>
          <p className="text-[12px] text-[#64748B] mt-0.5">
            Individual user query traces, prompts, token metrics, and execution costs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Search box */}
          <form onSubmit={handleSearchSubmit} className="relative min-w-[200px] flex-1 lg:flex-none">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search prompt or query ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1C58F6] focus:bg-white"
            />
          </form>

          {/* User Filter */}
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="px-2.5 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-xs text-[#0F172A] cursor-pointer focus:outline-none focus:border-[#1C58F6]"
          >
            <option value="">All Users</option>
            {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>

          {/* Model Filter */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-2.5 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-xs text-[#0F172A] cursor-pointer focus:outline-none focus:border-[#1C58F6]"
          >
            <option value="">All Models</option>
            {uniqueModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          {/* Refresh button */}
          <button
            onClick={() => loadRequests(pagination.page)}
            disabled={loading}
            className="p-1.5 rounded-xl border border-[#CBD5E1] hover:bg-[#F8FAFC] text-[#64748B] hover:text-[#0F172A] cursor-pointer disabled:opacity-50"
            title="Refresh requests"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Active Filter Badges */}
      {(selectedUser || selectedModel || search) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1">
          <span className="text-[#64748B]">Active Filters:</span>
          {selectedUser && (
            <span className="px-2 py-0.5 rounded-lg bg-[#10338D]/10 text-[#10338D] font-bold flex items-center gap-1">
              User: {selectedUser}
              <button onClick={() => setSelectedUser('')} className="hover:text-red-600">×</button>
            </span>
          )}
          {selectedModel && (
            <span className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-bold flex items-center gap-1">
              Model: {selectedModel}
              <button onClick={() => setSelectedModel('')} className="hover:text-red-600">×</button>
            </span>
          )}
          {search && (
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-[#334155] font-bold flex items-center gap-1">
              Keyword: "{search}"
              <button onClick={() => setSearch('')} className="hover:text-red-600">×</button>
            </span>
          )}
          <button
            onClick={() => { setSelectedUser(''); setSelectedModel(''); setSearch(''); }}
            className="text-[10px] text-[#1C58F6] hover:underline font-bold ml-1 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Request Table */}
      <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-bold text-[11px] uppercase tracking-wider">
                <th
                  onClick={() => toggleSort('START_TIME')}
                  className="py-2.5 px-3.5 cursor-pointer hover:text-[#0F172A] select-none"
                >
                  <div className="flex items-center gap-1">
                    Timestamp
                    <ArrowUpDown className="w-3 h-3 text-[#94A3B8]" />
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('USER_NAME')}
                  className="py-2.5 px-3.5 cursor-pointer hover:text-[#0F172A] select-none"
                >
                  <div className="flex items-center gap-1">
                    User &amp; Role
                    <ArrowUpDown className="w-3 h-3 text-[#94A3B8]" />
                  </div>
                </th>
                <th className="py-2.5 px-3.5">Model / Function</th>
                <th className="py-2.5 px-3.5 min-w-[260px]">Prompt Preview</th>
                <th
                  onClick={() => toggleSort('TOKENS')}
                  className="py-2.5 px-3.5 text-right cursor-pointer hover:text-[#0F172A] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    Tokens
                    <ArrowUpDown className="w-3 h-3 text-[#94A3B8]" />
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('TOTAL_ELAPSED_TIME')}
                  className="py-2.5 px-3.5 text-right cursor-pointer hover:text-[#0F172A] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    Duration
                    <ArrowUpDown className="w-3 h-3 text-[#94A3B8]" />
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('CREDITS')}
                  className="py-2.5 px-3.5 text-right cursor-pointer hover:text-[#0F172A] select-none"
                >
                  <div className="flex items-center justify-end gap-1">
                    Cost (USD)
                    <ArrowUpDown className="w-3 h-3 text-[#94A3B8]" />
                  </div>
                </th>
                <th className="py-2.5 px-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#64748B]">
                    <div className="w-5 h-5 border-2 border-[#1C58F6] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Fetching live Cortex request telemetry…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-rose-600">
                    <AlertCircle className="w-5 h-5 mx-auto mb-1 text-rose-500" />
                    {error}
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[#64748B]">
                    No matching Cortex AI requests found in this period.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.queryId} className="hover:bg-[#F8FAFC] transition-colors group">
                    {/* Timestamp */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[11px] text-[#64748B]">
                      {req.startTime ? req.startTime.replace('T', ' ').slice(0, 19) : '—'}
                    </td>

                    {/* User */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <div className="font-bold text-[#0F172A] flex items-center gap-1.5">
                        <User className="w-3 h-3 text-[#1C58F6]" />
                        {req.userName}
                      </div>
                      <div className="text-[10px] text-[#94A3B8] font-mono">{req.roleName}</div>
                    </td>

                    {/* Model */}
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-bold text-[10.5px] border border-purple-200">
                        {req.model}
                      </span>
                      <span className="text-[10px] text-[#64748B] block mt-0.5 font-mono">
                        {req.function}
                      </span>
                    </td>

                    {/* Prompt Preview */}
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-[#334155] max-w-xs truncate" title={req.promptSnippet}>
                      {req.promptSnippet || '—'}
                    </td>

                    {/* Tokens */}
                    <td className="py-2.5 px-3.5 text-right font-mono text-[11px]">
                      {req.tokens > 0 ? (
                        <span className="font-bold text-[#0F172A]">{fmtNum(req.tokens)}</span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>

                    {/* Latency */}
                    <td className="py-2.5 px-3.5 text-right font-mono text-[11px] text-[#64748B]">
                      {req.durationMs > 0 ? `${req.durationMs.toLocaleString()} ms` : '—'}
                    </td>

                    {/* Cost */}
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap font-mono text-[11.5px] font-bold text-emerald-700" title={`Credits: ${req.credits || 0}`}>
                      {fmtCortexCost(req.costUsd || 0)}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-center">
                      <button
                        onClick={() => handleInspect(req)}
                        className="px-2.5 py-1 rounded-lg bg-[#ECEFFF] hover:bg-[#10338D]/15 text-[#10338D] text-[11px] font-bold cursor-pointer transition-colors inline-flex items-center gap-1"
                        title="View full prompt and execution details"
                      >
                        <Eye className="w-3 h-3" />
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 px-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs text-[#64748B]">
          <span>
            Showing page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.totalCount} total queries)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadRequests(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1 || loading}
              className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] bg-white text-[#334155] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed hover:bg-slate-50 flex items-center gap-1 font-bold text-[11px]"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              onClick={() => loadRequests(Math.min(pagination.totalPages, pagination.page + 1))}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] bg-white text-[#334155] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed hover:bg-slate-50 flex items-center gap-1 font-bold text-[11px]"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Inspect Modal */}
      {activeRequest && (
        <CortexRequestDetailModal
          request={activeRequest}
          detail={requestDetail}
          loading={detailLoading}
          onClose={() => { setActiveRequest(null); setRequestDetail(null); }}
        />
      )}
    </div>
  );
}
