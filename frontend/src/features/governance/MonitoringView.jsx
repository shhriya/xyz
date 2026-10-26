import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Cloud,
  Database,
  GitBranch,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Wind,
  Zap
} from 'lucide-react';
import {
  fetchMonitoringDashboard,
  fetchMonitoringSources,
  fetchMonitoringSummary,
  refreshMonitoringSource
} from '@/api';
import { KpiCardGrid, PanelGrid } from './GovernancePanels';
import SourceSyncModal from './SourceSyncModal';
import DbtChatbotModal from './DbtChatbotModal';
import DrilldownExplorer from './DrilldownExplorer';
import SummaryKpiStrip from './SummaryKpiStrip';
import TimeRangeFilter, { readStoredPeriod, storePeriod } from './TimeRangeFilter';

const TAB_ICONS = {
  OVERVIEW: Sparkles,
  PERFORMANCE: BarChart3,
  EXPLORER: GitBranch,
  QUALITY: ShieldCheck,
  FRESHNESS: Database,
  RECOMMENDATIONS: Zap
};
const DEFAULT_TABS = [
  { id: 'OVERVIEW', label: 'Executive Overview' },
  { id: 'PERFORMANCE', label: 'Performance' },
  { id: 'EXPLORER', label: 'Explorer' },
  { id: 'QUALITY', label: 'Quality & Coverage' },
  { id: 'FRESHNESS', label: 'Freshness' },
  { id: 'RECOMMENDATIONS', label: 'Analysis & Recommendations' }
];
const SOURCE_BADGES = {
  dbt: { icon: Layers, color: '#FF6B00' },
  airflow: { icon: Wind, color: '#0D9488' }
};

// Landing view: every connected source is its own card, so connecting several pipelines doesn't
// hide all but one behind a dropdown — click a card to open its dashboard, same pattern as the
// Cost Tracking tab's source grid.
function SourceGrid({ sources, onSelect, onAddNew }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sources.map((s) => {
        const badge = SOURCE_BADGES[s.source_type] || { icon: Activity, color: '#10338D' };
        const Icon = badge.icon;
        return (
          <button
            key={s.source_id}
            onClick={() => onSelect(s.source_id)}
            className="text-left bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-xs hover:shadow-sm hover:border-[#CBD5E1] transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-2xs shrink-0"
                style={{ backgroundColor: `${badge.color}1A`, borderColor: `${badge.color}33` }}
              >
                <Icon className="w-5 h-5" style={{ color: badge.color }} />
              </div>
              <ChevronRight className="w-4 h-4 text-[#CBD5E1] group-hover:text-[#64748B] group-hover:translate-x-0.5 transition-all shrink-0" />
            </div>
            <h3 className="text-sm font-bold text-[#0F172A] mt-3 truncate">{s.display_name}</h3>
            <p className="text-xs text-[#64748B] mt-1 truncate font-mono flex items-center gap-1.5">
              <Database className="w-3 h-3 shrink-0" />
              {s.target_db}{s.target_schema ? `.${s.target_schema}` : ''}
            </p>
            <div className="mt-3 pt-3 border-t border-[#F1F5F9]">
              <span className="text-[11px] font-semibold text-[#94A3B8] truncate block">
                {s.last_synced_at ? `Synced ${s.last_synced_at.replace('T', ' ').substring(0, 16)} UTC` : 'Not synced yet'}
              </span>
            </div>
          </button>
        );
      })}

      <button
        onClick={onAddNew}
        className="text-left bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-2xl p-4 hover:border-[#1C58F6] hover:bg-[#ECEFFF] transition-all cursor-pointer flex flex-col items-center justify-center text-center min-h-[148px]"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#CBD5E1] bg-white mb-2">
          <Plus className="w-5 h-5 text-[#64748B]" />
        </div>
        <span className="text-sm font-bold text-[#0F172A]">Connect Source</span>
        <span className="text-[11px] text-[#64748B] mt-0.5">dbt, Airflow or any supported scheduler</span>
      </button>
    </div>
  );
}

// Session-gated loading is per source: a dashboard only auto-loads if it was synced/refreshed in this browser session.
const sessionKey = (sourceId) => `gov_session_synced:${sourceId}`;
const isSessionSynced = (sourceId) => {
  try { return sessionStorage.getItem(sessionKey(sourceId)) === 'true'; } catch { return false; }
};
const markSessionSynced = (sourceId) => {
  try { sessionStorage.setItem(sessionKey(sourceId), 'true'); sessionStorage.setItem('gov_selected_source', sourceId); } catch {}
};

