import React from 'react';
import { APPROACH_LABELS } from './approaches';
import { CheckCircle2, Clock, Loader2, SkipForward, XCircle, Upload, History } from 'lucide-react';

const STATUS = {
  waiting: { Icon: Clock, tone: 'text-[#94A3B8]', label: 'Waiting…' },
  reading: { Icon: Loader2, tone: 'text-[#1C58F6]', label: 'Reading source…', spin: true },
  loading: { Icon: Upload, tone: 'text-[#1C58F6]', label: 'Loading into Snowflake…' },
  done: { Icon: CheckCircle2, tone: 'text-emerald-600', label: 'Done' },
  failed: { Icon: XCircle, tone: 'text-rose-600', label: 'Failed' },
  skipped: { Icon: SkipForward, tone: 'text-[#94A3B8]', label: 'Skipped' },
};

const RUN_BADGE = {
  running: 'bg-blue-50 text-[#1C58F6] border-blue-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

function rowsText(t) {
  if (t.status === 'skipped') return '—';
  if (t.status === 'waiting') return '—';
  const parts = [`${(t.rowsLoaded || 0).toLocaleString()} new`];
  if (t.rowsUpdated) parts.push(`${t.rowsUpdated.toLocaleString()} updated`);
  return parts.join(' · ');
}

export function CdcRunProgress({ run }) {
  if (!run) return null;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
          {run.status === 'running' && <Loader2 className="w-4 h-4 text-[#1C58F6] animate-spin" />}
          {run.status === 'running' ? 'Running…' : `Run #${run.runId}`}
        </h3>
        <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-md border ${RUN_BADGE[run.status] || RUN_BADGE.running}`}>
          {run.status}
        </span>
      </div>
      <table className="w-full text-left">
        <tbody>
          {run.tables.map((t) => {
            const st = STATUS[t.status] || STATUS.waiting;
            return (
              <tr key={t.table} className="border-b border-[#F1F5F9] last:border-0">
                <td className="px-5 py-2.5 w-8">
                  <st.Icon className={`w-4 h-4 ${st.tone} ${st.spin ? 'animate-spin' : ''}`} />
                </td>
                <td className="py-2.5 text-[12.5px] font-semibold text-[#0F172A] font-mono">{t.table}</td>
                <td className="py-2.5 text-[12px] text-[#475569]">{APPROACH_LABELS[t.approach] || t.approach}</td>
                <td className="py-2.5 text-[12px] text-[#475569]">
                  {t.status === 'reading' || t.status === 'loading' ? st.label : rowsText(t)}
                  {t.error && <p className="text-[11px] text-rose-600 mt-0.5 max-w-xl break-words">{t.error}</p>}
                </td>
                <td className="px-5 py-2.5 text-[12px] text-[#64748B] font-mono text-right">
                  {t.seconds != null ? `${t.seconds}s` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {run.error && (
        <p className="px-5 py-3 text-[12px] text-rose-700 bg-rose-50 border-t border-rose-100">{run.error}</p>
      )}
    </div>
  );
}

export function CdcRunHistory({ runs }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#E2E8F0]">
        <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
          <History className="w-4 h-4 text-[#10338D]" /> Run History
        </h3>
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-6 text-[12px] text-[#94A3B8]">No runs yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#E2E8F0] text-[11px] font-bold uppercase text-[#64748B]">
              <th className="px-5 py-2">Run</th>
              <th className="py-2">Started</th>
              <th className="py-2">Status</th>
              <th className="py-2">Tables</th>
              <th className="py-2">Rows</th>
              <th className="px-5 py-2 text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0 text-[12px] text-[#334155]">
                <td className="px-5 py-2.5 font-semibold">#{r.id}</td>
                <td className="py-2.5">{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                <td className="py-2.5">
                  <span className={`text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded border ${RUN_BADGE[r.status] || ''}`}>
                    {r.status}
                  </span>
                  {r.error && <p className="text-[11px] text-rose-600 mt-0.5 max-w-sm truncate" title={r.error}>{r.error}</p>}
                </td>
                <td className="py-2.5">{r.tablesProcessed ?? '—'}</td>
                <td className="py-2.5 font-mono">
                  {(r.rowsLoaded || 0).toLocaleString()} new
                  {r.rowsUpdated ? ` · ${r.rowsUpdated.toLocaleString()} updated` : ''}
                </td>
                <td className="px-5 py-2.5 font-mono text-right">{r.durationSecs != null ? `${r.durationSecs}s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default CdcRunProgress;
