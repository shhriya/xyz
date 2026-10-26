import React, { useState } from 'react';
import { Cpu, Info, X, ArrowLeft, ChevronRight } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SectionTitle, DataTable, EmptyState, Skeleton, KpiCard, fmtMoney, fmtNum, SERIES, MUTED } from './executive/ExecOverviewPrimitives';
import { fetchCortexRequestList, fetchCortexRequestDetail } from '@/api';
import CortexRequestExplorer from './CortexRequestExplorer';

export default function CortexLevel1({ data, loading, error, credentials }) {
  const [inspectService, setInspectService] = useState(null);
  const [requestList, setRequestList] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestDetail, setRequestDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedUserFilter, setSelectedUserFilter] = useState('');
  const [selectedModelFilter, setSelectedModelFilter] = useState('');

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data || data.status !== 'success') {
    return (
      <EmptyState
        icon={Cpu}
        title="Cortex AI spend could not be loaded"
        detail={error || data?.message || 'Failed to fetch Cortex AI usage telemetry.'}
      />
    );
  }

  const { services = [], unavailableServices = [], availableCount = 0, totalServiceCount = 0, totalCreditsAI = 0, totalCostUsd = 0, dailyTrend = [], topUsers = [], topModels = [] } = data;

  const totalTokens = services.reduce((sum, s) => sum + (s.tokens || 0), 0);
  const avgCostPer1k = totalTokens > 0 ? (totalCostUsd / (totalTokens / 1000)) : 0;

  const trendKeys = Array.from(
    new Set(dailyTrend.flatMap((d) => Object.keys(d).filter((k) => k !== 'day')))
  );

  const openInspect = async (service) => {
    setInspectService(service);
    setRequestList(null);
    setSelectedRequest(null);
    setRequestDetail(null);
    setListLoading(true);
    try {
      const res = await fetchCortexRequestList({ ...credentials, service, limit: 20, scope: 'costing' });
      setRequestList(res);
    } finally {
      setListLoading(false);
    }
  };

  const closeInspect = () => {
    setInspectService(null);
    setRequestList(null);
    setSelectedRequest(null);
    setRequestDetail(null);
  };

  const openDetail = async (req) => {
    setSelectedRequest(req);
    setRequestDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetchCortexRequestDetail({ ...credentials, service: inspectService, requestId: req.request_id, scope: 'costing' });
      setRequestDetail(res);
    } finally {
      setDetailLoading(false);
    }
  };

  const backToList = () => {
    setSelectedRequest(null);
    setRequestDetail(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5 text-xs text-[#64748B]">
        <Info className="w-4 h-4 text-[#94A3B8] shrink-0 mt-0.5" />
        <span>
          {availableCount} of {totalServiceCount} Cortex AI services are available on this account/edition.
          Most of the rest are newer or preview features not every account has yet
          {unavailableServices.length > 0 && (
            <> — not available here: <span className="font-mono">{unavailableServices.join(', ')}</span>.</>
          )}
        </span>
      </div>



      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="AI Credits" value={fmtNum(totalCreditsAI, 2)} icon={Cpu} />
        <KpiCard label="AI Cost" value={fmtMoney(totalCostUsd)} icon={Cpu} footnote="Live Gross Usage" />
        <KpiCard label="Active Services" value={`${availableCount} / ${totalServiceCount}`} icon={Cpu} />
        <KpiCard label="Cost / 1k Tokens" value={totalTokens > 0 ? fmtMoney(avgCostPer1k) : '—'} icon={Cpu} />
      </div>

      {dailyTrend.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <SectionTitle title="Daily Cortex Spend Trend" subtitle={data.billingPeriod} />
          <div className="h-64 w-full">
            <ResponsiveContainer width="99%" height="100%">
              <AreaChart data={dailyTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #D1DEFF', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {trendKeys.map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="1"
                    stroke={SERIES[i % SERIES.length]}
                    fill={SERIES[i % SERIES.length]}
                    fillOpacity={0.35}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {(topUsers.length > 0 || topModels.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {topUsers.length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <SectionTitle title="Spend by User" subtitle="Click a user bar to filter individual requests" />
                {selectedUserFilter && (
                  <button
                    onClick={() => setSelectedUserFilter('')}
                    className="text-[11px] font-bold text-[#1C58F6] hover:underline cursor-pointer"
                  >
                    Reset user filter
                  </button>
                )}
              </div>
              <div className="h-56 w-full cursor-pointer">
                <ResponsiveContainer width="99%" height="100%">
                  <BarChart
                    data={topUsers}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
                    onClick={(e) => {
                      if (e && e.activePayload && e.activePayload.length) {
                        setSelectedUserFilter(e.activePayload[0].payload.user);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="user" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={100} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #D1DEFF', fontSize: 12 }} formatter={(v) => fmtMoney(v)} />
                    <Bar dataKey="amountUsd" fill={SERIES[1]} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <SectionTitle title="Spend by Model" subtitle="Click a model bar to filter individual requests" />
                {selectedModelFilter && (
                  <button
                    onClick={() => setSelectedModelFilter('')}
                    className="text-[11px] font-bold text-[#1C58F6] hover:underline cursor-pointer"
                  >
                    Reset model filter
                  </button>
                )}
              </div>
              <div className="h-56 w-full cursor-pointer">
                <ResponsiveContainer width="99%" height="100%">
                  <BarChart
                    data={topModels}
                    layout="vertical"
                    margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
                    onClick={(e) => {
                      if (e && e.activePayload && e.activePayload.length) {
                        setSelectedModelFilter(e.activePayload[0].payload.model);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="model" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={100} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #D1DEFF', fontSize: 12 }} formatter={(v) => fmtMoney(v)} />
                    <Bar dataKey="amountUsd" fill={SERIES[2]} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
        <SectionTitle title="Cortex AI Services" subtitle={data.billingPeriod} />
        <DataTable
          columns={[
            { key: 'service', label: 'Service' },
            { key: 'events', label: 'Events', align: 'right', render: (r) => fmtNum(r.events) },
            { key: 'tokens', label: 'Tokens', align: 'right', render: (r) => (r.hasTokens ? fmtNum(r.tokens) : '—') },
            { key: 'credits', label: 'Credits', align: 'right', render: (r) => fmtNum(r.credits, 4) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => fmtMoney(r.costUsd) },
            { key: 'topUser', label: 'Top User', render: (r) => r.topUser || '—' },
            { key: 'topModel', label: 'Top Model', render: (r) => r.topModel || '—' },
            {
              key: 'actions', label: '', render: (r) => (
                <button
                  onClick={() => openInspect(r.service)}
                  className="text-[11px] font-bold text-[#1C58F6] hover:underline cursor-pointer"
                >
                  Inspect
                </button>
              )
            },
          ]}
          rows={services}
          searchKeys={['service']}
          emptyText="No Cortex AI usage detected in this period."
        />
      </div>

      {/* Granular Per-Request Explorer & Audit Log */}
      <CortexRequestExplorer
        credentials={credentials}
        initialUserFilter={selectedUserFilter}
        initialModelFilter={selectedModelFilter}
      />

      {inspectService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-[#F1F5F9] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selectedRequest && (
                  <button onClick={backToList} className="p-1 rounded hover:bg-slate-100 cursor-pointer shrink-0" title="Back to request list">
                    <ArrowLeft className="w-4 h-4 text-[#64748B]" />
                  </button>
                )}
                <h3 className="text-sm font-bold text-[#0F172A] truncate">
                  {inspectService} — {selectedRequest ? 'Request Detail' : 'Recent Requests'}
                </h3>
              </div>
              <button onClick={closeInspect} className="p-1 rounded hover:bg-slate-100 cursor-pointer shrink-0">
                <X className="w-4 h-4 text-[#64748B]" />
              </button>
            </div>

            <div className="p-4 text-xs text-[#334155] space-y-2 overflow-y-auto">
              {/* Step 2: a single request's full detail */}
              {selectedRequest ? (
                detailLoading ? (
                  <Skeleton className="h-20" />
                ) : requestDetail?.status === 'success' ? (
                  <div className="space-y-3">
                    {(requestDetail.detail.prompt || requestDetail.detail.messages) && (
                       <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                          <h4 className="font-bold text-[#0F172A] mb-2 text-[11px] uppercase tracking-wider">Conversation</h4>
                          <div className="space-y-2">
                             <div className="bg-white p-2 rounded border border-[#E2E8F0]">
                                <span className="font-bold text-[#64748B] text-[10px] uppercase block mb-1">User</span>
                                <pre className="whitespace-pre-wrap font-sans">{requestDetail.detail.prompt || JSON.stringify(requestDetail.detail.messages, null, 2)}</pre>
                             </div>
                             {(requestDetail.detail.response || requestDetail.detail.completion) && (
                             <div className="bg-[#EEF2FF] p-2 rounded border border-[#D1DEFF]">
                                <span className="font-bold text-[#1C58F6] text-[10px] uppercase block mb-1">Assistant</span>
                                <pre className="whitespace-pre-wrap font-sans">{requestDetail.detail.response || requestDetail.detail.completion}</pre>
                             </div>
                             )}
                          </div>
                       </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                       {Object.entries(requestDetail.detail).filter(([k]) => !['prompt', 'response', 'messages', 'completion'].includes(k.toLowerCase())).map(([k, v]) => (
                          <div key={k} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded p-2">
                             <span className="block text-[9px] uppercase font-bold text-[#64748B] mb-0.5">{k.replace(/_/g, ' ')}</span>
                             <span className="block text-[11px] font-mono text-[#0F172A] truncate" title={String(v)}>{String(v)}</span>
                          </div>
                       ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[#64748B]">{requestDetail?.message || 'No detail available.'}</p>
                )

              /* Step 1: pick a request from the recent list */
              ) : listLoading ? (
                <Skeleton className="h-32" />
              ) : requestList?.status === 'success' && requestList.requests?.length > 0 ? (
                <div className="space-y-1.5">
                  {requestList.requests.map((req, idx) => (
                    <button
                      key={req.request_id || idx}
                      onClick={() => openDetail(req)}
                      className="w-full text-left bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] rounded-lg p-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-[#0F172A] truncate">{req.request_id}</p>
                        <p className="text-[10px] text-[#64748B] truncate mt-0.5">
                          {Object.entries(req)
                            .filter(([k]) => k !== 'request_id')
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ') || 'No additional fields'}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[#64748B]">{requestList?.message || 'No recent requests found in this period.'}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
