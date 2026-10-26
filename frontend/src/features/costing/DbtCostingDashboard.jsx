import React, { useState, useEffect } from 'react';
import {
  Layers, Users, RefreshCw, Sliders, AlertTriangle, Clock, ShieldCheck, Lock,
  Mail, CreditCard, Info, CheckCircle2, XCircle, Hammer, Zap
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { fetchDbtCostingSummary, fetchDbtBuildUsage, fetchMonitoringSources } from '@/api';

// Guards against stale cached data from an older shape of this dashboard (e.g. the previous
// job/run monitoring version, which had no `billing` key) crashing the render.
function isValidBillingData(d) {
  return !!(d && d.billing && d.account);
}

export default function DbtCostingDashboard({ projectState, setProjectState }) {
  const [data, setData] = useState(() => {
    const cached = projectState?.dbtCostingData;
    return isValidBillingData(cached) ? cached : null;
  });
  const [loading, setLoading] = useState(() => !!(projectState?.dbtCostingCredentials && !isValidBillingData(projectState?.dbtCostingData)));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [buildUsage, setBuildUsage] = useState(() => {
    const cached = projectState?.dbtBuildUsageData;
    return cached && cached.status === 'success' ? cached : null;
  });

  const initialCreds = (() => {
    if (projectState?.dbtCostingCredentials) return projectState.dbtCostingCredentials;
    try {
      const stored = localStorage.getItem('agy_dbt_costing_credentials');
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  })();
  const [credentials, setCredentials] = useState(initialCreds);

  const [monitoringSources, setMonitoringSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [formToken, setFormToken] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('https://cloud.getdbt.com');

  useEffect(() => {
    async function loadSources() {
      const res = await fetchMonitoringSources();
      if (res && res.status === 'success' && Array.isArray(res.sources)) {
        setMonitoringSources(res.sources.filter((s) => s.source_type === 'dbt'));
      }
      setSourcesLoading(false);
    }
    loadSources();
  }, []);

  const persistCredentials = (creds) => {
    setCredentials(creds);
    try {
      localStorage.setItem('agy_dbt_costing_credentials', JSON.stringify(creds));
    } catch {}
    if (setProjectState) {
      setProjectState((prev) => ({ ...prev, dbtCostingCredentials: creds, dbtCostingData: null }));
    }
  };

  const runFetch = async (creds) => {
    const [res, buildRes] = await Promise.all([
      fetchDbtCostingSummary(creds),
      fetchDbtBuildUsage(creds),
    ]);
    if (res && res.status === 'success' && isValidBillingData(res)) {
      setData(res);
      setErrorMsg(null);
      if (setProjectState) {
        setProjectState((prev) => ({ ...prev, dbtCostingData: res }));
      }
    } else {
      setErrorMsg(res?.message || 'Failed to fetch dbt Cloud billing data.');
    }
    // Best-effort: build usage failing (e.g. no runs yet) shouldn't block the billing view above.
    if (buildRes && buildRes.status === 'success') {
      setBuildUsage(buildRes);
      if (setProjectState) {
        setProjectState((prev) => ({ ...prev, dbtBuildUsageData: buildRes }));
      }
    }
    return res;
  };

  // Initial load only — do not reload when just switching tabs back and forth
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

  const handleUseSource = async (source) => {
    setErrorMsg(null);
    setLoading(true);
    const creds = { sourceId: source.source_id, displayName: source.display_name };
    persistCredentials(creds);
    await runFetch(creds);
    setLoading(false);
  };

  const handleConnectManual = async () => {
    if (!formToken.trim() || !formBaseUrl.trim()) {
      setErrorMsg('Both the Service Token and Base URL are required.');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    const creds = { dbtServiceToken: formToken.trim(), dbtBaseUrl: formBaseUrl.trim() };
    persistCredentials(creds);
    await runFetch(creds);
    setLoading(false);
  };

  const handleChangeConnection = () => {
    setCredentials(null);
    setData(null);
    setBuildUsage(null);
    setErrorMsg(null);
    try { localStorage.removeItem('agy_dbt_costing_credentials'); } catch {}
    if (setProjectState) {
      setProjectState((prev) => ({ ...prev, dbtCostingCredentials: null, dbtCostingData: null, dbtBuildUsageData: null }));
    }
  };

  // ---------------------------------------------------------------- LOADING
  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto space-y-6 min-w-0">
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-12 shadow-xs flex flex-col items-center justify-center text-center min-h-[300px] space-y-3">
          <div className="inline-flex items-center gap-2.5 px-4 py-2 bg-[#F8FAFC] border border-[#D1DEFF] rounded-xl shadow-2xs">
            <div className="w-4 h-4 border-2 border-[#FF694B] border-t-transparent rounded-full animate-spin shrink-0"></div>
            <span className="text-xs font-semibold text-[#10338D]">Fetching dbt Cloud billing &amp; plan status...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- NOT CONNECTED
  if (!isValidBillingData(data) || !credentials) {
    return (
      <div className="w-full max-w-7xl mx-auto space-y-6 min-w-0">
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-xs">
          <div className="inline-flex items-center gap-1.5 bg-[#FFF0ED] text-[#FF694B] px-2.5 py-0.5 rounded-full text-xs font-bold border border-[#FFD9D1] mb-1.5">
            <CreditCard className="w-3.5 h-3.5" />
            <span>dbt Cloud Billing</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-[#10338D] tracking-tight">Connect dbt Cloud</h1>
          <p className="text-xs text-[#666666] max-w-2xl leading-relaxed mt-0.5">
            Plan tier, seat licensing, and account/billing status — pulled from the dbt Cloud Admin API with
            your own service token. dbt Cloud has no invoice API, so this shows real billing-relevant account
            data (seats, plan, lock/trial/cancellation status) rather than an invented dollar total.
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!sourcesLoading && monitoringSources.length > 0 && (
          <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-xs">
            <h3 className="text-xs font-black text-[#10338D] mb-3">Use an Already-Connected dbt Cloud Account</h3>
            <div className="space-y-2">
              {monitoringSources.map((s) => (
                <button
                  key={s.source_id}
                  onClick={() => handleUseSource(s)}
                  className="w-full text-left flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#FF694B] hover:bg-[#FFF7F5] transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#FFF0ED] text-[#FF694B] flex items-center justify-center">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#10338D]">{s.display_name}</p>
                      <p className="text-[10px] text-[#666666]">Connected via Governance &middot; Monitoring</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#FF694B]">Use this connection &rarr;</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-black text-[#10338D] mb-3">Or Connect a New dbt Cloud Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-[#334155] mb-1">dbt Cloud Service Token</label>
              <input
                type="password"
                value={formToken}
                onChange={(e) => setFormToken(e.target.value)}
                placeholder="dbtc_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-[#F8FAFC] border border-[#CBD5E1] focus:border-[#FF694B] rounded-xl px-3 py-2 text-xs font-mono outline-none"
              />
              <p className="text-[10px] text-[#94A3B8] mt-1">dbt Cloud &rarr; Account Settings &rarr; API Tokens</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#334155] mb-1">dbt Cloud Base URL</label>
              <input
                type="text"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="https://cloud.getdbt.com"
                className="w-full bg-[#F8FAFC] border border-[#CBD5E1] focus:border-[#FF694B] rounded-xl px-3 py-2 text-xs font-mono outline-none"
              />
              <p className="text-[10px] text-[#94A3B8] mt-1">Use your account's own access URL (single-tenant/EU/AU accounts differ).</p>
            </div>
          </div>
          <button
            onClick={handleConnectManual}
            className="mt-4 bg-[#FF694B] hover:bg-[#E85A3E] text-white font-bold py-2.5 px-6 rounded-xl text-xs transition-all shadow-md cursor-pointer"
          >
            Connect dbt Cloud
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- CONNECTED
  const { account, billing } = data;
  const seats = billing.seats;
  const status = billing.accountStatus;

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

      {status.locked && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block mb-0.5">Account Locked</span>
            Reason: <code className="bg-rose-100 px-1 py-0.5 rounded">{status.lockCause || status.lockReason || 'unknown'}</code> — jobs cannot run until this is resolved in the dbt Cloud billing portal.
          </div>
        </div>
      )}
      {!status.locked && status.lockCause && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block mb-0.5">Billing Flag on Record: {status.lockCause}</span>
            This account previously hit <code className="bg-amber-100 px-1 py-0.5 rounded">{status.lockCause}</code>{status.unlockedAt ? ` and was unlocked on ${status.unlockedAt}.` : '.'} Worth confirming the subscription is current if jobs are behaving unexpectedly.
          </div>
        </div>
      )}
      {status.pendingCancel && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-bold">Subscription Cancellation Pending</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 bg-[#FFF0ED] text-[#FF694B] px-2.5 py-0.5 rounded-full text-xs font-bold border border-[#FFD9D1]">
            <CreditCard className="w-3.5 h-3.5" />
            <span>dbt Cloud Billing</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-[#10338D] tracking-tight">{account?.name || 'dbt Cloud'} Account</h1>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 rounded-lg text-xs font-semibold ${
              status.locked ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              <span className={`w-2 h-2 rounded-full ${status.locked ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`}></span>
              {status.locked ? 'Account Locked' : 'Account Active'}
            </span>
            <span className="inline-flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2.5 py-1 rounded-lg text-xs font-semibold text-[#10338D]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#FF694B]" />
              Plan: {account?.plan || 'Unknown'}
            </span>
            <span className="inline-flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2.5 py-1 rounded-lg text-xs text-[#666666]">
              <Mail className="w-3 h-3 text-[#FF694B]" />
              {billing.billingEmail || 'No billing email on file'}
            </span>
            {billing.lastRefreshedAt && (
              <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-[10px] text-slate-600 font-mono">
                Synced: {billing.lastRefreshedAt}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={handleChangeConnection}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F8FAFC] text-[#10338D] font-bold text-xs border border-[#D1DEFF] transition-all shadow-2xs flex items-center space-x-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-[#FF694B]" />
            <span>Change Connection</span>
          </button>

          <button
            onClick={() => handleManualRefresh()}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#D1DEFF] text-[#10338D] cursor-pointer transition-all shadow-2xs disabled:opacity-50"
            title="Refresh Billing Data Now"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#FF694B] ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Billing KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Seat Licensing Cost</p>
            <CreditCard className="w-4 h-4 text-emerald-600" />
          </div>
          <h2 className="text-xl font-black text-[#10338D]">
            {billing.seatCostUsd != null ? `$${billing.seatCostUsd.toLocaleString()}/mo` : 'Custom Pricing'}
          </h2>
          <p className="text-[10px] text-[#666666] mt-1 leading-tight">{billing.seatCostNote}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Developer Seats</p>
            <Users className="w-4 h-4 text-[#1C58F6]" />
          </div>
          <h2 className="text-xl font-black text-[#10338D]">{seats.developer}</h2>
          <p className="text-[10px] text-[#666666] mt-0.5">{seats.total} total seats across all roles</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Billing System</p>
            <Info className="w-4 h-4 text-[#FF694B]" />
          </div>
          <h2 className="text-base font-black text-[#10338D] leading-snug">{billing.billingSystem}</h2>
          <p className="text-[10px] text-[#666666] mt-1 leading-tight">{billing.billingSystemNote}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Trial End Date</p>
            <Clock className="w-4 h-4 text-[#1C58F6]" />
          </div>
          <h2 className="text-base font-black text-[#10338D]">{status.trialEndDate ? status.trialEndDate.split(' ')[0] : 'Not on trial'}</h2>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Pending Cancellation</p>
            {status.pendingCancel ? <AlertTriangle className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </div>
          <h2 className={`text-base font-black ${status.pendingCancel ? 'text-amber-600' : 'text-emerald-600'}`}>{status.pendingCancel ? 'Yes' : 'No'}</h2>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#D1DEFF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-[#666666] uppercase">Account Lock Status</p>
            {status.locked ? <XCircle className="w-4 h-4 text-rose-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </div>
          <h2 className={`text-base font-black ${status.locked ? 'text-rose-600' : 'text-emerald-600'}`}>{status.locked ? 'Locked' : 'Active'}</h2>
          {status.lockCause && <p className="text-[10px] text-[#666666] mt-0.5">Last cause: {status.lockCause}</p>}
        </div>
      </div>

      {/* Seat Breakdown */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm">
        <h2 className="text-sm font-black text-[#10338D] tracking-tight mb-4">Seat Breakdown by Role</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Developer', value: seats.developer },
            { label: 'Read-Only', value: seats.readOnly },
            { label: 'IT', value: seats.it },
            { label: 'Explorer', value: seats.explorer },
            { label: 'Analyst', value: seats.analyst },
          ].map((s) => (
            <div key={s.label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-[#666666] uppercase">{s.label}</p>
              <p className="text-lg font-black text-[#10338D] mt-1">{s.value}</p>
            </div>
          ))}
        </div>
        {(seats.activeUsers != null || seats.inactiveUsers != null) && (
          <div className="mt-4 pt-4 border-t border-[#ECEFFF] grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-emerald-700 uppercase">Active Developers</p>
              <p className="text-lg font-black text-emerald-700 mt-1">{seats.activeUsers ?? '—'}</p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Inactive Developers</p>
              <p className="text-lg font-black text-slate-500 mt-1">{seats.inactiveUsers ?? '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Model Build Usage — real run counts/outcomes; no quota (not exposed by any dbt Cloud API) */}
      {buildUsage && (
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-black text-[#10338D] tracking-tight flex items-center gap-2">
              <Hammer className="w-4 h-4 text-[#FF694B]" />
              Model Build Usage
            </h2>
            <span className="text-[10px] text-[#94A3B8] font-mono">Synced: {buildUsage.lastRefreshedAt}</span>
          </div>

          {buildUsage.alerts && buildUsage.alerts.length > 0 && buildUsage.alerts.map((a, idx) => (
            <div key={idx} className={`rounded-xl p-3.5 text-xs font-medium flex items-start gap-2 border ${
              a.severity === 'high' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <Zap className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block mb-0.5">Threshold Alert (not AI — a plain rule on real run counts)</span>
                {a.message}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Today', b: buildUsage.buildsToday },
              { label: 'This Week', b: buildUsage.buildsThisWeek },
              { label: 'This Month (30d)', b: buildUsage.buildsThisMonth },
            ].map(({ label, b }) => (
              <div key={label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5">
                <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">{label}</p>
                <p className="text-xl font-black text-[#10338D]">{b.total} runs</p>
                <p className="text-[11px] mt-1">
                  <span className="text-emerald-600 font-semibold">{b.success} success</span>
                  {' · '}
                  <span className="text-rose-600 font-semibold">{b.failed} failed</span>
                  {b.cancelled > 0 && <span className="text-slate-500 font-semibold"> · {b.cancelled} cancelled</span>}
                </p>
              </div>
            ))}
          </div>

          {buildUsage.buildTrend && buildUsage.buildTrend.length > 0 && (
            <div className="h-56 w-full">
              <ResponsiveContainer width="99%" height="100%">
                <AreaChart data={buildUsage.buildTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBuilds" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF694B" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#FF694B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #D1DEFF' }} />
                  <Area type="monotone" dataKey="total" name="Runs" stroke="#FF694B" strokeWidth={2} fillOpacity={1} fill="url(#colorBuilds)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5">
              <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">Model-Level Outcomes (sampled)</p>
              <p className="text-sm">
                <span className="text-emerald-600 font-bold">{buildUsage.modelOutcomes.successfulModels} succeeded</span>
                {' · '}
                <span className="text-rose-600 font-bold">{buildUsage.modelOutcomes.failedModels} failed</span>
              </p>
              <p className="text-[10px] text-[#94A3B8] mt-1">
                Sampled {buildUsage.modelOutcomes.sampledRunsWithResults}/{buildUsage.modelOutcomes.sampledRuns} runs with retrievable artifacts
              </p>
            </div>
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5">
              <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">Build Quota</p>
              <p className="text-sm font-bold text-[#10338D]">Not available via API</p>
              <p className="text-[10px] text-[#94A3B8] mt-1">{buildUsage.quotaNote}</p>
            </div>
          </div>
        </div>
      )}

      {/* Plan Entitlements */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm">
        <h2 className="text-sm font-black text-[#10338D] tracking-tight mb-4">Plan Entitlements</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="bg-[#F8FAFC] border border-[#D1DEFF] p-4 rounded-xl">
            <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">Run Slots</p>
            <p className="font-bold text-[#10338D] text-base">{billing.planLimits.runSlots ?? 'N/A'}</p>
            <p className="text-[11px] text-[#666666] mt-1">Max concurrent job runs this plan allows.</p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#D1DEFF] p-4 rounded-xl">
            <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">Queue Limit</p>
            <p className="font-bold text-[#10338D] text-base">{billing.planLimits.queueLimit ?? 'N/A'}</p>
            <p className="text-[11px] text-[#666666] mt-1">Max jobs that can be queued at once.</p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#D1DEFF] p-4 rounded-xl">
            <p className="text-[10px] font-bold text-[#666666] uppercase mb-1">Max Run Duration</p>
            <p className="font-bold text-[#10338D] text-base">{billing.planLimits.runDurationLimitHours} hrs</p>
            <p className="text-[11px] text-[#666666] mt-1">Longest a single job run may execute.</p>
          </div>
        </div>
      </div>

      {/* Honesty note */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 flex items-start gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
        <p>
          dbt Cloud has no invoice, usage-cost, build-quota, or AI/Copilot-usage API — so no $ spend, budget,
          "% of quota used," or Copilot token figures are shown anywhere here; that data only exists in dbt
          Cloud's own billing portal. Everything above (seats, build counts, model outcomes) is fetched live
          from the Admin API. Detailed job/DAG-level monitoring and the AI query copilot live separately in
          <strong> Governance &rarr; Monitoring</strong>.
        </p>
      </div>
    </div>
  );
}
