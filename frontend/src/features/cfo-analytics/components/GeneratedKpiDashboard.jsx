import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, BarChart3, Layers, AlertTriangle, Info } from 'lucide-react';
import { generateKpiDashboard, getKpiDashboard } from '@/api';
import ProjectDashboard from './ProjectDashboard';
import { schemaIdFor } from '../schemaId';

const INK = 'text-[#0F172A]';
const BODY = 'text-[#334155]';
const MUTED = 'text-[#64748B]';
const CARD = 'bg-white border border-[#E2E8F0] rounded-2xl';

const SERIES_COLORS = ['#1C58F6', '#10338D', '#FF3C00', '#F88B26', '#467AFF'];

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

function KpiCard({ kpi }) {
  const value = kpi.data?.[0]?.VALUE;
  return (
    <div className={`${CARD} p-4 space-y-2 hover:border-[#1C58F6]/40 transition-colors`}>
      <p className={`text-[12px] font-semibold ${MUTED} truncate`} title={kpi.label}>{kpi.label}</p>
      <div className={`text-[22px] font-black ${INK} font-mono tracking-tight`}>
        {formatValue(value)}
        {kpi.unit && <span className={`text-[13px] font-bold ${MUTED} ml-0.5`}>{kpi.unit}</span>}
      </div>
      {kpi.description && (
        <p className={`text-[11px] ${MUTED} line-clamp-2 leading-snug`} title={kpi.description}>{kpi.description}</p>
      )}
    </div>
  );
}

function BarPanel({ kpi }) {
  const rows = kpi.data || [];
  const max = Math.max(...rows.map((r) => Number(r.VALUE) || 0), 1);
  return (
    <div className={`${CARD} p-5 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[13px] font-bold ${INK}`}>{kpi.label}</p>
        <span className={`text-[10px] font-mono uppercase ${MUTED} bg-[#F1F5F9] px-1.5 py-0.5 rounded shrink-0`}>
          {kpi.chart_type}
        </span>
      </div>
      <div className="space-y-2">
        {rows.slice(0, 10).map((r, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className={`w-32 text-[11px] ${BODY} truncate shrink-0`} title={String(r.LABEL)}>{r.LABEL}</span>
            <div className="flex-1 h-4 bg-[#F1F5F9] rounded overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${Math.max((Number(r.VALUE) / max) * 100, 1)}%`,
                  backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length]
                }}
              />
            </div>
            <span className={`w-20 text-[11px] font-mono font-semibold ${INK} text-right shrink-0`}>
              {formatValue(r.VALUE)}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className={`text-[12px] ${MUTED}`}>No rows returned.</p>}
      </div>
    </div>
  );
}

