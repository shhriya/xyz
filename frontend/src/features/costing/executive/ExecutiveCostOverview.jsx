import React, { useMemo, useState } from 'react';
import {
  Coins, DollarSign, Server, HardDrive, Cpu, Zap, Activity, Database, Gauge, Terminal,
  CalendarDays, RefreshCw, Download, Filter, RotateCcw, AlertTriangle, Info,
  TrendingUp, Sparkles, ArrowRight, BarChart3, PieChart, Layers
} from 'lucide-react';
import {
  INK, BODY, MUTED, CARD, ACCENT, SERIES, fmtMoney, fmtNum,
  KpiCard, SectionTitle, EmptyState, Skeleton, DataTable, NotAvailable, MultiSelect
} from './ExecOverviewPrimitives';

/*
 * Executive Cost Overview.
 *
 * Every figure here is derived from the live payload the costing service already returns. Metrics
 * that the connected Snowflake account genuinely cannot supply (department/environment tagging,
 * serverless split, Time Travel vs Fail-safe storage, per-database growth, warehouse runtime/idle)
 * are rendered as an explicit "not available" with the reason, never as a zero or an invented
 * number — a fabricated figure on an executive page is worse than an honest gap.
 */

const RANGES = [
  { id: 'weekly', label: 'Last 7 Days' },
  { id: 'monthly', label: 'Last 30 Days' },
  { id: 'yearly', label: 'Last 365 Days' }
];

const NEEDS_TAGGING = 'Requires cost-centre tagging in Snowflake (object tags or a mapping table). Not available from ACCOUNT_USAGE alone.';
const NEEDS_SERVERLESS = 'Serverless cost is billed under separate metering services that this page does not query yet.';
const NEEDS_STORAGE_DETAIL = 'STORAGE_USAGE reports a combined figure; the Time Travel / Fail-safe split needs a separate query.';
const NEEDS_RUNTIME = 'Warehouse runtime and idle time need WAREHOUSE_EVENTS_HISTORY, which this page does not query yet.';

function Badge({ tone = 'info', children }) {
  const tones = {
    info: 'bg-[#ECEFFF] text-[#10338D] border-[#1C58F6]/30',
    good: 'bg-[#ECFDF5] text-[#065F46] border-[#34D399]/40',
    warn: 'bg-[#FFF7ED] text-[#9A3412] border-[#FB923C]/40',
    bad: 'bg-[#FFF1F2] text-[#9F1239] border-[#FDA4AF]'
  };
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${tones[tone]}`}>{children}</span>;
}

/** Horizontal bar list — used for warehouse cost and service breakdown. */
function BarList({ rows, valueKey, labelKey, currency, showPct = true }) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  const total = rows.reduce((a, r) => a + (Number(r[valueKey]) || 0), 0);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <div key={i} className="flex items-center gap-2.5">
            <span className={`w-36 text-[11px] ${BODY} truncate shrink-0`} title={String(r[labelKey])}>{r[labelKey]}</span>
            <div className="flex-1 h-4 bg-[#F1F5F9] rounded overflow-hidden">
              <div className="h-full rounded transition-all"
                style={{ width: `${Math.max((v / max) * 100, 1)}%`, backgroundColor: SERIES[i % SERIES.length] }} />
            </div>
            <span className={`w-20 text-[11px] font-mono font-semibold ${INK} text-right shrink-0`}>{fmtMoney(v, currency)}</span>
            {showPct && (
              <span className={`w-12 text-[10px] ${MUTED} text-right shrink-0`}>
                {total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Donut built from inline SVG — no chart dependency needed. */
function Donut({ slices, currency }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <EmptyState title="No cost recorded in this period" icon={PieChart} />;
  const r = 52, c = 2 * Math.PI * r;
  // Precompute cumulative offsets so nothing is mutated while rendering.
  const offsets = slices.reduce((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (slices[i - 1].value / total) * c);
    return acc;
  }, []);
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
        <g transform="translate(70,70) rotate(-90)">
          {slices.map((s, i) => {
            const frac = s.value / total;
            return (
              <circle key={i} r={r} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="22"
                strokeDasharray={`${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}`}
                strokeDashoffset={-offsets[i]} />
            );
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-[#0F172A]" style={{ fontSize: 15, fontWeight: 800 }}>
          {fmtMoney(total, currency)}
        </text>
        <text x="70" y="82" textAnchor="middle" className="fill-[#64748B]" style={{ fontSize: 9 }}>total</text>
      </svg>
      <div className="space-y-1.5 min-w-[180px]">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: SERIES[i % SERIES.length] }} />
            <span className={`${BODY} flex-1`}>{s.label}</span>
            <span className={`font-mono font-semibold ${INK}`}>{fmtMoney(s.value, currency)}</span>
            <span className={`${MUTED} w-11 text-right`}>{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Line chart with an optional rolling average, in inline SVG. */
function TrendChart({ points, valueKey, label, currency, mode }) {
  const [showAvg, setShowAvg] = useState(true);
  if (!points || points.length < 2) {
    return <EmptyState title="Not enough history to plot a trend"
      detail={`This window contains ${points?.length || 0} data point(s). A trend needs at least two days of activity.`} icon={BarChart3} />;
  }
  const vals = points.map((p) => Number(p[valueKey]) || 0);
  const max = Math.max(...vals, 1);
  const W = 640, H = 150, pad = 4;
  const step = (W - pad * 2) / (vals.length - 1);
  const y = (v) => H - (v / max) * (H - 20) - pad;
  const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const win = Math.min(7, Math.max(2, Math.floor(vals.length / 3)));
  const avg = vals.map((_, i) => {
    const s = Math.max(0, i - win + 1);
    const seg = vals.slice(s, i + 1);
    return seg.reduce((a, b) => a + b, 0) / seg.length;
  });
  const avgPath = avg.map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[11px] ${MUTED}`}>{label}</span>
        <label className={`text-[10px] ${MUTED} flex items-center gap-1.5 cursor-pointer`}>
          <input type="checkbox" checked={showAvg} onChange={(e) => setShowAvg(e.target.checked)} />
          Rolling average ({win}-point)
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
        <line x1="0" y1={H - pad} x2={W} y2={H - pad} stroke="#E2E8F0" strokeWidth="1" />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {showAvg && <path d={avgPath} fill="none" stroke="#FF3C00" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        {vals.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={y(v)} r="2.5" fill={ACCENT}>
            <title>{`${points[i].day}: ${mode === 'usd' ? fmtMoney(v, currency) : `${fmtNum(v, 2)} credits`}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between">
        <span className={`text-[10px] ${MUTED}`}>{points[0].day}</span>
        <span className={`text-[10px] ${MUTED}`}>{points[points.length - 1].day}</span>
      </div>
    </div>
  );
}

function Gauge100({ pct, label, tone }) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 48, c = 2 * Math.PI * r;
  const colour = tone === 'bad' ? '#DC2626' : tone === 'warn' ? '#F88B26' : '#059669';
  return (
    <div className="flex flex-col items-center">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <g transform="translate(65,65) rotate(-90)">
          <circle r={r} fill="none" stroke="#F1F5F9" strokeWidth="14" />
          <circle r={r} fill="none" stroke={colour} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${((clamped / 100) * c).toFixed(2)} ${c}`} />
        </g>
        <text x="65" y="63" textAnchor="middle" style={{ fontSize: 24, fontWeight: 900 }} className="fill-[#0F172A]">
          {Math.round(clamped)}
        </text>
        <text x="65" y="80" textAnchor="middle" style={{ fontSize: 9 }} className="fill-[#64748B]">{label}</text>
      </svg>
    </div>
  );
}

