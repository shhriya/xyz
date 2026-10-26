import React, { useState, useEffect } from 'react';
import {
  Wind, RefreshCw, Sliders, AlertTriangle, Clock, Info, DollarSign, Server
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { fetchAirflowCostingProviders, fetchAirflowCostingSummary } from '@/api';

function humanizeKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isValidAirflowData(d) {
  return !!(d && d.environment && d.summary);
}

function DynamicField({ field, value, onChange }) {
  const commonClass = "w-full bg-[#F8FAFC] border border-[#CBD5E1] focus:border-[#017CEE] rounded-xl px-3 py-2 text-xs font-mono outline-none";
  if (field.type === 'textarea') {
    return (
      <textarea
        rows={5}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || ''}
        className={commonClass}
      />
    );
  }
  return (
    <input
      type={field.type === 'password' ? 'password' : 'text'}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder || ''}
      className={commonClass}
    />
  );
}

export default function AirflowCostingDashboard({ projectState, setProjectState }) {
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [formValues, setFormValues] = useState({});

  const [data, setData] = useState(() => {
    const cached = projectState?.airflowCostingData;
    return isValidAirflowData(cached) ? cached : null;
  });
  const [credentials, setCredentials] = useState(() => {
    if (projectState?.airflowCostingCredentials) return projectState.airflowCostingCredentials;
    try {
      const stored = localStorage.getItem('agy_airflow_costing_credentials');
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(() => !!(projectState?.airflowCostingCredentials && !isValidAirflowData(projectState?.airflowCostingData)));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    async function load() {
      const res = await fetchAirflowCostingProviders();
      if (res && res.status === 'success' && Array.isArray(res.providers)) {
        setProviders(res.providers);
        if (!selectedProviderId && res.providers.length > 0) {
          setSelectedProviderId(credentials?.provider || res.providers[0].id);
        }
      }
      setProvidersLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFetch = async (creds) => {
    const res = await fetchAirflowCostingSummary(creds);
    if (res && res.status === 'success' && isValidAirflowData(res)) {
      setData(res);
      setErrorMsg(null);
      if (setProjectState) {
        setProjectState((prev) => ({ ...prev, airflowCostingData: res }));
      }
    } else {
      setErrorMsg(res?.message || 'Failed to fetch cost data.');
    }
    return res;
  };

  // Initial load only
  useEffect(() => {
    if (data || !credentials) {
      setLoading(false);
      return;
    }
    let isMounted = true;
    (async () => {
      setLoading(true);
      await runFetch(credentials);
      if (isMounted) setLoading(false);
    })();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  const handleManualRefresh = async () => {
    if (!credentials) return;
    setIsRefreshing(true);
    setErrorMsg(null);
    await runFetch(credentials);
    setIsRefreshing(false);
  };

  const handleConnect = async () => {
    const provider = providers.find((p) => p.id === selectedProviderId);
    if (!provider) return;
    const missing = provider.credentialFields.filter((f) => f.required && !formValues[f.key]?.trim());
    if (missing.length > 0) {
      setErrorMsg(`Missing required field(s): ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    const creds = { provider: provider.id, ...formValues };
    setErrorMsg(null);
    setLoading(true);
    setCredentials(creds);
    try {
      localStorage.setItem('agy_airflow_costing_credentials', JSON.stringify(creds));
    } catch {}
    if (setProjectState) {
      setProjectState((prev) => ({ ...prev, airflowCostingCredentials: creds, airflowCostingData: null }));
    }
    await runFetch(creds);
    setLoading(false);
  };

  const handleChangeConnection = () => {
    setCredentials(null);
    setData(null);
    setErrorMsg(null);
    setFormValues({});
    try { localStorage.removeItem('agy_airflow_costing_credentials'); } catch {}
    if (setProjectState) {
      setProjectState((prev) => ({ ...prev, airflowCostingCredentials: null, airflowCostingData: null }));
    }
  };

  // ---------------------------------------------------------------- LOADING
  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto space-y-6 min-w-0">
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-12 shadow-xs flex flex-col items-center justify-center text-center min-h-[300px] space-y-3">
          <div className="inline-flex items-center gap-2.5 px-4 py-2 bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl shadow-2xs">
            <div className="w-4 h-4 border-2 border-[#017CEE] border-t-transparent rounded-full animate-spin shrink-0"></div>
            <span className="text-xs font-semibold text-[#10338D]">Fetching managed Airflow cost data...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- NOT CONNECTED
  if (!isValidAirflowData(data) || !credentials) {
    const activeProvider = providers.find((p) => p.id === selectedProviderId);
    return (
      <div className="w-full max-w-7xl mx-auto space-y-6 min-w-0">
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-xs">
          <div className="inline-flex items-center gap-1.5 bg-[#E6F4FF] text-[#017CEE] px-2.5 py-0.5 rounded-full text-xs font-bold border border-[#B8E2FF] mb-1.5">
            <Wind className="w-3.5 h-3.5" />
            <span>Managed Airflow Cost Tracking</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-[#10338D] tracking-tight">Connect a Managed Airflow Service</h1>
          <p className="text-xs text-[#666666] max-w-2xl leading-relaxed mt-0.5">
            For self-hosted Airflow there is no billing API to call — cost lives entirely in whatever infra
            runs it. This connects to a managed Airflow provider (which bills you directly) and pulls real
            cost/usage data with your own credentials.
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!providersLoading && (
          <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-xs">
            <div className="inline-flex p-1 rounded-xl bg-[#F1F5F9] border border-[#D1DEFF] mb-4">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedProviderId(p.id); setFormValues({}); setErrorMsg(null); }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedProviderId === p.id ? 'bg-white text-[#10338D] shadow-sm' : 'text-[#64748B] hover:text-[#334155]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {activeProvider && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeProvider.credentialFields.map((field) => (
                  <div key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                    <label className="block text-[11px] font-bold text-[#334155] mb-1">
                      {field.label}{field.required && <span className="text-rose-500"> *</span>}
                    </label>
                    <DynamicField
                      field={field}
                      value={formValues[field.key]}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                    {field.help && <p className="text-[10px] text-[#94A3B8] mt-1">{field.help}</p>}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleConnect}
              className="mt-4 bg-[#017CEE] hover:bg-[#0166C4] text-white font-bold py-2.5 px-6 rounded-xl text-xs transition-all shadow-md cursor-pointer"
            >
              Connect &amp; Fetch Cost Data
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- CONNECTED
  const { environment, summary, costTrend, costByService } = data;
  const providerLabel = providers.find((p) => p.id === credentials.provider)?.label || credentials.provider;
  const hasRealCost = summary.totalCostUsd != null;
  const costWarning = summary.costExplorerError || summary.billingExportError || summary.costNote;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 min-w-0">
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block mb-0.5">Refresh Failed</span>
            {errorMsg}
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700 font-bold text-xs cursor-pointer shrink-0">✕</button>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 bg-[#E6F4FF] text-[#017CEE] px-2.5 py-0.5 rounded-full text-xs font-bold border border-[#B8E2FF]">
            <Wind className="w-3.5 h-3.5" />
            <span>{providerLabel} Cost Tracking</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-[#10338D] tracking-tight">{environment.name || 'Airflow Environment'}</h1>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {summary.billingPeriod && (
              <span className="inline-flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2.5 py-1 rounded-lg text-xs text-[#666666]">
                <Clock className="w-3 h-3 text-[#017CEE]" />
                {summary.billingPeriod}
              </span>
            )}
            {summary.lastRefreshedAt && (
              <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-[10px] text-slate-600 font-mono">
                Synced: {summary.lastRefreshedAt}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={handleChangeConnection}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F8FAFC] text-[#10338D] font-bold text-xs border border-[#D1DEFF] transition-all shadow-2xs flex items-center space-x-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-[#017CEE]" />
            <span>Change Connection</span>
          </button>
          <button
            onClick={() => handleManualRefresh()}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#D1DEFF] text-[#10338D] cursor-pointer transition-all shadow-2xs disabled:opacity-50"
            title="Refresh Cost Data Now"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#017CEE] ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Cost KPI + environment cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Total Cost</p>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-black text-[#10338D]">
            {hasRealCost ? `$${summary.totalCostUsd.toLocaleString()} ${summary.currency || ''}` : 'Not Available via API'}
          </h2>
          <p className="text-[10px] text-[#666666] mt-1">{summary.costSource || ''}</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#D1DEFF] shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Environment</p>
            <Server className="w-4 h-4 text-[#017CEE]" />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {Object.entries(environment).filter(([k, v]) => v !== null && v !== undefined && k !== 'workerQueues').slice(0, 6).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-[#94A3B8]">{humanizeKey(k)}</span>
                <span className="font-bold text-[#10338D] truncate">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {costWarning && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
          <p>{costWarning}</p>
        </div>
      )}

      {costTrend && costTrend.length > 0 && (
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg font-black text-[#10338D] tracking-tight mb-4">Daily Cost Trend</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="99%" height="100%">
              <AreaChart data={costTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAirflowCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#017CEE" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#017CEE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #D1DEFF' }} />
                <Area type="monotone" dataKey="costUsd" name="Cost ($)" stroke="#017CEE" strokeWidth={2} fillOpacity={1} fill="url(#colorAirflowCost)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {costByService && costByService.length > 0 && (
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg font-black text-[#10338D] tracking-tight mb-4">Cost by GCP Service</h2>
          <div className="space-y-2">
            {costByService.map((s) => (
              <div key={s.service} className="flex items-center justify-between p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs">
                <span className="font-semibold text-[#10338D]">{s.service}</span>
                <span className="font-mono font-bold text-emerald-600">${s.costUsd.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {environment.workerQueues && environment.workerQueues.length > 0 && (
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm">
          <h2 className="text-lg font-black text-[#10338D] tracking-tight mb-4">Worker Queues</h2>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[500px] text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#D1DEFF] text-[#666666] font-bold uppercase text-[11px]">
                  <th className="py-2 px-3">Queue</th>
                  <th className="py-2 px-3">Machine</th>
                  <th className="py-2 px-3 text-right">Min Workers</th>
                  <th className="py-2 px-3 text-right">Max Workers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECEFFF]">
                {environment.workerQueues.map((q, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-bold text-[#10338D]">{q.name}</td>
                    <td className="py-2 px-3 font-mono">{q.astroMachine}</td>
                    <td className="py-2 px-3 text-right font-mono">{q.minWorkerCount}</td>
                    <td className="py-2 px-3 text-right font-mono">{q.maxWorkerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