function LinePanel({ kpi }) {
  const rows = kpi.data || [];
  const seriesKeys = rows[0] ? Object.keys(rows[0]).filter((k) => k !== 'X') : [];
  const max = Math.max(...rows.flatMap((r) => seriesKeys.map((k) => Number(r[k]) || 0)), 1);
  return (
    <div className={`${CARD} p-5 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[13px] font-bold ${INK}`}>{kpi.label}</p>
        <div className="flex items-center gap-2 shrink-0">
          {seriesKeys.map((k, i) => (
            <span key={k} className={`text-[10px] font-mono ${MUTED} flex items-center gap-1`}>
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-1 h-32 border-b border-l border-[#E2E8F0] pl-1 pb-px">
        {rows.map((r, i) => (
          <div key={i} className="flex-1 flex items-end gap-0.5 h-full" title={String(r.X)}>
            {seriesKeys.map((k, si) => (
              <div
                key={k}
                className="flex-1 rounded-t min-h-[2px]"
                style={{
                  height: `${Math.max((Number(r[k]) / max) * 100, 1)}%`,
                  backgroundColor: SERIES_COLORS[si % SERIES_COLORS.length]
                }}
              />
            ))}
          </div>
        ))}
        {rows.length === 0 && <p className={`text-[12px] ${MUTED} self-center`}>No rows returned.</p>}
      </div>
    </div>
  );
}

function TablePanel({ kpi }) {
  const rows = kpi.data || [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className={`${CARD} p-5 space-y-3`}>
      <p className={`text-[13px] font-bold ${INK}`}>{kpi.label}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E2E8F0]">
              {cols.map((c) => (
                <th key={c} className={`px-2.5 py-2 text-[11px] font-bold ${MUTED} uppercase whitespace-nowrap`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              <tr key={i} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                {cols.map((c) => (
                  <td key={c} className={`px-2.5 py-2 text-[12px] ${BODY} whitespace-nowrap`}>{String(r[c] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className={`text-[12px] ${MUTED}`}>No rows returned.</p>}
    </div>
  );
}

export default function GeneratedKpiDashboard({
  selectedConnection, activeDatabase, activeSchema, semanticModel,
  // Business-user (Quickstart) path: the caller already ran the whole setup and just hands the
  // finished dashboard over. When `dashboard` is given, this component is a pure renderer — it
  // never fetches, never shows the technical "generate/regenerate" controls or the "go to the
  // Analytics View tab" wizard pointer. Passing nothing keeps the original self-fetching
  // behaviour, unchanged, for the Advanced Setup wizard.
  dashboard: dashboardProp, simple = false, projectName,
}) {
  const [dashboard, setDashboard] = useState(dashboardProp || null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const db = activeDatabase || dashboardProp?.database;
  const sch = activeSchema || dashboardProp?.schema;
  const schemaId = db && sch ? schemaIdFor(db, sch, selectedConnection?.id || '') : null;
  const modelReady = semanticModel?.status === 'active';

  // Re-reads the existing KPI views for current values. Cheap: no LLM, no DDL — the backend
  // just executes each materialized V_DASH_KPI_* view and returns fresh rows.
  const load = async () => {
    if (!schemaId) return;
    setLoading(true);
    const res = await getKpiDashboard(schemaId, {
      connectionId: selectedConnection?.id,
      credentials: selectedConnection,
      // Lets the backend fall back to a dashboard stored under the old project-less key.
      database: db, schema: sch
    });
    if (res.status === 'success') {
      setDashboard(res.dashboard);
      setLastRefreshed(new Date());
      setError('');
    } else {
      // Only keep showing the currently-held dashboard when it was actually built for THIS
      // database/schema (a refresh of the same project failing) — otherwise it belongs to a
      // different project (e.g. a previous connection's cached dashboard) and showing it here
      // would silently look like it's the new project's data instead of "nothing generated yet".
      const sameProject = dashboard && dashboard.database === db && dashboard.schema === sch;
      if (sameProject) {
        setError(res.message || 'Could not refresh dashboard values.');
      } else {
        setDashboard(null);
        setError('');
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    // The quickstart hands over the stored definition only (no row data): show it right away
    // as a skeleton, then fetch the live values. Only trust dashboardProp when it was actually
    // built for the current database/schema — a stale prop from a previous project (e.g. the
    // upstream quickstart cache not having regenerated yet) must not be shown as if it belongs here.
    if (dashboardProp) {
      // Quickstart (business-user) path: trust the prop only when it matches the current
      // database/schema; a stale prop for a different project must not render here.
      setDashboard(dashboardProp.database === db && dashboardProp.schema === sch ? dashboardProp : null);
    }
    // When dashboardProp is absent (Advanced Setup's self-fetching mode), leave `dashboard` as-is
    // here — it's populated by load() itself below, same as before this fix.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaId, dashboardProp]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    const res = await generateKpiDashboard({
      connectionId: selectedConnection?.id,
      credentials: selectedConnection,
      modelId: semanticModel?.id,
      database: activeDatabase,
      schema: activeSchema
    });
    if (res.status === 'success') await load();
    else setError(res.message || 'Failed to generate dashboard.');
    setGenerating(false);
  };

  if (!schemaId) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <Layers className="w-9 h-9 text-[#CBD5E1] mx-auto mb-3" />
        <p className={`text-[13px] font-bold ${INK}`}>Select a database and schema first</p>
        <p className={`text-[12px] ${MUTED} mt-1`}>Use the connection bar above to pick your tables and views.</p>
      </div>
    );
  }

  if (!dashboard && loading) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <RefreshCw className="w-8 h-8 text-[#CBD5E1] mx-auto mb-3 animate-spin" />
        <p className={`text-[13px] font-bold ${INK}`}>Loading dashboard…</p>
        <p className={`text-[12px] ${MUTED} mt-1 font-mono`}>{activeDatabase}.{activeSchema}</p>
      </div>
    );
  }

  if (!dashboard && !loading) {
    return (
      <div className="space-y-5 animate-in fade-in duration-300">
        {!modelReady && (
          <div className="flex items-start gap-2.5 border rounded-xl px-4 py-3 bg-[#FFF7ED] border-[#FB923C]/40 text-[#9A3412]">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="text-[13px] font-bold">No active analytics view for {activeDatabase}.{activeSchema}</p>
              <p className="text-[11px] mt-1 text-[#64748b]">
                Go to the <strong>Analytics View</strong> tab, generate one for this schema, and click “Approve &amp; Materialize”.
                Then come back here.
              </p>
            </div>
          </div>
        )}

        <div className={`${CARD} p-10 text-center space-y-3`}>
          <BarChart3 className="w-9 h-9 text-[#CBD5E1] mx-auto" />
          <p className={`text-[14px] font-bold ${INK}`}>No shared dashboard generated yet</p>
          <p className={`text-[12px] ${MUTED} max-w-lg mx-auto leading-relaxed`}>
            This builds one fixed dashboard for <span className="font-mono">{activeDatabase}.{activeSchema}</span> from its semantic
            model — generated once, then seen by everyone who opens this schema.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating || !modelReady}
            className="mx-auto px-4 py-2.5 rounded-xl bg-[#10338D] hover:bg-[#0A225E] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-bold flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
          >
            {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Generate Shared Dashboard</span>
          </button>
          {error && (
            <p className="text-[12px] text-[#9F1239] bg-[#FFF1F2] border border-[#FDA4AF] rounded-lg px-3 py-2 inline-block">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (simple && dashboard) {
    return (
      <ProjectDashboard dashboard={dashboard} projectName={projectName} loading={loading}
        lastRefreshed={lastRefreshed} onRefresh={load} failed={!!error}
        schemaId={schemaId} onChanged={load}
        conn={selectedConnection ? { connectionId: selectedConnection.id, credentials: selectedConnection } : null} />
    );
  }

  const kpis = dashboard?.kpis || [];
  const cards = kpis.filter((k) => k.chart_type === 'kpi_card');
  const panels = kpis.filter((k) => k.chart_type !== 'kpi_card');

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className={`${CARD} px-5 py-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#ECEFFF] border border-[#1C58F6]/25 text-[#1C58F6] flex items-center justify-center">
            <BarChart3 className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className={`text-[15px] font-bold ${INK}`}>Dashboard</h2>
            <p className={`text-[11px] ${MUTED} font-mono`}>
              {dashboard?.database}.{dashboard?.schema} · {kpis.length} KPIs · generated by {dashboard?.generated_by}
              {lastRefreshed && ` · updated ${lastRefreshed.toLocaleTimeString()}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            title="Refresh with the latest numbers"
            className={`px-3.5 py-2 rounded-lg bg-[#10338D] hover:bg-[#0A225E] text-white text-[12px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shadow-sm`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {!simple && (
            <button
              onClick={handleGenerate}
              disabled={generating || !modelReady}
              title="Rebuild the whole KPI set from the analytics view (runs the LLM and replaces the shared dashboard)"
              className={`px-3.5 py-2 rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} text-[12px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 border rounded-xl px-4 py-3 bg-[#FFF1F2] border-[#FDA4AF] text-[#9F1239]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[12px]">{error}</p>
        </div>
      )}

      {dashboard?.data_error && (
        <div className="flex items-start gap-2.5 border rounded-xl px-4 py-3 bg-[#FFF1F2] border-[#FDA4AF] text-[#9F1239]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[12px]">Could not read live values: {dashboard.data_error}</p>
        </div>
      )}

      {dashboard?.rejected_kpis?.length > 0 && (
        <div className="flex items-start gap-2.5 border rounded-xl px-4 py-3 bg-[#FFF7ED] border-[#FB923C]/40 text-[#9A3412]">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[12px]">
            {dashboard.rejected_kpis.length} proposed KPI(s) failed validation against Snowflake and were skipped.
          </p>
        </div>
      )}

      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {cards.map((k) => <KpiCard key={k.kpi_name} kpi={k} />)}
        </div>
      )}

      {panels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {panels.map((k) => {
            if (k.chart_type === 'bar' || k.chart_type === 'donut') return <BarPanel key={k.kpi_name} kpi={k} />;
            if (k.chart_type === 'line') return <LinePanel key={k.kpi_name} kpi={k} />;
            return <TablePanel key={k.kpi_name} kpi={k} />;
          })}
        </div>
      )}
    </div>
  );
}