export default function ExecutiveCostOverview({
  data, loading, error, timeRange, onTimeRangeChange, onRefresh, isRefreshing, onNavigate
}) {
  const summary = data?.summary || {};
  const warehouses = data?.warehouses || [];
  const users = data?.users || [];
  const costTrend = data?.costTrend || [];
  const currency = summary.currency || 'USD';

  const [selectedWarehouses, setSelectedWarehouses] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedDatabases, setSelectedDatabases] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [selectedEnvs, setSelectedEnvs] = useState([]);
  const [selectedDepts, setSelectedDepts] = useState([]);
  const [trendMode, setTrendMode] = useState('credits');
  const [budget, setBudget] = useState(() => {
    try { return Number(localStorage.getItem('agy_sf_budget')) || 0; } catch { return 0; }
  });

  const saveBudget = (v) => {
    setBudget(v);
    try { localStorage.setItem('agy_sf_budget', String(v)); } catch { /* storage blocked */ }
  };

  const dims = data?.filterDimensions || {};
  const dbOptions = (dims.databases || []).map((d) => d.name);
  const roleOptions = dims.roles || [];
  const envOptions = dims.environments || [];
  const deptOptions = (dims.departments || []).map((d) => d.name);

  // Database, role and environment are query-level dimensions, so they are applied by filtering
  // the query list and re-deriving which warehouses and users remain in scope.
  const queries = data?.expensiveQueries || [];
  const envOf = (name) => {
    const n = (name || '').toUpperCase();
    const map = [['PROD', 'PROD'], ['PRD', 'PROD'], ['QA', 'QA'], ['UAT', 'QA'], ['STG', 'QA'],
      ['STAGE', 'QA'], ['DEV', 'DEV'], ['TEST', 'DEV']];
    const hit = map.find(([t]) => n.includes(t));
    return hit ? hit[1] : 'UNTAGGED';
  };

  const queryScoped = selectedDatabases.length > 0 || selectedRoles.length > 0 || selectedEnvs.length > 0;
  const scopedQueries = useMemo(() => queries.filter((q) =>
    (selectedDatabases.length === 0 || selectedDatabases.includes(q.databaseName)) &&
    (selectedRoles.length === 0 || selectedRoles.includes(q.roleName)) &&
    (selectedEnvs.length === 0 || selectedEnvs.includes(envOf(q.databaseName)) || selectedEnvs.includes(envOf(q.warehouseName)))
  ), [queries, selectedDatabases, selectedRoles, selectedEnvs]);

  const scopedWarehouseNames = useMemo(
    () => new Set(scopedQueries.map((q) => q.warehouseName).filter(Boolean)), [scopedQueries]);
  const scopedUserNames = useMemo(
    () => new Set(scopedQueries.map((q) => q.userName).filter(Boolean)), [scopedQueries]);

  // Filters apply client-side to the data already fetched. Declared after the query-level
  // dimensions above, because these read queryScoped/scopedWarehouseNames during render.
  const fWarehouses = useMemo(() => warehouses.filter((w) =>
    (selectedWarehouses.length === 0 || selectedWarehouses.includes(w.name)) &&
    (!queryScoped || scopedWarehouseNames.has(w.name))
  ), [warehouses, selectedWarehouses, queryScoped, scopedWarehouseNames]);

  const fUsers = useMemo(() => users.filter((u) =>
    (selectedUsers.length === 0 || selectedUsers.includes(u.user)) &&
    (!queryScoped || scopedUserNames.has(u.user))
  ), [users, selectedUsers, queryScoped, scopedUserNames]);

  const filtersActive = selectedWarehouses.length > 0 || selectedUsers.length > 0
    || queryScoped || selectedDepts.length > 0;

  // Cortex AI is a separate Snowflake meter and is reported on its own tab, not here.
  const rate = Number(summary.creditRate) || 0;
  const computeCredits = fWarehouses.reduce((a, w) => a + (Number(w.creditsConsumed) || 0), 0);
  const computeCost = fWarehouses.reduce((a, w) => a + (Number(w.costUsd) || 0), 0);
  const storageCost = Number(summary.storageCostUsd) || 0;
  // Total spend = compute + storage only. Cortex AI is reported on the Cortex & AI Tokens tab.
  const totalCost = filtersActive ? computeCost + storageCost : (Number(summary.totalCostUsd) || 0);

  const idleWarehouses = fWarehouses.filter((w) => (Number(w.creditsConsumed) || 0) === 0);
  const activeWarehouses = fWarehouses.filter((w) => (Number(w.creditsConsumed) || 0) > 0);
  const creditSpark = costTrend.map((d) => Number(d.computeCredits) || 0);
  const usdSpark = costTrend.map((d) => Number(d.totalCostUsd) || 0);

  // Forecast from observed run-rate across the days actually present in the window.
  const daysObserved = costTrend.length || 1;
  const rangeDays = timeRange === 'weekly' ? 7 : timeRange === 'yearly' ? 365 : 30;
  const dailyBurn = totalCost / daysObserved;
  const forecast = dailyBurn * rangeDays;
  const budgetPct = budget > 0 ? (totalCost / budget) * 100 : null;

  const insights = useMemo(() => {
    const out = [];
    const top = [...fWarehouses].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0))[0];
    if (top && top.costUsd > 0) {
      const share = totalCost > 0 ? (top.costUsd / totalCost) * 100 : 0;
      out.push({
        sev: share > 60 ? 'warn' : 'info',
        title: `${top.name} is the largest consumer`,
        body: `${fmtMoney(top.costUsd, currency)} (${share.toFixed(1)}% of spend) across ${fmtNum(top.creditsConsumed, 2)} credits.`
      });
    }
    if (idleWarehouses.length > 0) {
      const pct = (idleWarehouses.length / Math.max(1, fWarehouses.length)) * 100;
      out.push({
        sev: pct > 50 ? 'warn' : 'info',
        title: `${idleWarehouses.length} of ${fWarehouses.length} warehouses consumed no credits`,
        body: `${pct.toFixed(0)}% are idle in this window. Idle warehouses cost nothing while suspended, but unused ones are worth decommissioning.`
      });
    }
    const wasted = Number(summary.potentialSavingsUsd) || 0;
    if (wasted > 0) {
      out.push({
        sev: wasted > totalCost * 0.05 ? 'warn' : 'info',
        title: `${fmtMoney(wasted, currency)} spent on failed queries`,
        body: `${summary.failedQueryCount || 0} failed queries burned ${fmtNum(summary.failedQueryCreditsWasted, 2)} credits that produced no result.`
      });
    }
    const longSuspend = fWarehouses.filter((w) => (Number(w.autoSuspendSec) || 0) > 600);
    if (longSuspend.length > 0) {
      out.push({
        sev: 'warn',
        title: `${longSuspend.length} warehouse(s) auto-suspend after 10+ minutes`,
        body: `${longSuspend.map((w) => w.name).join(', ')} stay warm longer than needed. Lowering auto-suspend cuts idle compute.`
      });
    }
    if (budgetPct !== null && budgetPct > 90) {
      out.push({
        sev: budgetPct > 100 ? 'bad' : 'warn',
        title: budgetPct > 100 ? 'Budget exceeded' : 'Approaching budget',
        body: `${fmtMoney(totalCost, currency)} of ${fmtMoney(budget, currency)} used (${budgetPct.toFixed(0)}%). At the current run rate the period ends near ${fmtMoney(forecast, currency)}.`
      });
    }
    if (Number(summary.storageTb) > 0) {
      out.push({
        sev: 'info',
        title: `${Number(summary.storageTb).toFixed(2)} TB stored`,
        body: `Costing ${fmtMoney(storageCost, currency)} per month at list price. Review Time Travel retention on large transient tables.`
      });
    }
    return out.slice(0, 8);
  }, [fWarehouses, idleWarehouses, totalCost, summary, currency, budgetPct, budget, forecast, storageCost]);

  // Health score from the signals actually measurable here; each component is shown so the
  // number is auditable rather than a black box.
  const health = useMemo(() => {
    const parts = [];
    const idlePct = fWarehouses.length ? (idleWarehouses.length / fWarehouses.length) * 100 : 0;
    parts.push({ label: 'Warehouse usage', score: Math.max(0, 100 - idlePct), detail: `${idlePct.toFixed(0)}% idle` });

    const wastePct = totalCost > 0 ? ((Number(summary.potentialSavingsUsd) || 0) / totalCost) * 100 : 0;
    parts.push({ label: 'Query success', score: Math.max(0, 100 - wastePct * 4), detail: `${wastePct.toFixed(1)}% spend on failed queries` });

    const suspendOk = fWarehouses.length
      ? (fWarehouses.filter((w) => (Number(w.autoSuspendSec) || 0) <= 300).length / fWarehouses.length) * 100 : 100;
    parts.push({ label: 'Auto-suspend config', score: suspendOk, detail: `${suspendOk.toFixed(0)}% within 5 min` });

    if (budgetPct !== null) {
      parts.push({ label: 'Budget adherence', score: Math.max(0, 100 - Math.max(0, budgetPct - 80) * 2), detail: `${budgetPct.toFixed(0)}% of budget used` });
    }
    const overall = parts.reduce((a, p) => a + p.score, 0) / parts.length;
    return { overall, parts };
  }, [fWarehouses, idleWarehouses, totalCost, summary, budgetPct]);

  const exportCsv = () => {
    const rows = [
      ['Metric', 'Value'],
      ['Period', summary.billingPeriod || ''],
      ['Total credits', summary.totalCreditsConsumed ?? ''],
      ['Total cost', totalCost.toFixed(2)],
      ['Compute cost', computeCost.toFixed(2)],
      ['Storage cost', storageCost.toFixed(2)],
      ['Queries executed', summary.realTimeQueriesCount ?? ''],
      ['Storage TB', summary.storageTb ?? ''],
      [],
      ['Warehouse', 'Credits', 'Cost', 'Auto-suspend (s)'],
      ...fWarehouses.map((w) => [w.name, w.creditsConsumed, w.costUsd, w.autoSuspendSec]),
      [],
      ['User', 'Queries', 'Credits'],
      ...fUsers.map((u) => [u.user, u.queriesRun, u.creditsConsumed])
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `snowflake-executive-overview-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className={`${CARD} p-10 text-center space-y-3`}>
        <AlertTriangle className="w-8 h-8 text-[#DC2626] mx-auto" />
        <p className={`text-[14px] font-bold ${INK}`}>Could not load cost data</p>
        <p className={`text-[12px] ${MUTED} max-w-lg mx-auto`}>{String(error)}</p>
        <button onClick={() => onRefresh?.()} className="mx-auto px-4 py-2 rounded-xl bg-[#10338D] hover:bg-[#0A225E] text-white text-[13px] font-bold flex items-center gap-2 cursor-pointer">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-52 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. HEADER */}
      <div className={`${CARD} p-5 flex flex-wrap items-start justify-between gap-3`}>
        <div>
          <h2 className={`text-[18px] font-black ${INK} tracking-tight`}>Executive Cost Overview</h2>
          <p className={`text-[11px] ${MUTED} mt-0.5`}>
            {summary.billingPeriod || 'Current period'} &middot; last refreshed {summary.lastRefreshedAt || '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onRefresh?.()} disabled={isRefreshing}
            className="px-3.5 py-2 rounded-lg bg-[#10338D] hover:bg-[#0A225E] text-white text-[12px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={exportCsv}
            className={`px-3.5 py-2 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} text-[12px] font-bold flex items-center gap-1.5 cursor-pointer`}>
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* 2. FILTER BAR */}
      <div className={`${CARD} p-4 sticky top-2 z-20 shadow-sm`}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={`text-[10px] font-bold uppercase ${MUTED} flex items-center gap-1`}><CalendarDays className="w-3 h-3" />Date range</label>
            <select value={timeRange} onChange={(e) => onTimeRangeChange?.(e.target.value)}
              className="block mt-1 text-[12px] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 bg-white text-[#0F172A] font-mono cursor-pointer">
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>

          <MultiSelect
            label="Warehouse" icon={Server} allLabel="All warehouses"
            options={warehouses.map((w) => w.name)}
            selected={selectedWarehouses} onChange={setSelectedWarehouses}
          />

          <MultiSelect
            label="User" icon={Activity} allLabel="All users"
            options={users.map((u) => u.user)}
            selected={selectedUsers} onChange={setSelectedUsers}
          />

          <MultiSelect
            label="Database" icon={Database} allLabel="All databases"
            options={dbOptions} selected={selectedDatabases} onChange={setSelectedDatabases}
          />

          <MultiSelect
            label="Role" icon={Filter} allLabel="All roles"
            options={roleOptions} selected={selectedRoles} onChange={setSelectedRoles}
          />

          <MultiSelect
            label="Environment" icon={Layers} allLabel="All environments"
            options={envOptions} selected={selectedEnvs} onChange={setSelectedEnvs}
          />

          {deptOptions.length > 0 ? (
            <MultiSelect
              label="Department" icon={Filter} allLabel="All departments"
              options={deptOptions} selected={selectedDepts} onChange={setSelectedDepts}
            />
          ) : (
            <div title={dims.departmentStatus === 'unavailable'
              ? 'TAG_REFERENCES is not readable with this role or edition.'
              : 'No cost-centre tags found. Tag warehouses or databases in Snowflake to enable this.'}>
              <label className={`text-[10px] font-bold uppercase ${MUTED} flex items-center gap-1`}><Filter className="w-3 h-3" />Department</label>
              <div className="mt-1 text-[12px] border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 bg-[#F8FAFC] text-[#94A3B8] min-w-[140px]">
                No tags found
              </div>
            </div>
          )}

          <div title="A Snowflake account lives in a single region, so this is shown for reference rather than as a filter.">
            <label className={`text-[10px] font-bold uppercase ${MUTED} flex items-center gap-1`}><Filter className="w-3 h-3" />Region</label>
            <div className="mt-1 text-[12px] font-mono border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 bg-[#F8FAFC] text-[#334155] min-w-[120px]">
              {dims.region || '\u2014'}
            </div>
          </div>

          <button onClick={() => { setSelectedWarehouses([]); setSelectedUsers([]); setSelectedDatabases([]); setSelectedRoles([]); setSelectedEnvs([]); setSelectedDepts([]); }}
            className={`px-3 py-2 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} text-[12px] font-bold flex items-center gap-1.5 cursor-pointer`}>
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
          <button onClick={exportCsv}
            className={`px-3 py-2 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} text-[12px] font-bold flex items-center gap-1.5 cursor-pointer`}>
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
        {filtersActive && (
          <p className="text-[10px] text-[#9A3412] bg-[#FFF7ED] border border-[#FB923C]/40 rounded px-2 py-1 mt-2 inline-block">
            Filters applied to warehouse and user figures{queryScoped ? ', scoped by the matching queries' : ''}. Storage is account-wide and stays unfiltered.
          </p>
        )}
      </div>

      {/* 3. KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-6 gap-3">
        <KpiCard label="Compute credits" value={fmtNum(filtersActive ? computeCredits : summary.computeCreditsConsumed ?? summary.totalCreditsConsumed, 2)}
          icon={Coins} spark={creditSpark} footnote="warehouses only" />
        <KpiCard label="Total spend" value={fmtMoney(totalCost, currency)} icon={DollarSign} spark={usdSpark}
          footnote="compute + storage (AI shown separately)" />
        <KpiCard label="Compute cost" value={fmtMoney(computeCost, currency)} icon={Server} footnote={`${fmtNum(computeCredits, 2)} warehouse credits`} />
        <KpiCard label="Storage cost" value={fmtMoney(storageCost, currency)} icon={HardDrive} footnote="list price, monthly" />
        <KpiCard label="Serverless cost" unavailable={NEEDS_SERVERLESS} icon={Zap} />
        <KpiCard label="Active warehouses" value={fmtNum(activeWarehouses.length)} icon={Activity} invertDelta={false} />
        <KpiCard label="Idle warehouses" value={fmtNum(idleWarehouses.length)} icon={Server} footnote="no credits this period" />
        <KpiCard label="Avg utilization" unavailable={NEEDS_RUNTIME} icon={Gauge} />
        <KpiCard label="Queries executed" value={fmtNum(summary.realTimeQueriesCount)} icon={Terminal} invertDelta={false} />
        <KpiCard label="Storage used" value={Number(summary.storageTb || 0).toFixed(2)} unit="TB" icon={Database} />
        <KpiCard label="Est. period spend" value={fmtMoney(forecast, currency)} icon={TrendingUp}
          footnote={`run rate ${fmtMoney(dailyBurn, currency)}/day`} />
      </div>

      {/* 4. COST TREND */}
      <div className={`${CARD} p-5`}>
        <SectionTitle
          title="Cost trend"
          subtitle={`Daily consumption across ${summary.billingPeriod || 'the period'}`}
          right={
            <div className="flex gap-1">
              {['credits', 'usd'].map((m) => (
                <button key={m} onClick={() => setTrendMode(m)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer ${
                    trendMode === m ? 'bg-[#10338D] text-white' : `bg-white border border-[#CBD5E1] ${BODY}`}`}>
                  {m === 'credits' ? 'Credits' : currency}
                </button>
              ))}
            </div>
          }
        />
        <TrendChart
          points={costTrend}
          valueKey={trendMode === 'credits' ? 'computeCredits' : 'totalCostUsd'}
          label={trendMode === 'credits' ? 'Daily credit consumption' : `Daily spend (${currency})`}
          currency={currency}
          mode={trendMode}
        />
      </div>

      {/* 5. COST BREAKDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${CARD} p-5`}>
          <SectionTitle title="Cost by service" subtitle="Warehouse compute and storage" />
          <Donut
            currency={currency}
            slices={[
              { label: 'Compute', value: computeCost },
              { label: 'Storage', value: storageCost }
            ].filter((s) => s.value > 0)}
          />
          <p className={`text-[10px] ${MUTED} mt-3 flex items-start gap-1`}>
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            Serverless is excluded ({NEEDS_SERVERLESS}). Cortex AI spend is reported on the Cortex &amp; AI Tokens tab.
          </p>
        </div>

        <div className={`${CARD} p-5`}>
          <SectionTitle title="Cost by warehouse" subtitle="Top 10 by spend" />
          {fWarehouses.length === 0 ? (
            <EmptyState title="No warehouses match the current filters" icon={Server} />
          ) : (
            <BarList
              currency={currency}
              labelKey="name"
              valueKey="costUsd"
              rows={[...fWarehouses].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0)).slice(0, 10)}
            />
          )}
        </div>
      </div>

      {/* Cost by database - derived from query attribution */}
      <div className={`${CARD} p-5`}>
        <SectionTitle title="Cost by database" subtitle="Estimated from query elapsed time and warehouse size" />
        {(dims.databases || []).length === 0 ? (
          <EmptyState title="No database attribution available"
            detail="QUERY_HISTORY returned no database context for this period." icon={Database} />
        ) : (
          <BarList currency={currency} labelKey="name" valueKey="costUsd"
            rows={(dims.databases || [])
              .filter((d) => selectedDatabases.length === 0 || selectedDatabases.includes(d.name))
              .slice(0, 10)
              .map((d) => ({ ...d, costUsd: (Number(d.credits) || 0) * rate }))} />
        )}
        <p className={`text-[10px] ${MUTED} mt-3 flex items-start gap-1`}>
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Estimated per query, so this will not tie exactly to warehouse metering.
        </p>
      </div>

      {/* Department allocation */}
      <div className={`${CARD} p-5`}>
        <SectionTitle title="Cost by department" subtitle="Chargeback allocation" />
        {deptOptions.length > 0 ? (
          <div className="space-y-2">
            {(dims.departments || []).map((d) => (
              <div key={d.name} className="flex items-center justify-between border border-[#E2E8F0] rounded-lg px-3 py-2">
                <span className={`text-[12px] font-bold ${INK}`}>{d.name}</span>
                <span className={`text-[11px] ${MUTED}`}>{d.objects.length} tagged object(s)</span>
              </div>
            ))}
            <p className={`text-[10px] ${MUTED} flex items-start gap-1`}>
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Tags found. Allocating spend per department also needs each tagged object mapped to its credits.
            </p>
          </div>
        ) : (
          <EmptyState
            title="Department allocation is not available"
            detail={NEEDS_TAGGING}
            icon={PieChart}
          />
        )}
      </div>

      {/* 6. WAREHOUSE ACTIVITY */}
      <div className={`${CARD} p-5`}>
        <SectionTitle title="Warehouse activity" subtitle={`${fWarehouses.length} warehouse(s) in scope`} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3">
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Consumed credits</p>
            <p className={`text-[18px] font-black ${INK} font-mono mt-0.5`}>{activeWarehouses.length}</p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3">
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Idle this period</p>
            <p className={`text-[18px] font-black ${INK} font-mono mt-0.5`}>{idleWarehouses.length}</p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3" title={NEEDS_RUNTIME}>
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Avg runtime</p>
            <p className="mt-0.5"><NotAvailable reason={NEEDS_RUNTIME} /></p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3" title={NEEDS_RUNTIME}>
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Avg idle time</p>
            <p className="mt-0.5"><NotAvailable reason={NEEDS_RUNTIME} /></p>
          </div>
        </div>

        <DataTable
          searchKeys={['name']}
          initialSort={{ key: 'costUsd', dir: 'desc' }}
          rows={fWarehouses}
          emptyText="No warehouses match the current filters."
          columns={[
            { key: 'name', label: 'Warehouse' },
            { key: 'size', label: 'Size' },
            { key: 'creditsConsumed', label: 'Credits', align: 'right', render: (r) => fmtNum(r.creditsConsumed, 2) },
            { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => fmtMoney(r.costUsd, currency) },
            { key: 'autoSuspendSec', label: 'Auto-suspend', align: 'right', render: (r) => `${r.autoSuspendSec || 0}s` },
            {
              key: 'status', label: 'Status',
              render: (r) => {
                const credits = Number(r.creditsConsumed) || 0;
                const share = totalCost > 0 ? ((Number(r.costUsd) || 0) / totalCost) * 100 : 0;
                if (credits === 0) return <Badge tone="info">Idle</Badge>;
                if (share > 50) return <Badge tone="warn">High cost</Badge>;
                if ((Number(r.autoSuspendSec) || 0) > 600) return <Badge tone="warn">Slow suspend</Badge>;
                return <Badge tone="good">Healthy</Badge>;
              }
            }
          ]}
        />
      </div>

      {/* 7. TOP COST CONSUMERS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${CARD} p-5`}>
          <SectionTitle title="Top warehouses by cost" />
          <DataTable
            searchKeys={['name']}
            initialSort={{ key: 'costUsd', dir: 'desc' }}
            rows={fWarehouses}
            columns={[
              { key: 'name', label: 'Warehouse' },
              { key: 'creditsConsumed', label: 'Credits', align: 'right', render: (r) => fmtNum(r.creditsConsumed, 2) },
              { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => fmtMoney(r.costUsd, currency) },
              {
                key: 'share', label: '% of spend', align: 'right',
                render: (r) => (totalCost > 0 ? `${(((Number(r.costUsd) || 0) / totalCost) * 100).toFixed(1)}%` : '—')
              }
            ]}
          />
        </div>

        <div className={`${CARD} p-5`}>
          <SectionTitle title="Top users by cost" />
          <DataTable
            searchKeys={['user']}
            initialSort={{ key: 'creditsConsumed', dir: 'desc' }}
            rows={fUsers}
            emptyText="No per-user attribution available for this period."
            columns={[
              { key: 'user', label: 'User' },
              { key: 'queriesRun', label: 'Queries', align: 'right', render: (r) => fmtNum(r.queriesRun) },
              { key: 'creditsConsumed', label: 'Credits', align: 'right', render: (r) => fmtNum(r.creditsConsumed, 4) },
              { key: 'cost', label: 'Cost', align: 'right', render: (r) => fmtMoney((Number(r.creditsConsumed) || 0) * rate, currency) }
            ]}
          />
        </div>
      </div>

      {/* 8. STORAGE */}
      <div className={`${CARD} p-5`}>
        <SectionTitle title="Storage overview" subtitle="Average across the last 30 days" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3">
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Total storage</p>
            <p className={`text-[18px] font-black ${INK} font-mono mt-0.5`}>{Number(summary.storageTb || 0).toFixed(3)} TB</p>
            <p className={`text-[10px] ${MUTED}`}>{fmtMoney(storageCost, currency)}/mo</p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3" title={NEEDS_STORAGE_DETAIL}>
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Time Travel</p>
            <p className="mt-0.5"><NotAvailable reason={NEEDS_STORAGE_DETAIL} /></p>
          </div>
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3" title={NEEDS_STORAGE_DETAIL}>
            <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Fail-safe</p>
            <p className="mt-0.5"><NotAvailable reason={NEEDS_STORAGE_DETAIL} /></p>
          </div>
        </div>
        <p className={`text-[10px] ${MUTED} mt-3 flex items-start gap-1`}>
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Per-database breakdown and growth trend need a query against DATABASE_STORAGE_USAGE_HISTORY, which this page does not run yet.
        </p>
      </div>

      {/* 9. BUDGET */}
      <div className={`${CARD} p-5`}>
        <SectionTitle
          title="Budget overview"
          subtitle="Budget is stored in this browser only — it is not written to Snowflake"
        />
        <div className="flex flex-wrap items-center gap-6">
          <Gauge100
            pct={budgetPct ?? 0}
            label={budgetPct === null ? 'no budget' : '% used'}
            tone={budgetPct === null ? 'good' : budgetPct > 100 ? 'bad' : budgetPct > 80 ? 'warn' : 'good'}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-[280px]">
            <div>
              <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Monthly budget</p>
              <input type="number" min="0" value={budget || ''} placeholder="Set budget"
                onChange={(e) => saveBudget(Number(e.target.value) || 0)}
                className="mt-1 w-full text-[13px] font-mono border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-[#0F172A] focus:outline-none focus:border-[#1C58F6]" />
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Spend so far</p>
              <p className={`text-[16px] font-black ${INK} font-mono mt-1`}>{fmtMoney(totalCost, currency)}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Remaining</p>
              <p className={`text-[16px] font-black font-mono mt-1 ${budget > 0 && totalCost > budget ? 'text-[#DC2626]' : INK}`}>
                {budget > 0 ? fmtMoney(budget - totalCost, currency) : <NotAvailable reason="Set a budget to track remaining spend." />}
              </p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${MUTED}`}>Burn rate</p>
              <p className={`text-[16px] font-black ${INK} font-mono mt-1`}>{fmtMoney(dailyBurn, currency)}<span className={`text-[10px] ${MUTED}`}>/day</span></p>
            </div>
          </div>
        </div>
        <p className={`text-[11px] ${BODY} mt-4 bg-[#ECEFFF] border border-[#1C58F6]/30 rounded-lg px-3 py-2`}>
          At the current run rate, this {rangeDays}-day period ends near <strong>{fmtMoney(forecast, currency)}</strong>
          {budget > 0 && (forecast > budget
            ? <> — <span className="text-[#9F1239] font-bold">{fmtMoney(forecast - budget, currency)} over budget</span>.</>
            : <> — within budget.</>)}
          {costTrend.length < 3 && <> Based on only {costTrend.length} day(s) of data, so treat it as indicative.</>}
        </p>
      </div>

      {/* 10 + 11. INSIGHTS AND HEALTH SCORE */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${CARD} p-5 lg:col-span-2`}>
          <SectionTitle title="Executive insights" subtitle="Rule-based, derived from this period's data" />
          {insights.length === 0 ? (
            <EmptyState title="No notable findings" detail="Nothing in this period crossed a cost, idle or failure threshold." icon={Sparkles} />
          ) : (
            <div className="space-y-2">
              {insights.map((ins, i) => {
                const tone = ins.sev === 'bad' ? 'border-[#FDA4AF] bg-[#FFF1F2]'
                  : ins.sev === 'warn' ? 'border-[#FB923C]/40 bg-[#FFF7ED]'
                  : 'border-[#1C58F6]/30 bg-[#ECEFFF]';
                const Icon = ins.sev === 'bad' ? AlertTriangle : ins.sev === 'warn' ? AlertTriangle : Info;
                const ic = ins.sev === 'bad' ? 'text-[#9F1239]' : ins.sev === 'warn' ? 'text-[#9A3412]' : 'text-[#10338D]';
                return (
                  <div key={i} className={`border rounded-xl px-4 py-3 flex items-start gap-2.5 ${tone}`}>
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${ic}`} />
                    <div>
                      <p className={`text-[12px] font-bold ${ic}`}>{ins.title}</p>
                      <p className={`text-[11px] ${BODY} mt-0.5 leading-relaxed`}>{ins.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`${CARD} p-5`}>
          <SectionTitle title="Cost health score" />
          <div className="flex flex-col items-center">
            <Gauge100
              pct={health.overall}
              label="/ 100"
              tone={health.overall >= 75 ? 'good' : health.overall >= 50 ? 'warn' : 'bad'}
            />
            <div className="w-full space-y-2 mt-3">
              {health.parts.map((p) => (
                <div key={p.label}>
                  <div className="flex justify-between text-[11px]">
                    <span className={BODY}>{p.label}</span>
                    <span className={`font-mono font-bold ${INK}`}>{Math.round(p.score)}</span>
                  </div>
                  <div className="h-1.5 bg-[#F1F5F9] rounded overflow-hidden mt-0.5">
                    <div className="h-full rounded"
                      style={{ width: `${Math.max(0, Math.min(100, p.score))}%`, backgroundColor: p.score >= 75 ? '#059669' : p.score >= 50 ? '#F88B26' : '#DC2626' }} />
                  </div>
                  <p className={`text-[10px] ${MUTED} mt-0.5`}>{p.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 12. QUICK ACTIONS */}
      <div className={`${CARD} p-5`}>
        <SectionTitle title="Quick actions" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Warehouse compute', icon: Server, go: 'WAREHOUSES' },
            { label: 'Query explorer', icon: Terminal, go: 'QUERIES' },
            { label: 'User attribution', icon: Activity, go: 'USERS' },
            { label: 'Cortex & AI tokens', icon: Cpu, go: 'CORTEX' }
          ].map((a) => (
            <button key={a.label} onClick={() => onNavigate?.(a.go)}
              className="border border-[#E2E8F0] rounded-xl px-4 py-3 text-left hover:border-[#1C58F6] hover:bg-[#F8FAFC] transition-all cursor-pointer group">
              <a.icon className="w-4 h-4 text-[#1C58F6] mb-1.5" />
              <p className={`text-[12px] font-bold ${INK} flex items-center gap-1`}>
                {a.label}<ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
            </button>
          ))}
          <button onClick={exportCsv}
            className="border border-[#E2E8F0] rounded-xl px-4 py-3 text-left hover:border-[#1C58F6] hover:bg-[#F8FAFC] transition-all cursor-pointer">
            <Download className="w-4 h-4 text-[#1C58F6] mb-1.5" />
            <p className={`text-[12px] font-bold ${INK}`}>Download report</p>
          </button>
          <button onClick={() => onRefresh?.()} disabled={isRefreshing}
            className="border border-[#E2E8F0] rounded-xl px-4 py-3 text-left hover:border-[#1C58F6] hover:bg-[#F8FAFC] transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-[#1C58F6] mb-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <p className={`text-[12px] font-bold ${INK}`}>Refresh metrics</p>
          </button>
        </div>
      </div>
    </div>
  );
}