export default function MonitoringView({
  selectedConnection,
  externalOpenSyncModal = false,
  onCloseExternalSyncModal = () => {},
  projectState,
  setProjectState
}) {
  // Seeded from projectState (not just []) so switching sidebar tabs away and back — which
  // unmounts this component — doesn't flash the "No Sources Connected Yet" empty state for the
  // moment before the async fetch below resolves, even though sources were already loaded before.
  const [sources, setSources] = useState(() => projectState?.governanceSources || []);
  const [sourcesLoading, setSourcesLoading] = useState(() => !(projectState?.governanceSources?.length));
  const [selectedSourceId, setSelectedSourceId] = useState(() => {
    try { return sessionStorage.getItem('gov_selected_source'); } catch { return null; }
  });
  const [dashboards, setDashboards] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('OVERVIEW');
  // Period is owned here so the summary strip, drill-down and regression panel all read one value.
  const [period, setPeriod] = useState(() => readStoredPeriod());
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const selectedSource = sources.find((s) => s.source_id === selectedSourceId) || null;
  const data = selectedSourceId ? dashboards[selectedSourceId] : null;

  const loadSources = async () => {
    const res = await fetchMonitoringSources();
    const list = res?.sources || [];
    setSources(list);
    setSourcesLoading(false);
    if (setProjectState) {
      setProjectState((prev) => ({ ...prev, governanceSources: list }));
    }
    return list;
  };

  const loadDashboard = async (sourceId) => {
    setLoading(true);
    setNotice(null);
    const res = await fetchMonitoringDashboard(sourceId);
    if (res && res.status === 'success') {
      setDashboards((prev) => ({ ...prev, [sourceId]: res }));
    } else {
      setNotice({ status: 'error', message: res?.message || 'Could not load dashboard.' });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSources().then((list) => {
      // Only restore a previously-active source (session continuity) — never auto-pick the first
      // one just because sources exist, so landing on this tab shows the source grid by default.
      if (selectedSourceId && !list.some((s) => s.source_id === selectedSourceId)) {
        setSelectedSourceId(null);
      }
    });
  }, []);

  useEffect(() => {
    // Auto-load when this session already synced the source, OR when the registry records a previous
    // sync — the data is in Snowflake either way. Requiring a Refresh click on every new browser
    // session made a populated dashboard look empty, which read as the feature being broken.
    const syncedBefore = Boolean(selectedSource?.last_synced_at);
    if (selectedSourceId && !dashboards[selectedSourceId] && (isSessionSynced(selectedSourceId) || syncedBefore)) {
      loadDashboard(selectedSourceId);
    }
    setNotice(null);
  }, [selectedSourceId, selectedSource?.last_synced_at]);

  // Summary KPIs are independent of the generated KPI views, so they load for any synced source and
  // re-load whenever the period changes.
  useEffect(() => {
    if (!selectedSourceId) { setSummary(null); return; }
    let cancelled = false;
    (async () => {
      setSummaryLoading(true);
      const res = await fetchMonitoringSummary(selectedSourceId, period);
      if (cancelled) return;
      setSummary(res?.status === 'success' ? res : null);
      setSummaryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedSourceId, period, refreshing]);

  useEffect(() => {
    if (externalOpenSyncModal) setShowSyncModal(true);
  }, [externalOpenSyncModal]);

  const handleRefresh = async () => {
    if (!selectedSourceId) return;
    setRefreshing(true);
    setNotice(null);
    const res = await refreshMonitoringSource(selectedSourceId);
    if (res && res.status === 'success') {
      setDashboards((prev) => ({ ...prev, [selectedSourceId]: res.dashboard }));
      markSessionSynced(selectedSourceId);
      if (res.schema_changed) setNotice({ status: 'warn', message: res.schema_change_hint });
      loadSources();
    } else {
      setNotice({ status: 'error', message: res?.message || 'Refresh failed.' });
    }
    setRefreshing(false);
  };

  const handleSynced = async (res) => {
    setDashboards((prev) => ({ ...prev, [res.source_id]: res.dashboard }));
    markSessionSynced(res.source_id);
    await loadSources();
    setSelectedSourceId(res.source_id);
    setActiveSubTab('OVERVIEW');
  };

  const selectSource = (sourceId) => {
    setSelectedSourceId(sourceId);
    setActiveSubTab('OVERVIEW');
    try { sessionStorage.setItem('gov_selected_source', sourceId); } catch {}
  };

  const backToSources = () => {
    setSelectedSourceId(null);
    try { sessionStorage.removeItem('gov_selected_source'); } catch {}
  };

  const tabs = useMemo(() => {
    const fromLayout = data?.layout?.tabs?.length ? data.layout.tabs : DEFAULT_TABS;
    return fromLayout.map((t) => ({ ...t, icon: TAB_ICONS[t.id] || Activity }));
  }, [data]);

  const panels = data?.panels || [];
  const tabPanels = panels.filter((p) => p.section === activeSubTab);
  const cardPanels = tabPanels.filter((p) => p.chart_type === 'kpi_card');
  const chartPanels = tabPanels.filter((p) => p.chart_type !== 'kpi_card');
  const activeTab = tabs.find((t) => t.id === activeSubTab);

  const badge = SOURCE_BADGES[selectedSource?.source_type] || { icon: Activity, color: '#10338D' };
  const BadgeIcon = badge.icon;
  const busy = loading || refreshing;
  // Tabs whose content comes from the drill-down services rather than the generated KPI views, and
  // so never need the "no dashboard loaded" prompt.
  const ownsTab = activeSubTab === 'EXPLORER';

  if (!selectedSourceId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Your Sources</h2>
            <p className="text-[12px] text-[#64748B] mt-0.5">Pick a connected source to see its dashboard, or connect a new one.</p>
          </div>
        </div>

        {sourcesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 h-[148px] animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-[#F1F5F9]" />
                <div className="h-3.5 w-2/3 bg-[#F1F5F9] rounded mt-4" />
                <div className="h-3 w-1/2 bg-[#F1F5F9] rounded mt-2" />
              </div>
            ))}
          </div>
        ) : sources.length === 0 ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-4 shadow-xs">
            <div className="w-16 h-16 rounded-2xl bg-[#ECEFFF] border border-[#D1DEFF] flex items-center justify-center">
              <Cloud className="w-8 h-8 text-[#10338D]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1E1E1E] mb-1">No Sources Connected Yet</h3>
              <p className="text-xs text-[#666666] max-w-sm leading-relaxed">
                Click <strong>Configure &amp; Sync</strong> to connect a source. New sources are analyzed once by AI to choose their KPIs; afterwards Refresh is a plain data pull.
              </p>
            </div>
            <button
              onClick={() => setShowSyncModal(true)}
              className="px-5 py-2.5 bg-[#10338D] hover:bg-[#1C58F6] text-white rounded-xl font-bold text-xs flex items-center space-x-2 shadow-md transition-all cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
              <span>Configure & Sync</span>
            </button>
          </div>
        ) : (
          <SourceGrid sources={sources} onSelect={selectSource} onAddNew={() => setShowSyncModal(true)} />
        )}

        <SourceSyncModal
          isOpen={showSyncModal}
          onClose={() => { setShowSyncModal(false); onCloseExternalSyncModal(); }}
          onSynced={handleSynced}
          selectedConnection={selectedConnection}
          initialSourceType="dbt"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* ACTIVE SOURCE HEADER & SUB-TAB BAR */}
      {/* ============================================================ */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2 pt-1">
          <div className="flex items-center space-x-2.5 min-w-0">
            <button
              onClick={backToSources}
              className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#64748B] hover:text-[#1C58F6] cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              All Sources
            </button>
            <span className="text-[#E2E8F0] shrink-0">|</span>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-2xs shrink-0" style={{ backgroundColor: `${badge.color}1A`, borderColor: `${badge.color}33` }}>
              <BadgeIcon className="w-4 h-4" style={{ color: badge.color }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-[#1E293B] truncate">{selectedSource?.display_name}</span>
                {selectedSource && (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#ECEFFF] text-[#1C58F6] border border-[#D1DEFF] shrink-0">
                    {selectedSource.target_db}.{selectedSource.target_schema}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#64748B] mt-0.5 truncate">
                {selectedSource?.last_synced_at
                  ? `AI-selected KPIs from Snowflake · last synced ${selectedSource.last_synced_at.replace('T', ' ').substring(0, 16)} UTC`
                  : 'AI-selected KPIs from Snowflake'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <TimeRangeFilter
              period={period}
              onChange={(p) => { setPeriod(p); storePeriod(p); }}
              disabled={busy}
            />
            <button
              onClick={() => setShowSyncModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#CBD5E1] text-[#334155] text-xs font-bold cursor-pointer flex items-center space-x-1.5 transition-all shadow-2xs hover:shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Connect Source</span>
            </button>
            <button
              onClick={handleRefresh}
              disabled={busy}
              className="p-1.5 px-3 rounded-xl bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#CBD5E1] text-[#334155] text-xs font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center space-x-1.5"
              title="Pull fresh data for this source (no AI re-analysis)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin text-[#1C58F6]' : 'text-[#64748B]'}`} />
              <span className="text-[11px]">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation Segmented Bar */}
        <div className="flex items-center space-x-1.5 px-2 pt-2.5 border-t border-[#F1F5F9] overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                title={tab.description || tab.label}
                className={`px-3.5 py-2 text-xs font-bold flex items-center space-x-1.5 cursor-pointer transition-all whitespace-nowrap rounded-xl ${
                  isActive
                    ? 'text-white bg-[#10338D] shadow-sm'
                    : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#94A3B8]'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SummaryKpiStrip summary={summary} loading={summaryLoading} />

      {notice && (
        <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${notice.status === 'warn' ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#D97706]' : 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{notice.message}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* MAIN CONTENT AREA */}
      {/* ============================================================ */}
      <div className="space-y-6">
        {/* The drill-down and regression detection query the GOV_* tables directly rather than the
            AI-generated V_GOV_KPI_* views, so they work for any synced source — including one whose
            generated views are stale or missing. That is also why they render without `data`. */}
        {activeSubTab === 'EXPLORER' && (
          <DrilldownExplorer
            sourceId={selectedSourceId}
            sourceType={selectedSource?.source_type}
            period={period}
          />
        )}

        {/* EXPLORER is wholly owned by the drill-down */}
        {!ownsTab && !data && (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-4 shadow-xs">
            <div className="w-16 h-16 rounded-2xl bg-[#ECEFFF] border border-[#D1DEFF] flex items-center justify-center">
              {busy ? <RefreshCw className="w-8 h-8 text-[#10338D] animate-spin" /> : <Cloud className="w-8 h-8 text-[#10338D]" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1E1E1E] mb-1">
                {busy ? 'Loading Dashboard...' : `No ${selectedSource?.display_name} Data Loaded Yet`}
              </h3>
              <p className="text-xs text-[#666666] max-w-sm leading-relaxed">
                Click <strong>Refresh</strong> to pull the latest data for this source using its saved connection.
              </p>
            </div>
            {!busy && (
              <button
                onClick={handleRefresh}
                className="px-5 py-2.5 bg-[#10338D] hover:bg-[#1C58F6] text-white rounded-xl font-bold text-xs flex items-center space-x-2 shadow-md transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Refresh Dashboard</span>
              </button>
            )}
          </div>
        )}

        {activeSubTab !== 'EXPLORER' && data && (
          tabPanels.length === 0 ? (
            <div className="bg-white border border-dashed border-[#E2E8F0] rounded-xl p-10 text-center">
              <p className="text-xs font-bold text-[#1E1E1E]">No panels for {activeTab?.label || 'this section'}</p>
              <p className="text-[11px] text-[#64748B] mt-1">The KPI analysis did not find metadata in this source that supports this section.</p>
            </div>
          ) : (
            <>
              <KpiCardGrid panels={cardPanels} />
              <PanelGrid panels={chartPanels} />
            </>
          )
        )}
      </div>

      <SourceSyncModal
        isOpen={showSyncModal}
        onClose={() => { setShowSyncModal(false); onCloseExternalSyncModal(); }}
        onSynced={handleSynced}
        selectedConnection={selectedConnection}
        initialSourceType={selectedSource?.source_type || 'dbt'}
      />

      {/* Floating AI Copilot Trigger Bubble */}
      {selectedSource && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => setShowChatModal(true)}
            className="group bg-gradient-to-r from-[#10338D] via-[#1C58F6] to-[#2563EB] text-white p-3.5 sm:px-4 sm:py-3 rounded-full shadow-2xl hover:shadow-indigo-500/50 flex items-center space-x-2.5 transition-all duration-300 transform hover:scale-105 border border-white/30 cursor-pointer"
            title={`Open ${selectedSource.display_name} AI Copilot`}
          >
            <div className="relative">
              <Sparkles className="w-5 h-5 text-[#93C5FD] group-hover:rotate-12 transition-transform" />
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <span className="font-bold text-xs tracking-tight hidden sm:inline">Ask AI Copilot</span>
          </button>
        </div>
      )}

      {selectedSource && (
        <DbtChatbotModal
          isOpen={showChatModal}
          onClose={() => setShowChatModal(false)}
          sourceId={selectedSource.source_id}
          sourceType={selectedSource.source_type}
          displayName={selectedSource.display_name}
          targetDatabase={selectedSource.target_db}
          targetSchema={selectedSource.target_schema}
        />
      )}
    </div>
  );
}
