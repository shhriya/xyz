import React from 'react';
import { CalendarRange } from 'lucide-react';
import { ACCENT, BORDER, INK, MUTED } from './MonitoringPrimitives';

// The period control for the whole monitoring tab. Owned by MonitoringView so every panel on the
// tab reads the same value — the requirement is that changing it moves job counts, run times and
// trends together, not just one chart.

export const PERIOD_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '15', label: '15 days' },
  { value: '30', label: '30 days' },
  { value: 'all', label: 'All time' }
];

export const DEFAULT_PERIOD = '30';
const STORAGE_KEY = 'gov_period';

export function readStoredPeriod() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return PERIOD_OPTIONS.some((o) => o.value === stored) ? stored : DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

export function storePeriod(period) {
  try { sessionStorage.setItem(STORAGE_KEY, period); } catch { /* private mode — default is fine */ }
}

export default function TimeRangeFilter({ period, onChange, disabled = false }) {
  return (
    <div className="flex items-center gap-2">
      <CalendarRange className="w-3.5 h-3.5 shrink-0" style={{ color: MUTED }} />
      <div
        className="inline-flex rounded-xl p-0.5 border bg-white"
        style={{ borderColor: BORDER }}
        role="group"
        aria-label="Time period"
      >
        {PERIOD_OPTIONS.map((opt) => {
          const active = opt.value === period;
          return (
            <button
              key={opt.value}
              onClick={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              aria-pressed={active}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              style={active
                ? { backgroundColor: ACCENT, color: '#FFFFFF' }
                : { backgroundColor: 'transparent', color: MUTED }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PeriodLabel({ period }) {
  const opt = PERIOD_OPTIONS.find((o) => o.value === period);
  return <span className="text-[11px] font-semibold" style={{ color: INK }}>{opt ? opt.label : period}</span>;
}
