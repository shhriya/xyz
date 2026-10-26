import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Zap
} from 'lucide-react';
import { fetchDbtBottlenecks, optimizeDbtBottleneckQuery } from '@/api';

// dbt-only. Level 2 (flags + diagnosis) is plain thresholding over already-synced GOV_RUN_RESULTS —
// fetched on mount/refresh, never touches the LLM. Level 3 (AI-rewritten SQL) is fetched only when
// the user clicks "Optimize with AI" for one specific flagged model.

function formatDuration(sec) {
  if (sec == null) return '—';
  // Keep a decimal for short durations so a 0.4s baseline doesn't render as "0s".
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

const THRESHOLD_LABEL = {
  absolute: 'Over time limit',
  relative: 'Slower than usual',
  both: 'Over time limit · Slower than usual'
};

const DEFAULTS = { limitMinutes: 1, slowerBy: 3, ignoreUnderSec: 30 };

function OptimizedSqlBlock({ result }) {
  const [copied, setCopied] = useState(false);
  if (result.status === 'error') {
    return (
      <div className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-[11px] flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{result.message}</span>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2.5">
      {!result.isSafeSelect && (
        <div className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[11px] flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>The AI suggestion was rejected as unsafe ({result.safetyError}) and is shown for reference only — do not run it.</span>
        </div>
      )}
      <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-3 overflow-x-auto max-h-64">
        {result.optimizedSql ? (
          <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed whitespace-pre-wrap break-all">{result.optimizedSql}</pre>
        ) : (
          <p className="text-[11px] font-mono text-[#64748B] italic">No optimized SQL returned.</p>
        )}
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        {result.verified ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            <Check className="w-3 h-3" /> Compiles (EXPLAIN-verified, not executed)
          </span>
        ) : result.verificationError ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded" title={result.verificationError}>
            <AlertTriangle className="w-3 h-3" /> Failed to compile
          </span>
        ) : (
          <span className="text-[10px] text-[#94A3B8]">Not verified against Snowflake</span>
        )}
        <button
          onClick={() => { navigator.clipboard.writeText(result.optimizedSql || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          disabled={!result.optimizedSql}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[#10338D] bg-white border border-[#D1DEFF] hover:bg-[#ECEFFF] px-2.5 py-1 rounded-lg cursor-pointer transition-colors disabled:opacity-40"
        >
          {copied ? <><Check className="w-3 h-3" /><span>Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy SQL</span></>}
        </button>
      </div>
      {result.explanation && (
        <div className="text-[11px] text-[#334155] leading-relaxed bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 whitespace-pre-wrap">
          {result.explanation}
        </div>
      )}
      {result.keyChanges?.length > 0 && (
        <ul className="space-y-1 pl-1">
          {result.keyChanges.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#334155]">
              <span className="text-[#10338D] font-black leading-none mt-0.5">&bull;</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      {result.caution && <p className="text-[10px] text-[#94A3B8] italic">{result.caution}</p>}
    </div>
  );
}

function BottleneckCard({ bottleneck: b, sourceId }) {
  const [expanded, setExpanded] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);
  const isHigh = b.severity === 'HIGH';

  const handleOptimize = async () => {
    setOptimizing(true);
    setExpanded(true);
    const res = await optimizeDbtBottleneckQuery(sourceId, {
      modelName: b.modelName,
      querySql: b.querySql || '',
      diagnosis: b.diagnosis
    });
    setOptimizeResult(res);
    setOptimizing(false);
  };

  return (
    <div className={`bg-white border rounded-xl shadow-xs overflow-hidden ${isHigh ? 'border-red-200' : 'border-amber-200'}`}>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${
                isHigh ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}>
                {b.severity} Severity
              </span>
              <span className="text-[10px] font-bold text-[#10338D] bg-[#ECEFFF] border border-[#D1DEFF] px-2 py-0.5 rounded">
                {THRESHOLD_LABEL[b.thresholdType] || b.thresholdType}
              </span>
              <span className="text-[10px] font-bold text-[#666666] bg-[#F8FAFC] border border-[#D1DEFF] px-2 py-0.5 rounded">
                {b.diagnosis?.primaryCause}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[#666666] flex-wrap">
              <span className="font-mono font-bold text-[#1C58F6]">{b.modelName}</span>
              {b.modelLayer && (
                <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{b.modelLayer}</span>
              )}
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />run #{b.runId}{b.jobName ? ` · ${b.jobName}` : ''}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-black font-mono text-[#10338D]">{formatDuration(b.elapsedSec)}</div>
            {b.baselineAvgSec != null ? (
              <div className="text-[10px] text-[#666666]">
                normally <span className="font-mono font-semibold">{formatDuration(b.baselineAvgSec)}</span>
                {b.ratioToBaseline != null && <span className="text-red-600 font-bold"> ({b.ratioToBaseline}x)</span>}
              </div>
            ) : (
              <div className="text-[10px] text-[#666666]">no prior baseline</div>
            )}
          </div>
        </div>

        {b.querySql && (
          <pre className="text-[11px] font-mono text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2.5 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
            {b.querySql}
          </pre>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#666666] hover:text-[#10338D] cursor-pointer"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{expanded ? 'Hide details' : 'Show diagnosis details'}</span>
          </button>
          <button
            onClick={handleOptimize}
            disabled={optimizing || !b.querySql}
            title={!b.querySql ? 'No compiled SQL available for this model yet' : undefined}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-[#10338D] to-[#1C58F6] px-3 py-1.5 rounded-lg shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-60"
          >
            {optimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{optimizing ? 'Optimizing with AI...' : 'Optimize with AI'}</span>
          </button>
        </div>

        {expanded && (
          <div className="pt-2 border-t border-[#F1F5F9] space-y-2">
            {b.diagnosis?.factors?.length > 0 && (
              <ul className="space-y-1">
                {b.diagnosis.factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#334155]">
                    <span className="text-[#FF3C00] font-black leading-none mt-0.5">&bull;</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
            {b.diagnosis?.metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                {[
                  ['Rows Affected', b.diagnosis.metrics.rowsAffected != null ? b.diagnosis.metrics.rowsAffected.toLocaleString() : '—'],
                  ['Materialization', b.materialization || '—'],
                  ['Layer', b.modelLayer || '—']
                ].map(([label, value]) => (
                  <div key={label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2 py-1.5">
                    <div className="text-[#94A3B8] font-bold uppercase tracking-wide">{label}</div>
                    <div className="font-mono font-semibold text-[#1E1E1E]">{value}</div>
                  </div>
                ))}
              </div>
            )}
            {optimizeResult && <OptimizedSqlBlock result={optimizeResult} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DbtBottleneckPanel({ sourceId }) {
  const [bottlenecks, setBottlenecks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limitMinutes, setLimitMinutes] = useState(DEFAULTS.limitMinutes);
  const [slowerBy, setSlowerBy] = useState(DEFAULTS.slowerBy);
  const [ignoreUnderSec, setIgnoreUnderSec] = useState(DEFAULTS.ignoreUnderSec);

  // Every scan sends the values shown on screen, so what you see is exactly what was applied.
  const currentThresholds = () => ({
    absoluteThresholdSec: Math.max(60, (Number(limitMinutes) || DEFAULTS.limitMinutes) * 60),
    relativeMultiplier: Math.max(1.5, Number(slowerBy) || DEFAULTS.slowerBy),
    minDurationSec: Math.max(0, Number(ignoreUnderSec) || 0)
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetchDbtBottlenecks(sourceId, currentThresholds());
    if (res && res.status === 'success') {
      setBottlenecks(res.bottlenecks || []);
    } else {
      setError(res?.message || 'Could not load bottleneck detection.');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (sourceId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const resetDefaults = () => {
    setLimitMinutes(DEFAULTS.limitMinutes);
    setSlowerBy(DEFAULTS.slowerBy);
    setIgnoreUnderSec(DEFAULTS.ignoreUnderSec);
  };

  const highCount = (bottlenecks || []).filter((b) => b.severity === 'HIGH').length;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-black text-[#10338D] tracking-tight flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" />
              Query Bottleneck Detection &amp; AI Optimization
            </h3>
            <p className="text-[10px] text-[#666666] mt-0.5 max-w-xl">
              Finds dbt model builds that took too long — either longer than a fixed time limit, or much slower than that same model usually runs — and explains the likely cause. AI suggests a faster query only when you ask.
            </p>
          </div>
          {bottlenecks?.length > 0 && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border shrink-0 ${
              highCount > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {bottlenecks.length} flagged{highCount > 0 ? ` · ${highCount} high severity` : ''}
            </span>
          )}
        </div>

        <div className="mt-3.5 pt-3.5 border-t border-[#F1F5F9] space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#1E1E1E] block">Time limit</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={limitMinutes}
                  onChange={(e) => setLimitMinutes(e.target.value)}
                  className="w-20 text-[12px] border border-[#D1DEFF] rounded-md px-2 py-1.5 bg-white text-[#10338D] font-mono font-semibold outline-none focus:ring-1 focus:ring-[#1C58F6]"
                />
                <span className="text-[11px] text-[#475569]">minutes</span>
              </div>
              <p className="text-[10px] text-[#666666] leading-snug">
                Flag any build that runs longer than this, regardless of its history.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#1E1E1E] block">Slower than usual by</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1.5"
                  step="0.5"
                  value={slowerBy}
                  onChange={(e) => setSlowerBy(e.target.value)}
                  className="w-20 text-[12px] border border-[#D1DEFF] rounded-md px-2 py-1.5 bg-white text-[#10338D] font-mono font-semibold outline-none focus:ring-1 focus:ring-[#1C58F6]"
                />
                <span className="text-[11px] text-[#475569]">× its normal time</span>
              </div>
              <p className="text-[10px] text-[#666666] leading-snug">
                Flag a build that takes this many times longer than the same model's average in recent runs. E.g. 3 = normally 2 min, now 6 min or more.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#1E1E1E] block">Ignore builds shorter than</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={ignoreUnderSec}
                  onChange={(e) => setIgnoreUnderSec(e.target.value)}
                  className="w-20 text-[12px] border border-[#D1DEFF] rounded-md px-2 py-1.5 bg-white text-[#10338D] font-mono font-semibold outline-none focus:ring-1 focus:ring-[#1C58F6]"
                />
                <span className="text-[11px] text-[#475569]">seconds</span>
              </div>
              <p className="text-[10px] text-[#666666] leading-snug">
                Very short builds are skipped, so a 2-second build that's "3× its usual 0.6s" isn't reported as a problem.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white bg-[#10338D] hover:bg-[#1C58F6] px-3 py-1.5 rounded-lg cursor-pointer transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              <span>{loading ? 'Scanning...' : 'Apply & Re-scan'}</span>
            </button>
            <button
              onClick={resetDefaults}
              disabled={loading}
              title="Time limit 1 min · 3× slower · ignore under 30 s"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#10338D] bg-white border border-[#D1DEFF] hover:bg-[#ECEFFF] px-3 py-1.5 rounded-lg cursor-pointer transition-all disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset to defaults</span>
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-white border border-red-200 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" />
          <p className="text-xs font-bold text-red-700">{error}</p>
        </div>
      ) : loading && bottlenecks === null ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center">
          <Loader2 className="w-6 h-6 text-[#1C58F6] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#666666]">Scanning recent dbt model builds...</p>
        </div>
      ) : (bottlenecks || []).length === 0 ? (
        <div className="bg-white border border-dashed border-[#D1DEFF] rounded-2xl p-10 text-center">
          <Zap className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-xs font-bold text-[#1E1E1E]">No bottlenecks detected</p>
          <p className="text-[11px] text-[#666666] mt-1 max-w-sm mx-auto">
            No recent build ran longer than the time limit or much slower than usual.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bottlenecks.map((b) => <BottleneckCard key={`${b.modelName}_${b.runId}`} bottleneck={b} sourceId={sourceId} />)}
        </div>
      )}
    </div>
  );
}
