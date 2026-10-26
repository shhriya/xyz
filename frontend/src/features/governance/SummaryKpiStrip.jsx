import React from 'react';
import {
  AlertOctagon,
  Boxes,
  CheckCircle2,
  Clock,
  Layers,
  TrendingDown,
  XCircle
} from 'lucide-react';
import {
  BORDER,
  FAINT,
  INK,
  MUTED,
  formatCount,
  formatDuration,
  formatTimestamp
} from './MonitoringPrimitives';

// Headline counters above the tab bar. Always visible, and every run-shaped number respects the
// selected period — total jobs does not, because "how many jobs exist" doesn't change when you
// narrow a date range.

function KpiTile({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  const tones = {
    neutral: { icon: MUTED, value: INK },
    good: { icon: '#047857', value: '#047857' },
    bad: { icon: '#B91C1C', value: '#B91C1C' },
    warn: { icon: '#C2410C', value: '#C2410C' }
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div className="bg-white rounded-xl px-3 py-2.5 border shadow-xs min-w-0" style={{ borderColor: BORDER }}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: t.icon }} />
        <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: FAINT }}>
          {label}
        </span>
      </div>
      <p className="text-[19px] font-black mt-1 leading-none tabular-nums" style={{ color: t.value }}>
        {value}
      </p>
      {sub && <p className="text-[10.5px] mt-1 truncate" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

/**
 * `summary` is the /{source_id}/summary payload. `coverage` on it reports how much history exists,
 * which is surfaced as a note: a source synced for the first time has almost nothing in a 30-day
 * window, and without saying so the empty numbers read as a broken feature.
 */
export default function SummaryKpiStrip({ summary, loading }) {
  if (loading && !summary) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl px-3 py-2.5 border shadow-xs animate-pulse h-[74px]"
            style={{ borderColor: BORDER }}
          />
        ))}
      </div>
    );
  }
  if (!summary) return null;

  const flagged = (summary.modelsFlagged || 0) + (summary.queriesFlagged || 0);
  const coverage = summary.coverage || {};

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiTile
          icon={Boxes}
          label="Total jobs"
          value={formatCount(summary.totalJobs)}
          sub={summary.jobsWithRuns != null ? `${formatCount(summary.jobsWithRuns)} ran in period` : null}
        />
        <KpiTile
          icon={CheckCircle2}
          label="Successful runs"
          value={formatCount(summary.successfulRuns)}
          sub={summary.successRatePct != null ? `${summary.successRatePct}% success rate` : null}
          tone="good"
        />
        <KpiTile
          icon={XCircle}
          label="Failed runs"
          value={formatCount(summary.failedRuns)}
          sub={`of ${formatCount(summary.totalRuns)} total`}
          tone={summary.failedRuns > 0 ? 'bad' : 'neutral'}
        />
        <KpiTile
          icon={AlertOctagon}
          label={`Failures · ${summary.label || 'period'}`}
          value={formatCount(summary.failuresInPeriod)}
          tone={summary.failuresInPeriod > 0 ? 'bad' : 'good'}
        />
        <KpiTile
          icon={TrendingDown}
          label="Flagged slower"
          value={formatCount(flagged)}
          sub={`${formatCount(summary.modelsFlagged)} models · ${formatCount(summary.queriesFlagged)} queries`}
          tone={flagged > 0 ? 'warn' : 'good'}
        />
        <KpiTile
          icon={Clock}
          label="Avg run time"
          value={formatDuration(summary.avgRunSecs)}
          sub={summary.lastRunAt ? `Last run ${formatTimestamp(summary.lastRunAt)}` : null}
        />
      </div>

      {coverage.earliestRunAt && (
        <p className="text-[10.5px] flex items-center gap-1.5 px-1" style={{ color: FAINT }}>
          <Layers className="w-3 h-3 shrink-0" />
          History held: {formatTimestamp(coverage.earliestRunAt)} to {formatTimestamp(coverage.latestRunAt)}
          {' · '}{formatCount(coverage.runRows)} runs
          {coverage.queryRows > 0 && ` · ${formatCount(coverage.queryRows)} queries captured`}
          {coverage.queryRows > 0 && coverage.enrichedQueryRows === 0 && ' (SQL text pending)'}
        </p>
      )}
    </div>
  );
}
