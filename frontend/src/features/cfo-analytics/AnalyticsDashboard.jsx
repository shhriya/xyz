import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Layers,
  Bookmark,
  Plus,
  Loader2,
  AlertTriangle,
  Settings2,
  ChevronRight,
  ArrowLeft,
  Database,
  Trash2
} from 'lucide-react';
import { fetchSavedConnections, updateSavedConnectionSchema, quickstartDashboard, listSemanticModels, deleteSavedConnection, getKpiDashboard } from '@/api';

import { schemaIdFor } from './schemaId';
import SnowflakeConnectionModal from '@/components/SnowflakeConnectionModal';
import CFOAIAnalyst from './components/CFOAIAnalyst';
import SemanticModelBuilder from './components/SemanticModelBuilder';
import QuickDashboardSetup from './components/QuickDashboardSetup';
import GeneratedKpiDashboard from './components/GeneratedKpiDashboard';

// The stages a business user sees while the backend silently connects, profiles the schema,
// creates the underlying views/agent (if not already done) and builds the dashboard. Purely
// cosmetic labels — they don't track the backend's real step boundaries, they just keep the
// screen from looking frozen during what can be a multi-second call.
const QUICK_STAGES = ['Connecting to your data…', 'Understanding your data…', 'Preparing your dashboard…'];

