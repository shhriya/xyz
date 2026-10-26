import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Loader2,
  RefreshCw,
  Rows3,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { fetchMonitoringRegressions, optimizeDbtBottleneckQuery } from '@/api';
import {
  ACCENT,
  BeforeAfter,
  BORDER,
  BRAND,
  EmptyState,
  FAINT,
  INK,
  InfoNote,
  MUTED,
  OptimizedSqlBlock,
  SeverityBadge,
  SqlBlock,
  formatBytes,
  formatCount,
  formatDuration,
  formatTimestamp
} from './MonitoringPrimitives';

// Trend and regression detection. Compares each job/model/query's most recent runs against its
// earlier runs within the selected period, so the headline is a before/after — "was 5 minutes, now
// 20" — rather than a ratio against a blended mean.
//
// Duration and row count are reported separately on purpose: growing in both is data volume, which
// is expected; growing in time alone is a plan or skew problem, which is not.

const LEVELS = [
  { value: 'model', label: 'Models' },
  { value: 'query', label: 'Queries' },
  { value: 'job', label: 'Jobs' }
];

const FLAG_LABEL = {
  slower: 'Slower',
  row_growth: 'Row count grew'
};

const DEFAULTS = { slowerBy: 1.5, ignoreUnderSec: 10, rowGrowth: 1.5 };

function NumberField({ label, value, onChange, step = '0.1', min = '0', suffix, hint }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: FAINT }}>{label}</span>
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value)}
          className="w-[72px] px-2 py-1 rounded-lg text-[11.5px] font-mono bg-white border outline-none focus:border-[#1C58F6]"
          style={{ color: INK, borderColor: BORDER }}
        />
        {suffix && <span className="text-[11px]" style={{ color: MUTED }}>{suffix}</span>}
      </span>
      {hint && <span className="text-[9.5px]" style={{ color: FAINT }}>{hint}</span>}
    </label>
  );
}

function FindingCard({ finding: f, sourceId, level }) {
  const [expanded, setExpanded] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);

  const metrics = f.diagnosis?.metrics || {};
  const canOptimize = level !== 'job' && Boolean(f.querySql);

  const handleOptimize = async () => {
    setOptimizing(true);
    setExpanded(true);
    const res = await optimizeDbtBottleneckQuery(sourceId, {
      modelName: f.label,
      querySql: f.querySql || '',
      diagnosis: f.diagnosis,
      queryId: f.queryId || null
    });
    setOptimizeResult(res);
    setOptimizing(false);
  };

  return (
    <div className="bg-white rounded-2xl border shadow-xs p-3.5" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={f.severity} />
            {f.flags?.map((flag) => (
              <span
                key={flag}
                className="text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                style={{ backgroundColor: '#ECEFFF', color: BRAND }}
              >
                {FLAG_LABEL[flag] || flag}
              </span>
            ))}
            <span className="text-[11px] font-bold" style={{ color: ACCENT }}>
              {f.diagnosis?.primaryCause}
            </span>
          </div>

          <h4 className="text-[13px] font-bold mt-1.5 truncate" style={{ color: INK }}>
            {f.label}
            {f.querySeq != null && (
              <span className="font-mono text-[11px] ml-1.5" style={{ color: FAINT }}>statement #{f.querySeq}</span>
            )}
          </h4>
          <p className="text-[10.5px] mt-0.5" style={{ color: FAINT }}>
            {[f.materialization, f.modelLayer, f.parent && `in ${f.parent}`].filter(Boolean).join(' · ') || '—'}
          </p>

          <div className="flex items-center gap-5 mt-2.5 flex-wrap">
            <BeforeAfter
              label="Run time"
              before={f.duration?.baselineAvgSec}
              after={f.duration?.currentAvgSec}
              pctChange={f.duration?.pctChange}
            />
            {f.rows?.currentAvgRows != null && f.rows?.baselineAvgRows != null && (
              <BeforeAfter
                label="Rows"
                before={f.rows.baselineAvgRows}
                after={f.rows.currentAvgRows}
                pctChange={f.rows.pctChange}
                format={formatCount}
              />
            )}
          </div>

          <p className="text-[10px] mt-2" style={{ color: FAINT }}>
            Compared {f.currentSampleSize} recent run{f.currentSampleSize === 1 ? '' : 's'} against the
            previous {f.baselineSampleSize} · last run {formatTimestamp(f.latestRunAt)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer inline-flex items-center gap-1 bg-white border"
            style={{ color: MUTED, borderColor: BORDER }}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>Details</span>
          </button>
          {canOptimize && (
            <button
              onClick={handleOptimize}
              disabled={optimizing}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer inline-flex items-center gap-1.5 text-white disabled:opacity-40"
              style={{ backgroundColor: BRAND }}
            >
              {optimizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              <span>Optimize with AI</span>
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2.5" style={{ borderColor: '#F1F5F9' }}>
          {f.diagnosis?.factors?.length > 0 && (
            <ul className="space-y-1">
              {f.diagnosis.factors.map((factor, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: '#334155' }}>
                  <span className="font-black leading-none mt-0.5" style={{ color: BRAND }}>&bull;</span>
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-4 flex-wrap text-[10.5px]" style={{ color: MUTED }}>
            {metrics.bytesScanned != null && (
              <span className="inline-flex items-center gap-1">
                <Database className="w-3 h-3" />{formatBytes(metrics.bytesScanned)} scanned
              </span>
            )}
            {metrics.partitionsTotal != null && (
              <span className="inline-flex items-center gap-1">
                <Rows3 className="w-3 h-3" />
                {formatCount(metrics.partitionsScanned)} / {formatCount(metrics.partitionsTotal)} partitions
              </span>
            )}
            {f.duration?.worstSec != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />Worst {formatDuration(f.duration.worstSec)}
              </span>
            )}
            {metrics.warehouse && <span className="font-mono text-[10px]">{metrics.warehouse}</span>}
          </div>

          {f.querySql && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: FAINT }}>
                Current SQL
              </p>
              <SqlBlock sql={f.querySql} />
            </div>
          )}
        </div>
      )}

      {optimizeResult && <OptimizedSqlBlock result={optimizeResult} />}
    </div>
  );
}

