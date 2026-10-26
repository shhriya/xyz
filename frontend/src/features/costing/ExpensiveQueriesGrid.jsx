import React, { useState } from 'react';
import { Search, ChevronDown, ChevronUp, Clock, User, Database, Terminal, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function ExpensiveQueriesGrid({ queries = [] }) {
  const [expandedRow, setExpandedRow] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState('ALL');
  const [hideSystemTasks, setHideSystemTasks] = useState(true);
  // '' = default order (ranked by credits, as the section subtitle says). Exposed as a visible,
  // labeled dropdown in the controls row — not a hidden "click the column header" interaction —
  // so it's obvious at a glance that sorting by date is an option, same as the other filters here.
  const [dateSort, setDateSort] = useState('');

  const usersList = ['ALL', ...new Set(queries.map(q => q.userName).filter(u => u && u !== 'SYSTEM'))];

  const filteredQueries = queries.filter(q => {
    if (hideSystemTasks && (q.userName === 'SYSTEM' || q.roleName === 'SNOWFLAKE' || (q.warehouseName && q.warehouseName.includes('COMPUTE_SERVICE_WH')))) {
      return false;
    }
    const matchesUser = selectedUser === 'ALL' || q.userName === selectedUser;
    const matchesSearch =
      (q.queryText || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.userName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.queryType || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesUser && matchesSearch;
  });

  const sortedQueries = dateSort
    ? [...filteredQueries].sort((a, b) => {
        const ta = new Date(a.startTime || 0).getTime();
        const tb = new Date(b.startTime || 0).getTime();
        return dateSort === 'asc' ? ta - tb : tb - ta;
      })
    : filteredQueries;

  const formatDuration = (sec) => {
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

  return (
    <div className="bg-white border border-[#D1DEFF] rounded-xl shadow-sm min-w-0 max-w-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#D1DEFF] flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h3 className="text-xs font-black text-[#10338D] tracking-tight flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Query-Level Cost & Execution Attribution
          </h3>
          <p className="text-[10px] text-[#666666] mt-0.5">
            Detailed queries executed with exact compute credits used based on warehouse sizing
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          {/* Hide System Tasks toggle */}
          <label className="flex items-center gap-1.5 text-[11px] text-[#666666] font-medium cursor-pointer bg-[#F8FAFC] border border-[#D1DEFF] px-2 py-1 rounded-md">
            <input
              type="checkbox"
              checked={hideSystemTasks}
              onChange={(e) => setHideSystemTasks(e.target.checked)}
              className="rounded text-[#1C58F6] cursor-pointer"
            />
            <span>Hide System Tasks</span>
          </label>

          {/* Filter by User */}
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="text-[11px] border border-[#D1DEFF] rounded-md px-2 py-1 bg-[#F8FAFC] text-[#10338D] font-medium outline-none focus:ring-1 focus:ring-[#1C58F6]"
          >
            {usersList.map(u => (
              <option key={u} value={u}>{u === 'ALL' ? 'All Users' : u}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[#666666]" />
            <input
              type="text"
              placeholder="Search SQL or user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-6 pr-3 py-1 text-[11px] border border-[#D1DEFF] rounded-md w-full sm:w-44 focus:outline-none focus:ring-1 focus:ring-[#1C58F6] bg-[#F8FAFC]"
            />
          </div>

          {/* Sort by Date */}
          <div className="flex items-center gap-1.5 bg-[#F8FAFC] border border-[#D1DEFF] rounded-md px-2 py-1">
            <Clock className="w-3 h-3 text-[#666666]" />
            <select
              value={dateSort}
              onChange={(e) => setDateSort(e.target.value)}
              className="text-[11px] bg-transparent text-[#10338D] font-medium outline-none cursor-pointer"
              title="Sort by date"
            >
              <option value="">Sort: Cost (default)</option>
              <option value="desc">Date: Newest First</option>
              <option value="asc">Date: Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[820px] text-[11px] border-collapse">
          <thead>
            <tr className="bg-[#F8FAFC] border-b border-[#D1DEFF] text-[#666666] font-bold uppercase">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Warehouse</th>
              <th className="px-3 py-2 text-right">Duration</th>
              <th className="px-3 py-2 text-right">Est. Credits</th>
              <th className="px-3 py-2 text-right">Est. Cost</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-left">
                <span className="inline-flex items-center gap-1">
                  Time
                  {dateSort === 'desc' && <ChevronDown className="w-3 h-3" title="Sorted: Newest first" />}
                  {dateSort === 'asc' && <ChevronUp className="w-3 h-3" title="Sorted: Oldest first" />}
                </span>
              </th>
              <th className="px-3 py-2 text-center">SQL</th>
            </tr>
          </thead>
          <tbody>
            {sortedQueries.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-6 text-[#666666]">No queries found.</td>
              </tr>
            ) : (
              sortedQueries.map((q, idx) => (
                <React.Fragment key={q.queryId}>
                  <tr className={`border-b border-[#D1DEFF]/50 hover:bg-blue-50/40 transition-colors ${expandedRow === idx ? 'bg-blue-50/60' : ''}`}>
                    <td className="px-3 py-2 text-[#666666] font-mono">{idx + 1}</td>
                    <td className="px-3 py-2 font-semibold text-[#10338D]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <User className="w-3 h-3 text-[#666666]" />
                        <span>{q.userName}</span>
                        {q.source === 'REAL_TIME' && (
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1 py-0.2 rounded border border-emerald-300">Live</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#666666]">
                      <span className="bg-[#F8FAFC] border border-[#D1DEFF] px-1.5 py-0.5 rounded text-[10px] font-mono">{q.roleName}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        q.queryType === 'SELECT' ? 'bg-blue-50 text-blue-700' :
                        q.queryType === 'INSERT' ? 'bg-green-50 text-green-700' :
                        q.queryType === 'CREATE_TABLE_AS_SELECT' || q.queryType === 'CREATE' ? 'bg-purple-50 text-purple-700' :
                        q.queryType === 'DELETE' || q.queryType === 'DROP' ? 'bg-red-50 text-red-700' :
                        'bg-gray-50 text-gray-700'
                      }`}>
                        {q.queryType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#666666]">
                      <div className="flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        {q.warehouseName}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-[#10338D]">
                      <div className="flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3 text-[#666666]" />
                        {formatDuration(q.elapsedSec)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">{q.estimatedCredits.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-[#10338D]">
                      {q.estimatedCostUsd != null ? `$${q.estimatedCostUsd.toFixed(4)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {q.status === 'SUCCESS' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#666666] whitespace-nowrap">{formatTimestamp(q.startTime)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                        className="p-1 hover:bg-[#ECEFFF] rounded transition-colors"
                        title="View SQL"
                      >
                        {expandedRow === idx ? <ChevronUp className="w-3.5 h-3.5 text-[#1C58F6]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#666666]" />}
                      </button>
                    </td>
                  </tr>
                  {expandedRow === idx && (
                    <tr className="bg-[#F8FAFC]">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="text-[10px] font-bold text-[#666666] uppercase mb-1">Query Text Preview</div>
                        <pre className="bg-white border border-[#D1DEFF] rounded-lg p-3 text-[11px] font-mono text-[#10338D] whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">
                          {q.queryText || '(No query text available)'}
                        </pre>
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-[#666666]">
                          <span>Query ID: <span className="font-mono text-[#10338D]">{q.queryId}</span></span>
                          <span>Rows Produced: <span className="font-mono text-[#10338D]">{q.rowsProduced.toLocaleString()}</span></span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
