import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Clock,
  Database,
  FileCode2,
  Hourglass,
  Loader2,
  Package,
  Rows3,
  Server,
  Sparkles,
  Workflow
} from 'lucide-react';
import {
  fetchMonitoringJobModels,
  fetchMonitoringJobs,
  fetchMonitoringModelQueries,
  optimizeDbtBottleneckQuery
} from '@/api';
import {
  ACCENT,
  BORDER,
  BRAND,
  EmptyState,
  FAINT,
  INK,
  InfoNote,
  MUTED,
  OptimizedSqlBlock,
  SqlBlock,
  StatusPill,
  formatBytes,
  formatCount,
  formatDuration,
  formatTimestamp
} from './MonitoringPrimitives';

// Job -> model -> query drill-down. Run time is shown at every level, which is the point of the
// feature: a job's total, each model's build time within it, and each statement's elapsed time.
//
// Level 3 is dbt-only in practice. It needs a query id, which only dbt reports via adapter_response;
// for other source types the parent collapses to job -> task and the query column is hidden.

const CELL = 'px-3 py-2 text-[11.5px] align-middle';
const HEAD = 'px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-left';

function Breadcrumbs({ trail, onJump }) {
  return (
    <nav className="flex items-center gap-1 flex-wrap text-[11.5px]">
      {trail.map((crumb, i) => {
        const last = i === trail.length - 1;
        return (
          <React.Fragment key={`${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: FAINT }} />}
            <button
              onClick={() => !last && onJump(i)}
              disabled={last}
              className={`font-semibold px-1 py-0.5 rounded ${last ? 'cursor-default' : 'cursor-pointer hover:underline'}`}
              style={{ color: last ? INK : ACCENT }}
            >
              {crumb.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function TableShell({ children, head }) {
  return (
    <div className="bg-white rounded-2xl border shadow-xs overflow-hidden" style={{ borderColor: BORDER }}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', color: FAINT }}>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Loading({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-[12px]" style={{ color: MUTED }}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------- level 1

function JobsTable({ jobs, onOpen }) {
  return (
    <TableShell
      head={
        <>
          <th className={HEAD}>Job</th>
          <th className={HEAD}>Runs</th>
          <th className={HEAD}>Success</th>
          <th className={HEAD}>Failed</th>
          <th className={HEAD}>Avg time</th>
          <th className={HEAD}>Total time</th>
          <th className={HEAD}>Last run</th>
          <th className={HEAD}>Status</th>
          <th className={HEAD} />
        </>
      }
    >
      {jobs.map((j) => (
        <tr
          key={j.JOB_ID}
          onClick={() => onOpen(j)}
          className="border-t cursor-pointer transition-colors hover:bg-[#F8FAFC]"
          style={{ borderColor: '#F1F5F9' }}
        >
          <td className={CELL}>
            <div className="font-bold truncate max-w-[280px]" style={{ color: INK }}>{j.JOB_NAME}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {j.ENVIRONMENT && (
                <span className="text-[10px] inline-flex items-center gap-1" style={{ color: FAINT }}>
                  <Server className="w-2.5 h-2.5" />{j.ENVIRONMENT}
                </span>
              )}
              {j.IS_ACTIVE === false && (
                <span className="text-[10px] font-bold" style={{ color: '#C2410C' }}>Deactivated</span>
              )}
            </div>
          </td>
          <td className={`${CELL} tabular-nums`} style={{ color: INK }}>{formatCount(j.RUN_COUNT)}</td>
          <td className={`${CELL} tabular-nums`} style={{ color: '#047857' }}>{formatCount(j.SUCCESS_COUNT)}</td>
          <td className={`${CELL} tabular-nums`} style={{ color: j.FAILURE_COUNT > 0 ? '#B91C1C' : MUTED }}>
            {formatCount(j.FAILURE_COUNT)}
          </td>
          <td className={`${CELL} font-mono`} style={{ color: INK }}>{formatDuration(j.AVG_DURATION_SECS)}</td>
          <td className={`${CELL} font-mono`} style={{ color: MUTED }}>{formatDuration(j.TOTAL_DURATION_SECS)}</td>
          <td className={CELL} style={{ color: MUTED }}>{formatTimestamp(j.LAST_RUN_AT)}</td>
          <td className={CELL}><StatusPill status={j.LAST_STATUS} /></td>
          <td className={CELL}><ChevronRight className="w-4 h-4" style={{ color: FAINT }} /></td>
        </tr>
      ))}
    </TableShell>
  );
}

// ---------------------------------------------------------------- level 2

function ModelsTable({ models, onOpen, supportsQueries }) {
  return (
    <TableShell
      head={
        <>
          <th className={HEAD}>Model</th>
          <th className={HEAD}>Type</th>
          <th className={HEAD}>Runs</th>
          <th className={HEAD}>Avg time</th>
          <th className={HEAD}>Last time</th>
          <th className={HEAD}>Total time</th>
          <th className={HEAD}>Rows</th>
          <th className={HEAD}>Last run</th>
          <th className={HEAD}>Status</th>
          <th className={HEAD}>Queries</th>
        </>
      }
    >
      {models.map((m) => {
        const clickable = true;
        return (
          <tr
            key={m.MODEL_NAME}
            onClick={() => clickable && onOpen(m)}
            className={`border-t transition-colors ${clickable ? 'cursor-pointer hover:bg-[#F8FAFC]' : ''}`}
            style={{ borderColor: '#F1F5F9' }}
          >
            <td className={CELL}>
              <div className="font-bold truncate max-w-[260px]" style={{ color: INK }}>{m.MODEL_NAME}</div>
              {(m.SCHEMA_NAME || m.MODEL_LAYER) && (
                <div className="text-[10px] mt-0.5 font-mono truncate" style={{ color: FAINT }}>
                  {[m.MODEL_LAYER, m.SCHEMA_NAME].filter(Boolean).join(' · ')}
                </div>
              )}
            </td>
            <td className={CELL} style={{ color: MUTED }}>{m.MATERIALIZATION || m.RESOURCE_TYPE || '—'}</td>
            <td className={`${CELL} tabular-nums`} style={{ color: INK }}>{formatCount(m.RUN_COUNT)}</td>
            <td className={`${CELL} font-mono`} style={{ color: INK }}>{formatDuration(m.AVG_DURATION_SECS)}</td>
            <td className={`${CELL} font-mono`} style={{ color: MUTED }}>{formatDuration(m.LAST_DURATION_SECS)}</td>
            <td className={`${CELL} font-mono`} style={{ color: MUTED }}>{formatDuration(m.TOTAL_DURATION_SECS)}</td>
            <td className={`${CELL} tabular-nums`} style={{ color: MUTED }}>{formatCount(m.LAST_ROWS_AFFECTED)}</td>
            <td className={CELL} style={{ color: MUTED }}>{formatTimestamp(m.LAST_RUN_AT)}</td>
            <td className={CELL}><StatusPill status={m.LAST_STATUS} /></td>
            <td className={CELL}>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: ACCENT }}>
                {formatCount(m.QUERY_COUNT ?? 1)}
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </td>
          </tr>
        );
      })}
    </TableShell>
  );
}

// ---------------------------------------------------------------- level 3

function QueryCard({ query: q, sourceId, modelName, fallbackSql }) {
  const sqlText = q.QUERY_TEXT || q.FALLBACK_SQL || fallbackSql;
  const isFallback = !q.QUERY_TEXT && !!sqlText;
  const [open, setOpen] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);

  const pruned = q.PARTITIONS_TOTAL
    ? Math.round(100 * (1 - (q.PARTITIONS_SCANNED || 0) / q.PARTITIONS_TOTAL))
    : null;
  const spill = (q.BYTES_SPILLED_LOCAL || 0) + (q.BYTES_SPILLED_REMOTE || 0);

  const handleOptimize = async () => {
    setOptimizing(true);
    setOpen(true);
    const res = await optimizeDbtBottleneckQuery(sourceId, {
      modelName,
      querySql: sqlText || '',
      queryId: q.QUERY_ID || null
    });
    setOptimizeResult(res);
    setOptimizing(false);
  };

  return (
    <div className="bg-white rounded-2xl border shadow-xs p-3.5" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black px-1.5 py-0.5 rounded" style={{ backgroundColor: '#ECEFFF', color: BRAND }}>
              #{q.QUERY_SEQ ?? 1}
            </span>
            <span className="text-[12px] font-bold" style={{ color: INK }}>{q.QUERY_TYPE || 'QUERY'}</span>
            {q.IS_PRIMARY && (
              <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                style={{ backgroundColor: '#F8FAFC', color: MUTED }}>
                dbt-reported
              </span>
            )}
            <StatusPill status={q.STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]" style={{ color: MUTED }}>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <strong style={{ color: INK }}>{formatDuration(q.DURATION_SECS)}</strong>
            </span>
            {q.ROWS_PRODUCED != null && (
              <span className="inline-flex items-center gap-1">
                <Rows3 className="w-3 h-3" />{formatCount(q.ROWS_PRODUCED)} rows
              </span>
            )}
            {q.BYTES_SCANNED != null && (
              <span className="inline-flex items-center gap-1">
                <Database className="w-3 h-3" />{formatBytes(q.BYTES_SCANNED)} scanned
              </span>
            )}
            {pruned != null && (
              <span style={{ color: pruned < 10 ? '#C2410C' : MUTED }}>{pruned}% pruned</span>
            )}
            {spill > 0 && (
              <span style={{ color: '#B91C1C' }}>Spilled {formatBytes(spill)}</span>
            )}
            {q.WAREHOUSE_NAME && <span className="font-mono text-[10px]">{q.WAREHOUSE_NAME}</span>}
          </div>
          <p className="text-[10px] mt-1" style={{ color: FAINT }}>
            Run {q.RUN_ID} · {formatTimestamp(q.STARTED_AT)}
            {q.QUERY_ID && <span className="font-mono"> · {q.QUERY_ID}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {sqlText && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer bg-white border"
              style={{ color: MUTED, borderColor: BORDER }}
            >
              {open ? 'Hide SQL' : 'Show SQL'}
            </button>
          )}
          <button
            onClick={handleOptimize}
            disabled={optimizing || !sqlText}
            title={sqlText ? 'Ask the AI for a faster version' : 'SQL text not captured for this query yet'}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer inline-flex items-center gap-1.5 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: BRAND }}
          >
            {optimizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            <span>Optimize with AI</span>
          </button>
        </div>
      </div>

      {open && sqlText && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: FAINT }}>
              {isFallback ? 'Compiled SQL (from dbt manifest)' : 'Executed SQL'}
            </p>
            {isFallback && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                Manifest SQL fallback
              </span>
            )}
          </div>
          <SqlBlock sql={sqlText} />
        </div>
      )}
      {optimizeResult && <OptimizedSqlBlock result={optimizeResult} />}
    </div>
  );
}

function QueriesView({ payload, sourceId, modelName, queryScope, onScopeChange }) {
  if (!payload) return null;
  const { queries = [], note, compiledSql, source } = payload;
  const [optimizingManifest, setOptimizingManifest] = useState(false);
  const [manifestOptResult, setManifestOptResult] = useState(null);

  const handleOptimizeManifest = async () => {
    setOptimizingManifest(true);
    const res = await optimizeDbtBottleneckQuery(sourceId, {
      modelName,
      querySql: compiledSql || '',
      queryId: null
    });
    setManifestOptResult(res);
    setOptimizingManifest(false);
  };

  const scopeToggle = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="text-[11px]" style={{ color: MUTED }}>
        {queryScope === 'all' ? 'Every run in the selected period' : 'Most recent run of this model'}
      </span>
      <div className="inline-flex rounded-xl p-0.5 border bg-white" style={{ borderColor: BORDER }}>
        {[{ v: 'latest', l: 'Latest run' }, { v: 'all', l: 'All runs' }].map((o) => (
          <button
            key={o.v}
            onClick={() => onScopeChange(o.v)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
            style={o.v === queryScope
              ? { backgroundColor: ACCENT, color: '#FFFFFF' }
              : { backgroundColor: 'transparent', color: MUTED }}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );

  if (!queries.length) {
    return (
      <div className="space-y-3">
        {scopeToggle}
        {note && <InfoNote tone="warn">{note}</InfoNote>}
        {compiledSql ? (
          <div className="bg-white rounded-2xl border shadow-xs p-3.5 space-y-3" style={{ borderColor: BORDER }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: FAINT }}>
                  Compiled SQL from the dbt manifest
                </p>
                <p className="text-[11px]" style={{ color: MUTED }}>
                  Model definition from project catalog
                </p>
              </div>
              <button
                onClick={handleOptimizeManifest}
                disabled={optimizingManifest || !compiledSql}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer inline-flex items-center gap-1.5 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND }}
              >
                {optimizingManifest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span>Optimize with AI</span>
              </button>
            </div>
            <SqlBlock sql={compiledSql} maxHeight="max-h-96" />
            {manifestOptResult && <OptimizedSqlBlock result={manifestOptResult} />}
          </div>
        ) : (
          <EmptyState
            icon={FileCode2}
            title="No queries captured for this model"
            detail="Queries are captured from the query id dbt records for each run. Refresh the source once a run has completed, and give Snowflake's query history a few hours to catch up."
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {scopeToggle}
      {note && <InfoNote>{note}</InfoNote>}
      {source === 'adapter_response' && (
        <p className="text-[10.5px] px-1" style={{ color: FAINT }}>
          Showing queries as reported by dbt and manifest. Full statement lists and Snowflake query statistics enrich automatically once query history processes.
        </p>
      )}
      {queries.map((q) => (
        <QueryCard
          key={`${q.RUN_ID}-${q.QUERY_ID}-${q.QUERY_SEQ}`}
          query={q}
          sourceId={sourceId}
          modelName={modelName}
          fallbackSql={compiledSql}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shell

export default function DrilldownExplorer({ sourceId, sourceType, period }) {
  // Level 3 needs a per-run query id, which only the dbt adapter reports.
  const supportsQueries = !sourceType || String(sourceType).toLowerCase() === 'dbt';
  const modelWord = supportsQueries ? 'Models' : 'Tasks';

  const [job, setJob] = useState(null);
  const [model, setModel] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [models, setModels] = useState(null);
  const [queries, setQueries] = useState(null);
  const [queryScope, setQueryScope] = useState('latest');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const level = model ? 3 : job ? 2 : 1;

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchMonitoringJobs(sourceId, period);
    if (res?.status === 'success') setJobs(res.jobs || []);
    else setError(res?.message || 'Could not load jobs.');
    setLoading(false);
  }, [sourceId, period]);

  // Changing the period re-fetches whichever level is open, and resets nothing — the user stays
  // where they were and just sees the new window.
  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    if (!job) { setModels(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetchMonitoringJobModels(sourceId, job.JOB_ID, period);
      if (cancelled) return;
      if (res?.status === 'success') setModels(res.models || []);
      else setError(res?.message || 'Could not load models for this job.');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sourceId, job, period]);

  useEffect(() => {
    if (!model) { setQueries(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetchMonitoringModelQueries(sourceId, model.MODEL_NAME, period, null, queryScope);
      if (cancelled) return;
      if (res?.status === 'success') setQueries(res);
      else setError(res?.message || 'Could not load queries for this model.');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sourceId, model, period, queryScope]);

  const trail = [{ label: 'Jobs' }];
  if (job) trail.push({ label: job.JOB_NAME });
  if (model) trail.push({ label: model.MODEL_NAME });

  const jumpTo = (index) => {
    if (index === 0) { setJob(null); setModel(null); }
    if (index === 1) setModel(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Breadcrumbs trail={trail} onJump={jumpTo} />
        {level === 2 && job && (
          <div className="flex items-center gap-3 text-[11px]" style={{ color: MUTED }}>
            <span className="inline-flex items-center gap-1">
              <Workflow className="w-3 h-3" />{formatCount(job.RUN_COUNT)} runs
            </span>
            <span className="inline-flex items-center gap-1">
              <Hourglass className="w-3 h-3" />Avg {formatDuration(job.AVG_DURATION_SECS)}
            </span>
          </div>
        )}
        {level === 3 && model && (
          <div className="flex items-center gap-3 text-[11px]" style={{ color: MUTED }}>
            <span className="inline-flex items-center gap-1">
              <Package className="w-3 h-3" />{model.MATERIALIZATION || model.RESOURCE_TYPE || 'model'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />Avg {formatDuration(model.AVG_DURATION_SECS)}
            </span>
          </div>
        )}
      </div>

      {error && <InfoNote tone="warn">{error}</InfoNote>}

      {loading && <Loading label={level === 1 ? 'Loading jobs…' : level === 2 ? `Loading ${modelWord.toLowerCase()}…` : 'Loading queries…'} />}

      {!loading && level === 1 && (
        jobs?.length
          ? <JobsTable jobs={jobs} onOpen={(j) => { setJob(j); setModel(null); }} />
          : <EmptyState
              icon={Workflow}
              title="No jobs ran in this period"
              detail="Widen the time filter, or click Refresh to pull the latest runs from the source."
            />
      )}

      {!loading && level === 2 && (
        models?.length
          ? <ModelsTable models={models} onOpen={setModel} supportsQueries={supportsQueries} />
          : <EmptyState
              icon={Package}
              title={`No ${modelWord.toLowerCase()} recorded for this job`}
              detail="Per-model detail comes from the run artifacts of recent runs, so older runs in a wide window may have job totals but no breakdown."
            />
      )}

      {!loading && level === 3 && (
        <QueriesView
          payload={queries}
          sourceId={sourceId}
          modelName={model?.MODEL_NAME}
          queryScope={queryScope}
          onScopeChange={setQueryScope}
        />
      )}
    </div>
  );
}
