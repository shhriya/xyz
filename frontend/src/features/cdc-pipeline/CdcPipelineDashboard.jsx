import React, { useEffect, useRef, useState } from 'react';
import {
  Zap,
  Database,
  ArrowRight,
  Plug,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Play,
  RotateCcw,
  Info,
} from 'lucide-react';
import {
  testCdcSource,
  connectCdcTarget,
  analyzeCdcTables,
  saveCdcConfig,
  getCdcConfig,
  runCdcPipeline,
  getCdcStatus,
  getCdcHistory,
  resetCdcCheckpoints,
  getCdcConnectors,
} from '@/api';
import { CdcRunProgress, CdcRunHistory } from './CdcRunProgress';
import { APPROACH_LABELS } from './approaches';
import ConnectionForm from './ConnectionForm';
import { defaultsFor, isComplete } from './connectionUtils';

const APPROACH_STYLE = {
  INCREMENTAL: 'bg-blue-50 text-[#1C58F6] border-blue-200',
  FULL_REFRESH: 'bg-violet-50 text-violet-700 border-violet-200',
  SCD_TYPE_2: 'bg-amber-50 text-amber-700 border-amber-200',
  SKIP: 'bg-slate-50 text-slate-500 border-slate-200',
};

const INPUT = 'w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15';

function StatusLine({ state }) {
  if (!state) return null;
  if (state.loading) {
    return <span className="text-[12px] text-[#64748B] flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</span>;
  }
  return state.ok ? (
    <span className="text-[12px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> {state.message}</span>
  ) : (
    <span className="text-[12px] text-rose-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {state.message}</span>
  );
}