export default function RegressionPanel({ sourceId, sourceType, period }) {
  const [level, setLevel] = useState('model');
  const [draft, setDraft] = useState(DEFAULTS);
  const [applied, setApplied] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Query level needs captured statements, which only the dbt adapter produces.
  const levels = sourceType === 'dbt' ? LEVELS : LEVELS.filter((l) => l.value !== 'query');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchMonitoringRegressions(sourceId, {
      period,
      level,
      multiplier: applied.slowerBy,
      minDurationSec: applied.ignoreUnderSec,
      rowGrowthMultiplier: applied.rowGrowth
    });
    if (res?.status === 'success') setResult(res);
    else setError(res?.message || 'Could not run trend detection.');
    setLoading(false);
  }, [sourceId, period, level, applied]);

  useEffect(() => { load(); }, [load]);

  const findings = result?.findings || [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border shadow-xs p-3.5 space-y-3" style={{ borderColor: BORDER }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: INK }}>
              <TrendingUp className="w-4 h-4" style={{ color: BRAND }} />
              Slowdowns &amp; growth
            </h3>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: MUTED }}>
              Compares the most recent runs against earlier ones in the selected period, and flags
              anything that has slowed down or whose row count has jumped.
            </p>
          </div>
          <div className="inline-flex rounded-xl p-0.5 border bg-white shrink-0" style={{ borderColor: BORDER }}>
            {levels.map((l) => (
              <button
                key={l.value}
                onClick={() => setLevel(l.value)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                style={l.value === level
                  ? { backgroundColor: ACCENT, color: '#FFFFFF' }
                  : { backgroundColor: 'transparent', color: MUTED }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-4 flex-wrap pt-1">
          <NumberField
            label="Slower than before by"
            value={draft.slowerBy}
            onChange={(v) => setDraft((d) => ({ ...d, slowerBy: v }))}
            step="0.1"
            min="1.1"
            suffix="×"
            hint="1.5 = takes half again as long"
          />
          <NumberField
            label="Ignore runs under"
            value={draft.ignoreUnderSec}
            onChange={(v) => setDraft((d) => ({ ...d, ignoreUnderSec: v }))}
            step="1"
            suffix="sec"
            hint="Avoids flagging timing noise"
          />
          <NumberField
            label="Row growth over"
            value={draft.rowGrowth}
            onChange={(v) => setDraft((d) => ({ ...d, rowGrowth: v }))}
            step="0.1"
            min="1.1"
            suffix="×"
            hint="Judged separately from time"
          />
          <button
            onClick={() => setApplied({
              slowerBy: Math.max(1.1, parseFloat(draft.slowerBy) || DEFAULTS.slowerBy),
              ignoreUnderSec: Math.max(0, parseFloat(draft.ignoreUnderSec) ?? DEFAULTS.ignoreUnderSec),
              rowGrowth: Math.max(1.1, parseFloat(draft.rowGrowth) || DEFAULTS.rowGrowth)
            })}
            disabled={loading}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer inline-flex items-center gap-1.5 text-white disabled:opacity-40"
            style={{ backgroundColor: dirty ? BRAND : '#94A3B8' }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span>Apply &amp; re-scan</span>
          </button>
        </div>

        {result && !loading && (
          <p className="text-[10.5px] pt-1" style={{ color: FAINT }}>
            Compared {formatCount(result.entitiesCompared)} {level === 'job' ? 'jobs' : level === 'query' ? 'statements' : 'models'}
            {result.entitiesSkippedForHistory > 0 && (
              <> · {formatCount(result.entitiesSkippedForHistory)} skipped for too little history</>
            )}
            {result.totalFindings > findings.length && (
              <> · showing the top {findings.length} of {result.totalFindings}</>
            )}
          </p>
        )}
      </div>

      {error && <InfoNote tone="warn">{error}</InfoNote>}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-[12px]" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Comparing run history…</span>
        </div>
      )}

      {!loading && !error && findings.length === 0 && (
        <EmptyState
          icon={TrendingUp}
          title="Nothing has regressed in this period"
          detail={
            result?.entitiesCompared === 0
              ? 'There is not yet enough run history to compare. Each model needs at least three runs in the window — widen the time filter, or refresh again after a few more runs.'
              : 'Every model is running within its usual time and row count. Lower the thresholds above to see milder changes.'
          }
        />
      )}

      {!loading && findings.map((f) => (
        <FindingCard key={`${f.level}-${f.entityKey}`} finding={f} sourceId={sourceId} level={level} />
      ))}
    </div>
  );
}