const titleCase = (s) => String(s || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Landing view: every connected project is its own card, so connecting several databases under
// the same (or different) Snowflake accounts stays visible and selectable instead of being
// collapsed into a single dropdown that only ever shows the last-picked one.
function ProjectGrid({ connections, onSelect, onAddNew, onDelete }) {
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {connections.map((c) => {
        const isConfirming = confirmingId === c.id;
        return (
          <div
            key={c.id}
            onClick={() => !isConfirming && onSelect(c)}
            className="relative text-left bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-xs hover:shadow-sm hover:border-[#CBD5E1] transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#10338D]/20 bg-[#10338D]/10 shrink-0">
                <Bookmark className="w-5 h-5 text-[#10338D]" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmingId(c.id); }}
                  className="p-1.5 rounded-lg text-[#CBD5E1] hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="Delete project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-4 h-4 text-[#CBD5E1] group-hover:text-[#64748B] group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
            <h3 className="text-sm font-bold text-[#0F172A] mt-3 truncate">{titleCase(c.name)}</h3>
            <p className="text-xs text-[#64748B] mt-1 truncate font-mono flex items-center gap-1.5">
              <Database className="w-3 h-3 shrink-0" />
              {c.database ? `${c.database}${c.schema ? `.${c.schema}` : ''}` : 'Not configured yet'}
            </p>
            <div className="mt-3 pt-3 border-t border-[#F1F5F9]">
              <span className="text-[11px] font-semibold text-[#94A3B8] font-mono truncate block">{c.account}</span>
            </div>

            {isConfirming && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 bg-white/97 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center text-center p-4 space-y-3"
              >
                <p className="text-[12.5px] font-bold text-[#0F172A]">Delete "{titleCase(c.name)}"?</p>
                <p className="text-[11px] text-[#64748B]">This only removes it from this app — nothing in Snowflake is touched.</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmingId(null)}
                    className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-[#334155] text-[11.5px] font-bold cursor-pointer hover:bg-[#F8FAFC]"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={deletingId === c.id}
                    onClick={async () => {
                      setDeletingId(c.id);
                      await onDelete(c);
                      setDeletingId(null);
                      setConfirmingId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11.5px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {deletingId === c.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={onAddNew}
        className="text-left bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-2xl p-4 hover:border-[#1C58F6] hover:bg-[#ECEFFF] transition-all cursor-pointer flex flex-col items-center justify-center text-center min-h-[148px]"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#CBD5E1] bg-white mb-2">
          <Plus className="w-5 h-5 text-[#64748B]" />
        </div>
        <span className="text-sm font-bold text-[#0F172A]">New Project</span>
        <span className="text-[11px] text-[#64748B] mt-0.5">Connect another Snowflake database</span>
      </button>
    </div>
  );
}

// Compact header shown once a project is active — switching back to the grid, or between
// projects, doesn't lose the project's own cached dashboard (keyed by connection+database+schema).
/* Shown once a project is connected and has no dashboard yet: how should it be built? Each option
   then runs its own flow, including its own database / schema / tables selection. */
function SetupPathChooser({ onPick }) {
  const OPTIONS = [
    {
      id: 'cortex',
      title: 'Using Snowflake Cortex',
      icon: Layers,
      recommended: true,
      body: 'The AI designs analytics views, creates them in Snowflake, builds a Cortex agent over them, '
        + 'then generates your dashboard. Best answers, and the chat can reason across your data.',
      cta: 'Set up with Cortex',
    },
    {
      id: 'ai',
      title: 'Using AI to create the views',
      icon: Sparkles,
      body: 'The AI reads the tables you pick and writes the dashboard queries directly against them. '
        + 'Fastest way to see numbers; no semantic view or agent is created.',
      cta: 'Create with AI',
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-[#0F172A]">How should we build this dashboard?</h2>
        <p className="text-[12px] text-[#64748B] mt-0.5">
          You pick the database, schema and tables inside whichever option you choose.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {OPTIONS.map((o) => (
          <div key={o.id}
            className={`rounded-2xl p-5 flex flex-col bg-white ${
              o.recommended ? 'border-2 border-[#1C58F6]/30' : 'border border-[#E2E8F0]'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <o.icon className={`w-4 h-4 ${o.recommended ? 'text-[#1C58F6]' : 'text-[#64748B]'}`} />
              <p className="text-[14px] font-bold text-[#0F172A]">{o.title}</p>
              {o.recommended && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#10338D] text-white">
                  Recommended
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#334155] flex-1 leading-relaxed">{o.body}</p>
            <button
              onClick={() => onPick(o.id)}
              className={`mt-4 w-full justify-center px-4 py-2.5 rounded-xl text-[13px] font-bold flex items-center gap-2 cursor-pointer transition-colors ${
                o.recommended
                  ? 'bg-[#10338D] hover:bg-[#0A225E] text-white shadow-sm'
                  : 'bg-white border border-[#CBD5E1] hover:border-[#1C58F6] text-[#334155]'}`}>
              <o.icon className="w-4 h-4" /> <span>{o.cta}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveProjectBar({ project, onSwitchProject, onOpenAdvanced }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onSwitchProject}
          className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#64748B] hover:text-[#1C58F6] cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Projects
        </button>
        <span className="text-[#E2E8F0]">|</span>
        <div className="w-8 h-8 rounded-lg bg-[#10338D]/10 border border-[#10338D]/20 flex items-center justify-center shrink-0">
          <Bookmark className="w-4 h-4 text-[#10338D]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#0F172A] truncate">{titleCase(project?.name)}</p>
          {project?.database && (
            <p className="text-[10px] text-[#64748B] font-mono truncate">
              {project.database}{project.schema ? `.${project.schema}` : ''}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onOpenAdvanced}
        className="text-[11px] font-semibold text-[#64748B] hover:text-[#1C58F6] flex items-center gap-1.5 cursor-pointer px-2 py-1.5 shrink-0"
        title="Choose how this dashboard is built and which tables it uses"
      >
        <Settings2 className="w-3.5 h-3.5" />
        Change setup
      </button>
    </div>
  );
}

function QuickstartProgress({ label }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center">
      <Loader2 className="w-9 h-9 text-[#1C58F6] mx-auto mb-3 animate-spin" />
      <p className="text-[14px] font-bold text-[#0F172A]">{label}</p>
      <p className="text-[12px] text-[#64748B] mt-1">This usually takes a few seconds the first time.</p>
    </div>
  );
}

function QuickstartError({ message, onRetry }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center space-y-3">
      <AlertTriangle className="w-9 h-9 text-amber-500 mx-auto" />
      <p className="text-[14px] font-bold text-[#0F172A]">We couldn't prepare your dashboard</p>
      <p className="text-[12px] text-[#64748B] max-w-md mx-auto leading-relaxed">{message}</p>
      <button
        onClick={onRetry}
        className="mx-auto px-4 py-2 rounded-xl bg-[#10338D] hover:bg-[#0A225E] text-white text-[13px] font-bold cursor-pointer transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

function QuickstartSchemaPicker({ candidates, onPick }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center space-y-4">
      <Layers className="w-9 h-9 text-[#CBD5E1] mx-auto" />
      <p className="text-[14px] font-bold text-[#0F172A]">Which business area should this dashboard cover?</p>
      <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
        {candidates.map((name) => (
          <button
            key={name}
            onClick={() => onPick(name)}
            className="px-3.5 py-2 rounded-xl border border-[#CBD5E1] hover:border-[#1C58F6] hover:bg-[#ECEFFF] text-[#0F172A] text-[12.5px] font-semibold cursor-pointer transition-colors"
          >
            {name.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsDashboard({ projectState, setProjectState }) {
  // Dedicated Analytics Snowflake credentials (Account 1) - isolated from Costing
  const initialAnalyticsCreds = (() => {
    if (projectState?.analyticsConnection && projectState?.analyticsConnection?.account) {
      return projectState.analyticsConnection;
    }
    try {
      const stored = localStorage.getItem('agy_analytics_credentials');
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  })();

  // Seeded from projectState (not just []) so switching sidebar tabs away and back — which
  // unmounts this component — doesn't flash an empty/near-empty project grid for the moment
  // before the async fetch below resolves, even though projects were already loaded before.
  const [connections, setConnections] = useState(() => projectState?.analyticsConnections || []);
  const [connectionsLoading, setConnectionsLoading] = useState(() => !(projectState?.analyticsConnections?.length));
  const [selectedConnection, setSelectedConnection] = useState(initialAnalyticsCreds || null);
  const [activeDatabase, setActiveDatabase] = useState(initialAnalyticsCreds?.database || '');
  const [activeSchema, setActiveSchema] = useState(initialAnalyticsCreds?.schema || '');

  // Only two tabs: generate the semantic model, then view the dashboard generated from it.

  // Business-user default: no login/roles in this app (by design), so this is a UI mode, not
  // access control — the full wizard below is still one click away via "Advanced setup" for
  // whoever wants to see/edit the connection, semantic views or the Cortex agent by hand.
  // What the open project shows: resolving saved state → the setup page → the dashboard.
  const [projectView, setProjectView] = useState('checking'); // 'checking' | 'setup' | 'dashboard'
  // Lifted into projectState (see persistence effect below) so a full quickstart regeneration —
  // schema profiling, view/agent creation, dashboard build — only ever happens when the user picks
  // a new connection or explicitly asks for a rebuild, never just from navigating away and back.
  // Local useState alone would lose this on every unmount, which is exactly the bug being fixed:
  // this component remounts fresh every time the Sidebar nav switches away and back.
  const [quickstart, setQuickstart] = useState(() => {
    const cached = projectState?.analyticsQuickstart;
    return cached && cached.dashboard
      ? cached
      : { stage: 'idle', dashboard: null, message: '', candidates: [], connectionId: null };
  });
  const [quickstartStageIdx, setQuickstartStageIdx] = useState(0);
  // Multiple projects' ready dashboards at once, keyed by connection+database+schema — `quickstart`
  // above is just "whichever one is on screen right now". Without this, switching A -> B -> A made
  // A fall out of the single-slot cache and re-hit the backend (cheaply, since that endpoint is
  // idempotent — but still a network round trip) every time you came back to it.
  const [quickstartCache, setQuickstartCache] = useState(() => projectState?.analyticsQuickstartCache || {});
  const cacheKeyFor = (conn, db, sch) =>
    `${conn?.id || ''}::${db || conn?.database || ''}::${sch || conn?.schema || ''}`;

  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [isNewConnModalOpen, setIsNewConnModalOpen] = useState(false);
  const [modalInitialCreds, setModalInitialCreds] = useState(null);
  const [activeSemanticModel, setActiveSemanticModel] = useState(null);

  // Track the active (materialized) semantic model for the current connection/schema, so the
  // Semantic Model and Shared Dashboard tabs — and the AI Analyst's persona — know what to build from.
  const loadActiveSemanticModel = async () => {
    const creds = selectedConnection || initialAnalyticsCreds;
    if (!creds || !activeDatabase || !activeSchema) {
      setActiveSemanticModel(null);
      return;
    }
    const res = await listSemanticModels(creds.id || creds.account);
    const match = (res?.models || []).find(
      (m) => m.status === 'active' && m.database === activeDatabase && m.schema === activeSchema
    );
    setActiveSemanticModel(match || null);

    // Re-read saved connections so the cached copy picks up cortexRole/cortexSemanticModel
    // written by the agent step, instead of holding the previous project's values. Scoped to
    // 'analytics' like every other lookup in this file — without that filter, the account-string
    // fallback below could match a same-account connection saved under a different scope (e.g.
    // Cost Tracking) and merge its warehouse/role/cortex settings into this one.
    const connRes = await fetchSavedConnections();
    const scopedConns = (connRes?.connections || []).filter((c) => !c.scope || c.scope === 'analytics');
    const fresh = creds.id
      ? scopedConns.find((c) => c.id === creds.id)
      : scopedConns.find((c) => c.account === creds.account && (c.name || '').toLowerCase() === (creds.name || '').toLowerCase());
    if (fresh) {
      setSelectedConnection((prev) => {
        if (!prev || prev.id !== fresh.id) return prev;
        // Only update cortex attributes from fresh; preserve project's own database, schema, and name
        const merged = {
          ...prev,
          cortexRole: fresh.cortexRole || prev.cortexRole,
          cortexSemanticModel: fresh.cortexSemanticModel || prev.cortexSemanticModel,
          domain: fresh.domain || prev.domain,
        };
        const unchanged = prev.cortexRole === merged.cortexRole
          && prev.cortexSemanticModel === merged.cortexSemanticModel
          && prev.domain === merged.domain;
        return unchanged ? prev : merged;
      });
    }
  };

  useEffect(() => {
    loadActiveSemanticModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnection, activeDatabase, activeSchema]);

  // Fetch saved connections on mount
  useEffect(() => {
    async function loadConns() {
      const res = await fetchSavedConnections();
      // Filter to only show connections scoped to 'analytics' (or unscoped legacy ones)
      let connsList = (res && res.connections)
        ? res.connections.filter(c => !c.scope || c.scope === 'analytics')
        : [];
      if (initialAnalyticsCreds && initialAnalyticsCreds.account && !connsList.some(c => c.account === initialAnalyticsCreds.account)) {
        connsList.unshift({
          id: 'conn_analytics_active',
          name: initialAnalyticsCreds.name || `Analytics (${initialAnalyticsCreds.account})`,
          ...initialAnalyticsCreds
        });
      }
      setConnections(connsList);
      setConnectionsLoading(false);
      if (setProjectState) {
        setProjectState((prev) => ({ ...prev, analyticsConnections: connsList }));
      }
      // Only auto-select when a project was already active last time (continuity across reloads
      // and tab switches) — otherwise land on the project grid instead of silently picking one,
      // so connecting several projects doesn't hide all but the last one behind a single dropdown.
      // Matches on database too, not just account: several projects can share one Snowflake
      // account with different databases, and matching on account alone would always resolve to
      // whichever of them happens to come first in the list.
      if (initialAnalyticsCreds) {
        // The cached copy (localStorage / projectState) exists only so the bar paints instantly on
        // remount. The saved record is the authority for a project's name and scope, so resolve by
        // id and adopt the record wholesale.
        //
        // The cache must never be rendered as-is. It is a snapshot merged field-by-field over time
        // ({...selectedConnection, database}), so it can hold one project's name beside another
        // project's database — which showed "Test2 / HEALTHCARE_ANALYTICS_DB.GOLD" and then asked
        // the backend for Test2's dashboard inside Healthcare's database, got a correct refusal,
        // and sent the user back through setup for a dashboard that existed all along.
        const match = initialAnalyticsCreds.id
          ? connsList.find(c => c.id === initialAnalyticsCreds.id)
          : connsList.find(c =>
              c.account === initialAnalyticsCreds.account &&
              (c.name || '').toLowerCase() === (initialAnalyticsCreds.name || '').toLowerCase()
            );
        if (match) {
          const active = { ...match };
          active.database = match.database || '';
          active.schema = match.schema || '';
          // Secrets are the one thing the cache may legitimately hold and the record may not, so
          // only fall back to the cache where the record is actually missing a value.
          for (const key of ['password', 'privateKey', 'privateKeyPassphrase', 'token', 'passcode']) {
            if (!active[key] && initialAnalyticsCreds[key]) active[key] = initialAnalyticsCreds[key];
          }
          setSelectedConnection(active);
          setActiveDatabase(active.database);
          setActiveSchema(active.schema);
        } else {
          // The cached project no longer exists (deleted, or a stale pre-id entry). Land on the
          // grid rather than rendering a project that cannot be verified.
          setSelectedConnection(null);
          setActiveDatabase('');
          setActiveSchema('');
          try { localStorage.removeItem('agy_analytics_credentials'); } catch {}
          if (setProjectState) {
            setProjectState((prev) => ({ ...prev, analyticsConnection: null }));
          }
        }
      }
    }
    loadConns();
  }, []);


  // Back to the project grid. Only clears which project is active — each project's own cached
  // quickstart/dashboard state (keyed by connection+database+schema) is untouched, so picking the
  // same project again shows it instantly instead of regenerating.
  const handleSwitchProject = () => {
    setSelectedConnection(null);
    // Clear the active scope too. These are read as a fallback when a project record carries no
    // database of its own, so leaving one project's values behind made the next project resolve to
    // the previous project's schema — and therefore show its dashboard.
    setActiveDatabase('');
    setActiveSchema('');
    try { localStorage.removeItem('agy_analytics_credentials'); } catch {}
    if (setProjectState) {
      setProjectState(prev => ({ ...prev, analyticsConnection: null }));
    }
  };

  const handleSelectConnection = (conn) => {
    setSelectedConnection(conn);
    // Set unconditionally, including to empty. Only assigning when the project had a value meant a
    // project with no database kept the previously-opened project's, which then resolved to that
    // project's dashboard.
    setActiveDatabase(conn.database || '');
    setActiveSchema(conn.schema || '');
    try {
      localStorage.setItem('agy_analytics_credentials', JSON.stringify(conn));
    } catch {}
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        analyticsConnection: conn
      }));
    }
  };

  /**
   * Records a project's new database/schema everywhere this tab holds it.
   *
   * The project list is fetched once on mount, so without this the entry for the project being
   * configured keeps the empty database it was created with. Reopening it from the grid then hands
   * the view resolver an empty scope and it shows the setup chooser again — even though the
   * dashboard was built and is sitting in the backend.
   */
  const applyProjectScope = (updated) => {
    setSelectedConnection(updated);
    setConnections((prev) => prev.map((c) => (
      c.id === updated.id ? { ...c, database: updated.database || '', schema: updated.schema || '' } : c
    )));
    try {
      localStorage.setItem('agy_analytics_credentials', JSON.stringify(updated));
    } catch {}
    if (setProjectState) {
      setProjectState((prev) => ({
        ...prev,
        analyticsConnection: updated,
        // Seeds `connections` when this tab is remounted, so a tab switch doesn't bring the stale
        // scope back.
        analyticsConnections: (prev?.analyticsConnections || []).map((c) => (
          c.id === updated.id ? { ...c, database: updated.database || '', schema: updated.schema || '' } : c
        )),
      }));
    }
  };

  const handleDatabaseChange = (newDb) => {
    setActiveDatabase(newDb);
    const updated = { ...(selectedConnection || {}), database: newDb };
    applyProjectScope(updated);
    updateSavedConnectionSchema({
      // id, not account: several projects can share one Snowflake login, and resolving by account
      // wrote this database onto whichever of them came first.
      id: updated.id,
      account: updated.account,
      database: newDb,
      schema: activeSchema,
      scope: 'analytics'
    });
  };

  const handleSchemaChange = (newSch) => {
    setActiveSchema(newSch);
    const updated = { ...(selectedConnection || {}), schema: newSch };
    applyProjectScope(updated);
    updateSavedConnectionSchema({
      id: updated.id,
      account: updated.account,
      database: activeDatabase,
      schema: newSch,
      scope: 'analytics'
    });
  };

  // Removes a saved connection (a "project") from this app. Does not touch anything already
  // materialized in Snowflake itself — just this app's own record of it and its cached dashboard.
  const handleDeleteProject = async (conn) => {
    const res = await deleteSavedConnection(conn.id);
    if (res.status !== 'success') return;
    setConnections((prev) => prev.filter((c) => c.id !== conn.id));
    if (selectedConnection?.id === conn.id) {
      handleSwitchProject();
    }
    const key = cacheKeyFor(conn, conn.database, conn.schema);
    setQuickstartCache((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (setProjectState) {
      setProjectState((prev) => {
        const next = { ...prev };
        if (prev?.analyticsQuickstart?.connectionId === conn.id) {
          next.analyticsQuickstart = null;
        }
        if (prev?.analyticsQuickstartCache) {
          const nextCache = { ...prev.analyticsQuickstartCache };
          delete nextCache[key];
          next.analyticsQuickstartCache = nextCache;
        }
        return next;
      });
    }
  };

  // Runs the whole setup — schema pick, semantic model, views, agent, dashboard — behind one call.
  // Everything here reuses the exact backend functions the Advanced wizard's individual steps call
  // (see backend/app/modules/cfo_analytics/router.py: /dashboard/quickstart); this just sequences
  // them and shows a business-friendly staged spinner while it's running.
  const runQuickstart = async (conn, schemaOverride) => {
    const source = conn || selectedConnection;
    if (!source) return;
    setQuickstart({ stage: 'running', dashboard: null, message: '', candidates: [] });
    setQuickstartStageIdx(0);
    const ticker = setInterval(() => {
      setQuickstartStageIdx((i) => Math.min(i + 1, QUICK_STAGES.length - 1));
    }, 1400);
    try {
      const res = await quickstartDashboard({
        connectionId: source.id,
        credentials: source,
        database: source.database || activeDatabase,
        schema: schemaOverride || source.schema || activeSchema,
      });
      if (res.status === 'success') {
        if (res.database && res.database !== activeDatabase) setActiveDatabase(res.database);
        if (res.schema && res.schema !== activeSchema) setActiveSchema(res.schema);
        const readyDatabase = res.database || source.database || activeDatabase;
        const readySchema = res.schema || schemaOverride || source.schema || activeSchema;
        const ready = {
          stage: 'ready', dashboard: res.dashboard, message: '', candidates: [],
          connectionId: source.id, database: readyDatabase, schema: readySchema,
        };
        setQuickstart(ready);
        const key = cacheKeyFor(source, readyDatabase, readySchema);
        setQuickstartCache((prev) => ({ ...prev, [key]: ready }));
        if (setProjectState) {
          setProjectState((prev) => ({
            ...prev,
            analyticsQuickstart: ready,
            analyticsQuickstartCache: { ...(prev?.analyticsQuickstartCache || {}), [key]: ready },
          }));
        }
      } else if (res.status === 'needs_schema') {
        setQuickstart({ stage: 'needs_schema', dashboard: null, message: '', candidates: res.candidates || [] });
      } else {
        setQuickstart({
          stage: 'error', dashboard: null, candidates: [],
          message: res.message || 'Something went wrong preparing your dashboard. Please try again.',
        });
      }
    } catch {
      setQuickstart({ stage: 'error', dashboard: null, candidates: [], message: 'Could not reach the server. Please try again.' });
    } finally {
      clearInterval(ticker);
    }
  };

  // Opening a project never builds anything on its own. It asks the backend whether this project
  // already has a saved dashboard: if it does we show it (that is what makes a dashboard survive
  // closing the browser), and if it does not we show the setup page so the user chooses how to
  // build it. Nothing is generated until they pick a path.
  //
  // This runs when the PROJECT changes, deliberately not when its database or schema change.
  // Picking those is a step *inside* the setup flow, and handleDatabaseChange writes them onto
  // selectedConnection — so depending on them made choosing a database re-resolve the view and
  // throw the user back to the path chooser mid-setup, with a "checking" spinner on the way.
  // Only the quick/setup views expose those pickers, so nothing else needs the re-resolve.
  useEffect(() => {
    let cancelled = false;
    async function resolveProjectView() {
      if (!selectedConnection) return;
      const db = selectedConnection.database || '';
      const sch = selectedConnection.schema || '';

      // Without a scope there is nothing to look up — ask how they want to build it.
      if (!db || !sch) { setProjectView('choose'); return; }

      const key = cacheKeyFor(selectedConnection, db, sch);
      if (quickstartCache[key]?.dashboard) {
        setQuickstart(quickstartCache[key]);
        setProjectView('dashboard');
        return;
      }

      setProjectView('checking');
      const res = await getKpiDashboard(schemaIdFor(db, sch, selectedConnection.id), {
        connectionId: selectedConnection.id, credentials: selectedConnection,
        database: db, schema: sch
      });
      if (cancelled) return;

      if (res?.status === 'success' && res.dashboard?.kpis?.length) {
        const ready = { stage: 'ready', dashboard: res.dashboard };
        setQuickstart(ready);
        setQuickstartCache((prev) => ({ ...prev, [key]: ready }));
        setProjectView('dashboard');
      } else {
        setProjectView('choose');
      }
    }
    resolveProjectView();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnection?.id, selectedConnection?.database, selectedConnection?.schema]);

  const handleConnectionAdded = (newConn) => {
    setConnections(prev => [newConn, ...prev.filter(c => c.id !== newConn.id)]);
    handleSelectConnection(newConn);
  };

  // Minimal context object for the AI Analyst chat — no dependency on the old hardcoded telemetry fetch.
  const aiContext = { domain: activeSemanticModel?.name, database: activeDatabase, schema: activeSchema };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-16 relative">
      {/* 1. HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#10338D] via-[#0D266B] to-[#071339] rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-[#1C58F6]/30">
        <div>
          <div className="flex items-center space-x-2 text-[#ECEFFF] text-lg font-bold uppercase tracking-wider mb-1.5">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <span>Analytics Dashboard</span>
          </div>
          <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
          
          </h1>
        </div>

      </div>

      {(
        !selectedConnection ? (
          <>
            {/* 2. PROJECT GRID — every connected project is its own card, so connecting several
                databases doesn't hide all but the last one behind a single dropdown. */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">Your Projects</h2>
                <p className="text-[12px] text-[#64748B] mt-0.5">Pick a project to see its dashboard, or create a new one.</p>
              </div>
            </div>
            {connectionsLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 h-[148px] animate-pulse">
                    <div className="w-10 h-10 rounded-xl bg-[#F1F5F9]" />
                    <div className="h-3.5 w-2/3 bg-[#F1F5F9] rounded mt-4" />
                    <div className="h-3 w-1/2 bg-[#F1F5F9] rounded mt-2" />
                  </div>
                ))}
              </div>
            ) : (
              <ProjectGrid
                connections={connections}
                onSelect={handleSelectConnection}
                onDelete={handleDeleteProject}
                onAddNew={() => {
                  setModalInitialCreds(null);
                  setIsNewConnModalOpen(true);
                }}
              />
            )}
          </>
        ) : (
          <>
            {/* 2. ACTIVE PROJECT BAR — compact, with a way back to the full project grid */}
            <ActiveProjectBar
              project={selectedConnection}
              onSwitchProject={handleSwitchProject}
              onOpenAdvanced={() => setProjectView('choose')}
            />

            {/* 3. Setup page until this project has a dashboard; the dashboard once it does. */}
            {projectView === 'checking' ? (
              <QuickstartProgress label="Opening your project…" />
            ) : projectView === 'choose' ? (
              <SetupPathChooser
                onPick={(path) => setProjectView(path === 'cortex' ? 'setup' : 'quick')}
              />
            ) : projectView === 'quick' ? (
              <QuickDashboardSetup
                selectedConnection={selectedConnection}
                activeDatabase={activeDatabase}
                activeSchema={activeSchema}
                onDatabaseChange={handleDatabaseChange}
                onSchemaChange={handleSchemaChange}
                onModelChanged={loadActiveSemanticModel}
                onBack={() => setProjectView('choose')}
                onGoToDashboard={() => { setQuickstart({ stage: 'idle' }); setProjectView('dashboard'); }}
              />
            ) : projectView === 'setup' ? (
              <SemanticModelBuilder
                selectedConnection={selectedConnection}
                activeDatabase={activeDatabase}
                activeSchema={activeSchema}
                onDatabaseChange={handleDatabaseChange}
                onSchemaChange={handleSchemaChange}
                onModelChanged={loadActiveSemanticModel}
                onGoToDashboard={() => { setQuickstart({ stage: 'idle' }); setProjectView('dashboard'); }}
              />
            ) : quickstart.stage === 'running' ? (
              <QuickstartProgress label={QUICK_STAGES[quickstartStageIdx]} />
            ) : quickstart.stage === 'needs_schema' ? (
              <QuickstartSchemaPicker
                candidates={quickstart.candidates}
                onPick={(name) => runQuickstart(selectedConnection, name)}
              />
            ) : quickstart.stage === 'error' ? (
              <QuickstartError message={quickstart.message} onRetry={() => runQuickstart(selectedConnection)} />
            ) : (
              <>
                {/* Explicit, user-triggered full rebuild (re-profiles schema, rebuilds views/agent/
                    dashboard from scratch) — separate from GeneratedKpiDashboard's own "Refresh"
                    button below, which only re-queries current KPI values for the existing dashboard. */}
                <div className="flex justify-end -mb-2">
                  <button
                    onClick={() => setProjectView('choose')}
                    className="text-[11px] font-semibold text-[#64748B] hover:text-[#1C58F6] cursor-pointer px-2 py-1"
                    title="Choose the tables and how this dashboard is built"
                  >
                    Change setup
                  </button>
                </div>
                <GeneratedKpiDashboard
                  simple
                  projectName={titleCase(selectedConnection?.name)}
                  dashboard={quickstart.dashboard}
                  selectedConnection={selectedConnection}
                  activeDatabase={activeDatabase}
                  activeSchema={activeSchema}
                  semanticModel={activeSemanticModel}
                />
              </>
            )}
          </>
        )
      )}

      {/* 5. FLOATING AI DATA ANALYST ASSISTANT */}
      <CFOAIAnalyst
        dashboardData={aiContext}
        selectedConnection={selectedConnection}
        isOpen={isAiDrawerOpen}
        onOpen={() => setIsAiDrawerOpen(true)}
        onClose={() => setIsAiDrawerOpen(false)}
      />

      {/* 6. NEW SNOWFLAKE CONNECTION CREATION / EDIT MODAL */}
      <SnowflakeConnectionModal
        isOpen={isNewConnModalOpen}
        onClose={() => setIsNewConnModalOpen(false)}
        onConnectionAdded={handleConnectionAdded}
        initialCredentials={modalInitialCreds}
        scope="analytics"
      />
    </div>
  );
}