function Card({ title, icon: Icon, step, children, right }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#10338D] text-white text-[11px] flex items-center justify-center">{step}</span>
          <Icon className="w-4 h-4 text-[#10338D]" />
          {title}
        </h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function CdcPipelineDashboard() {
  const [pipelineId, setPipelineId] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [connectorsError, setConnectorsError] = useState('');
  const [source, setSource] = useState({ type: 'postgresql' });
  const [target, setTarget] = useState({ type: 'snowflake' });
  const [sourceTest, setSourceTest] = useState(null);
  const [targetTest, setTargetTest] = useState(null);

  const [schedule, setSchedule] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);

  const [tables, setTables] = useState([]);
  const [summary, setSummary] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [checkpoints, setCheckpoints] = useState({});

  const [run, setRun] = useState(null);
  const [runError, setRunError] = useState('');
  const [history, setHistory] = useState([]);
  const pollRef = useRef(null);

  const refreshHistory = async (id) => {
    if (!id) return;
    const res = await getCdcHistory(id);
    if (res.status === 'success') {
      setHistory(res.runs || []);
      setCheckpoints(res.checkpoints || {});
    }
  };

  const pollStatus = (id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await getCdcStatus(id);
      if (res.status !== 'success' || !res.run) return;
      setRun(res.run);
      if (res.run.status !== 'running') {
        clearInterval(pollRef.current);
        refreshHistory(id);
      }
    }, 1500);
  };

  // Load the database registry, then the saved pipeline (secrets never come back — the backend
  // reuses the stored ones when a secret field is left blank).
  useEffect(() => {
    (async () => {
      const conRes = await getCdcConnectors();
      const list = conRes?.connectors || [];
      setConnectors(list);
      if (!list.length) {
        setConnectorsError(conRes?.message || 'The server returned no databases.');
      }
      const byType = (t) => list.find((c) => c.type === t);
      const res = await getCdcConfig();
      const p = res?.pipeline;
      if (!p) {
        if (byType('postgresql')) setSource(defaultsFor(byType('postgresql')));
        if (byType('snowflake')) setTarget(defaultsFor(byType('snowflake')));
        return;
      }
      setPipelineId(p.id);
      const tType = p.target?.type || 'snowflake';
      setSource({ ...(byType(p.source?.type) ? defaultsFor(byType(p.source.type)) : {}), ...p.source });
      setTarget({ ...(byType(tType) ? defaultsFor(byType(tType)) : {}), ...p.target, type: tType });
      setSchedule(p.schedule || '');
      setScheduleEnabled(p.scheduleEnabled || false);
      setTables(p.tables || []);
      setCheckpoints(res.checkpoints || {});
      refreshHistory(p.id);
      const st = await getCdcStatus(p.id);
      if (st?.run) {
        setRun(st.run);
        if (st.run.status === 'running') pollStatus(p.id);
      }
    })();
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestSource = async () => {
    setSourceTest({ loading: true });
    const res = await testCdcSource(source, pipelineId);
    setSourceTest({ ok: res.status === 'success', message: res.message });
  };

  const handleTestTarget = async () => {
    setTargetTest({ loading: true });
    const res = await connectCdcTarget(target, pipelineId);
    setTargetTest({ ok: res.status === 'success', message: res.message });
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError('');
    const res = await analyzeCdcTables(source, pipelineId, [], target);
    if (res.status === 'success') {
      setTables(res.tables || []);
      setSummary(res.summary || '');
    } else {
      setAnalyzeError(res.message || 'Analysis failed.');
    }
    setAnalyzing(false);
  };

  const setTable = (name, patch) => {
    setTables((ts) => ts.map((t) => (t.table === name ? { ...t, ...patch } : t)));
  };

  const saveConfig = async () => {
    const res = await saveCdcConfig({ id: pipelineId, source, target, tables, schedule, scheduleEnabled });
    if (res.status !== 'success') throw new Error(res.message || 'Could not save the pipeline.');
    setPipelineId(res.pipeline.id);
    setSource((s) => ({ ...s, savedSecrets: res.pipeline.source?.savedSecrets || [] }));
    setTarget((t) => ({ ...t, savedSecrets: res.pipeline.target?.savedSecrets || [] }));
    return res.pipeline.id;
  };

  const handleRun = async () => {
    setRunError('');
    try {
      const id = await saveConfig();
      const res = await runCdcPipeline(id);
      if (res.status !== 'success') throw new Error(res.message);
      setRun(res.run);
      pollStatus(id);
    } catch (e) {
      setRunError(e.message);
    }
  };

  const handleResetTable = async (table) => {
    if (!pipelineId) return;
    await resetCdcCheckpoints(pipelineId, table);
    refreshHistory(pipelineId);
  };

  const running = run?.status === 'running';
  const activeCount = tables.filter((t) => t.approach !== 'SKIP').length;
  const sourceConnector = connectors.find((c) => c.type === source.type);
  const targetConnector = connectors.find((c) => c.type === target.type);
  const canAnalyze = isComplete(source, sourceConnector);
  const targetReady = isComplete(target, targetConnector);

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-16">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#10338D] via-[#0D266B] to-[#071339] rounded-2xl p-6 text-white shadow-xl border border-[#1C58F6]/30">
        <div className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider">
          <Zap className="w-5 h-5 text-[#FF3C00]" />
          <span>CDC Pipeline</span>
        </div>
        <p className="text-[13px] text-[#ECEFFF]/80 mt-1 max-w-3xl">
          Move data between any two databases — PostgreSQL, MySQL, Oracle, SQL Server, Snowflake, Redshift, BigQuery, Databricks and more. AI recommends how to load each table, and every run
          only picks up rows that are new or changed since the last one.
        </p>
      </div>

      {connectorsError && (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[12.5px] text-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Couldn't load the list of databases ({connectorsError}). The backend is probably running an older
            version — restart it and refresh this page.
          </span>
        </div>
      )}

      {/* 1. Connections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card step={1} title={`Source — ${sourceConnector?.label || 'choose a database'}`} icon={Database}>
          <ConnectionForm connectors={connectors} value={source} disabled={running}
            onChange={(v) => { setSource(v); setSourceTest(null); }} />
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleTestSource} disabled={!canAnalyze || sourceTest?.loading}
              className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] hover:border-[#1C58F6] text-[12px] font-semibold text-[#10338D] flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Plug className="w-3.5 h-3.5" /> Test Connection
            </button>
            <StatusLine state={sourceTest} />
          </div>
        </Card>

        <Card step={2} title={`Target — ${targetConnector?.label || 'choose a database'}`} icon={ArrowRight}>
          <ConnectionForm connectors={connectors} value={target} disabled={running}
            onChange={(v) => { setTarget(v); setTargetTest(null); }} />
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleTestTarget} disabled={!targetReady || targetTest?.loading}
              className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] hover:border-[#1C58F6] text-[12px] font-semibold text-[#10338D] flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Plug className="w-3.5 h-3.5" /> Test Connection
            </button>
            <StatusLine state={targetTest} />
          </div>
        </Card>
      </div>

      {/* 2. AI analysis */}
      <Card
        step={3}
        title="Tables & Load Approach"
        icon={Sparkles}
        right={
          <button onClick={handleAnalyze} disabled={!canAnalyze || analyzing || running}
            className="px-3.5 py-2 rounded-lg bg-[#10338D] hover:bg-[#1C58F6] text-white text-[12px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {analyzing ? 'Analyzing…' : tables.length ? 'Re-analyze with AI' : 'Analyze Tables with AI'}
          </button>
        }
      >
        {analyzeError && (
          <p className="mb-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{analyzeError}</p>
        )}
        {tables.length === 0 ? (
          <p className="text-[12.5px] text-[#64748B]">
            Fill in the source database above, then let the AI look at every table and recommend how to load it.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase text-[#64748B]">
                    <th className="py-2 pr-3">Table</th>
                    <th className="py-2 pr-3">Rows</th>
                    <th className="py-2 pr-3">Approach</th>
                    <th className="py-2 pr-3">Tracking column</th>
                    <th className="py-2 pr-3">Why</th>
                    <th className="py-2">Last loaded</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => {
                    const ckpt = checkpoints[t.table];
                    const needsTracking = t.approach === 'INCREMENTAL' || t.approach === 'SCD_TYPE_2';
                    const overridden = t.aiApproach && t.aiApproach !== t.approach;
                    return (
                      <tr key={t.table} className="border-b border-[#F1F5F9] last:border-0 align-top">
                        <td className="py-2.5 pr-3 text-[12.5px] font-semibold font-mono text-[#0F172A]">
                          {t.table}
                          {!(t.primaryKey || []).length && <span className="block text-[10.5px] font-sans font-normal text-[#94A3B8]">no primary key</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-[12px] text-[#475569] font-mono">{t.rows != null ? Number(t.rows).toLocaleString() : '—'}</td>
                        <td className="py-2.5 pr-3">
                          <select
                            value={t.approach}
                            disabled={running}
                            onChange={(e) => setTable(t.table, { approach: e.target.value })}
                            className={`text-[12px] font-semibold border rounded-lg px-2 py-1 cursor-pointer ${APPROACH_STYLE[t.approach]}`}
                          >
                            {Object.entries(APPROACH_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                          </select>
                          {overridden && <span className="block text-[10.5px] text-[#94A3B8] mt-0.5">AI suggested {APPROACH_LABELS[t.aiApproach]}</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {needsTracking ? (
                            <select
                              value={t.trackingColumn || ''}
                              disabled={running}
                              onChange={(e) => setTable(t.table, { trackingColumn: e.target.value || null })}
                              className={`${INPUT} !py-1 !text-[12px] font-mono max-w-[180px]`}
                            >
                              <option value="">{t.approach === 'SCD_TYPE_2' ? '— compare all rows —' : '— choose —'}</option>
                              {(t.columns || (t.trackingColumn ? [t.trackingColumn] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : <span className="text-[12px] text-[#CBD5E1]">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-[12px] text-[#475569] max-w-md">{t.reason}</td>
                        <td className="py-2.5 text-[11.5px] text-[#64748B]">
                          {ckpt ? (
                            <>
                              <span className="font-mono">{ckpt.value || 'full load'}</span>
                              <button onClick={() => handleResetTable(t.table)} disabled={running}
                                className="block text-[10.5px] text-[#1C58F6] hover:underline cursor-pointer flex items-center gap-1 mt-0.5 disabled:opacity-40"
                                title="Forget the checkpoint so the next run reloads this table from the beginning">
                                <RotateCcw className="w-3 h-3" /> Reload from start
                              </button>
                            </>
                          ) : 'never'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {summary && (
              <div className="mt-4 flex gap-2.5 bg-[#ECEFFF] border border-[#1C58F6]/20 rounded-xl p-3">
                <Sparkles className="w-4 h-4 text-[#1C58F6] shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-[#334155] leading-relaxed"><strong>AI reasoning:</strong> {summary}</p>
              </div>
            )}
            <div className="mt-3 flex gap-2 text-[11.5px] text-[#64748B]">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Changes are picked up by the tracking column, so rows deleted in the source are not removed from the target
                (Full Refresh tables are always an exact copy). Changing a table's approach or tracking column reloads it from the start.
              </span>
            </div>
          </>
        )}
      </Card>

      {/* 3. Run */}
      <Card
        step={4}
        title="Run & History"
        icon={Play}
        right={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border-r border-[#E2E8F0] pr-4">
              <label className="text-[12px] font-semibold text-[#475569]">Schedule:</label>
              <input
                type="text"
                placeholder="e.g. 15m or 0 * * * *"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                disabled={running}
                className={`${INPUT} !w-32`}
              />
              <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-[#475569]">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  disabled={running}
                  className="rounded border-[#CBD5E1] text-[#1C58F6] focus:ring-[#1C58F6]"
                />
                Enabled
              </label>
              <button onClick={async () => { await saveConfig(); }} disabled={running || (!schedule && scheduleEnabled)} className="text-[11px] px-2 py-1 bg-white border border-[#CBD5E1] rounded text-[#475569] hover:bg-slate-50 cursor-pointer">
                Save
              </button>
            </div>
            <button onClick={handleRun} disabled={!tables.length || !activeCount || running || !targetReady}
              className="px-4 py-2 rounded-lg bg-[#FF3C00] hover:bg-[#E03500] text-white text-[12.5px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {running ? 'Running…' : `Run CDC Pipeline (${activeCount} table${activeCount === 1 ? '' : 's'})`}
            </button>
          </div>
        }
      >
        {runError && (
          <p className="mb-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{runError}</p>
        )}
        <div className="space-y-4">
          {run ? <CdcRunProgress run={run} /> : <p className="text-[12.5px] text-[#64748B]">Your configuration is saved automatically when you run.</p>}
          <CdcRunHistory runs={history} />
        </div>
      </Card>
    </div>
  );
}
