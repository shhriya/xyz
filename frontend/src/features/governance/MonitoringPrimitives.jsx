import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, ShieldAlert } from 'lucide-react';

// Shared formatting and small display pieces for the monitoring drill-down, summary strip and
// regression panel.
//
// Colours are explicit hex throughout, never Tailwind's slate/emerald utility classes: index.css
// remaps that scale for the white theme (--color-slate-800 resolves to a near-white), so
// `text-slate-800` renders invisible here.

export const INK = '#0F172A';
export const MUTED = '#64748B';
export const FAINT = '#94A3B8';
export const BORDER = '#E2E8F0';
export const BRAND = '#10338D';
export const ACCENT = '#1C58F6';

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '—';
  const s = Number(sec);
  // Keep a decimal under 10s so a 0.4s baseline doesn't render as "0s".
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function formatBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  return `${(v / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export function formatCount(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

export function formatTimestamp(ts) {
  if (!ts) return '—';
  return String(ts).replace('T', ' ').substring(0, 16);
}

/** Percentage change, pre-signed, for "was X, now Y" rows. */
export function formatPctChange(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return null;
  const v = Number(pct);
  return `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
}

const STATUS_TONES = {
  success: { bg: '#ECFDF5', border: '#A7F3D0', text: '#047857' },
  pass: { bg: '#ECFDF5', border: '#A7F3D0', text: '#047857' },
  error: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
  fail: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
  failed: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' },
  cancelled: { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  canceled: { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  running: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  starting: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8' },
  queued: { bg: '#F8FAFC', border: BORDER, text: MUTED },
  skipped: { bg: '#F8FAFC', border: BORDER, text: MUTED }
};

export function StatusPill({ status, className = '' }) {
  if (!status) return <span className="text-[11px]" style={{ color: FAINT }}>—</span>;
  const tone = STATUS_TONES[String(status).toLowerCase()] || { bg: '#F8FAFC', border: BORDER, text: MUTED };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${className}`}
      style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.text }}
    >
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  const high = severity === 'HIGH';
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border"
      style={high
        ? { backgroundColor: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }
        : { backgroundColor: '#FFF7ED', borderColor: '#FED7AA', color: '#C2410C' }}
    >
      {high ? 'High' : 'Medium'}
    </span>
  );
}

/** "was 5.0s → now 20.0s  +300%" — the before/after the requirements ask to show explicitly. */
export function BeforeAfter({ before, after, format = formatDuration, pctChange, label }) {
  const pct = formatPctChange(pctChange);
  const worse = pctChange != null && Number(pctChange) > 0;
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      {label && <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>{label}</span>}
      <span className="text-[11.5px] font-mono" style={{ color: MUTED }}>{format(before)}</span>
      <span className="text-[11px]" style={{ color: FAINT }}>&rarr;</span>
      <span className="text-[12.5px] font-mono font-bold" style={{ color: INK }}>{format(after)}</span>
      {pct && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={worse
            ? { backgroundColor: '#FEF2F2', color: '#B91C1C' }
            : { backgroundColor: '#ECFDF5', color: '#047857' }}
        >
          {pct}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, detail, children }) {
  return (
    <div
      className="bg-white rounded-2xl p-10 flex flex-col items-center justify-center text-center space-y-3 shadow-xs border"
      style={{ borderColor: BORDER }}
    >
      {Icon && (
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center border"
          style={{ backgroundColor: '#ECEFFF', borderColor: '#D1DEFF' }}
        >
          <Icon className="w-6 h-6" style={{ color: BRAND }} />
        </div>
      )}
      <div>
        <h3 className="text-sm font-bold" style={{ color: INK }}>{title}</h3>
        {detail && <p className="text-[11.5px] mt-1 max-w-md leading-relaxed" style={{ color: MUTED }}>{detail}</p>}
      </div>
      {children}
    </div>
  );
}

export function InfoNote({ children, tone = 'info' }) {
  const tones = {
    info: { bg: '#F8FAFC', border: BORDER, text: MUTED },
    warn: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E' }
  };
  const t = tones[tone] || tones.info;
  return (
    <div
      className="rounded-xl px-3 py-2 text-[11px] leading-relaxed border flex items-start gap-2"
      style={{ backgroundColor: t.bg, borderColor: t.border, color: t.text }}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export function SqlBlock({ sql, maxHeight = 'max-h-64' }) {
  const [copied, setCopied] = useState(false);
  if (!sql) return null;
  return (
    <div className="space-y-1.5">
      <div
        className={`rounded-xl p-3 overflow-x-auto ${maxHeight} border`}
        style={{ backgroundColor: INK, borderColor: '#334155' }}
      >
        <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all" style={{ color: '#A7F3D0' }}>
          {sql}
        </pre>
      </div>
      <button
        onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors bg-white border"
        style={{ color: BRAND, borderColor: '#D1DEFF' }}
      >
        {copied ? <><Check className="w-3 h-3" /><span>Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy SQL</span></>}
      </button>
    </div>
  );
}

/** The AI optimiser's result: rejected-unsafe banner, SQL, verification state, explanation. */
export function OptimizedSqlBlock({ result }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  if (result.status === 'error') {
    return <div className="mt-3"><InfoNote tone="warn">{result.message}</InfoNote></div>;
  }
  return (
    <div className="mt-3 space-y-2.5">
      {!result.isSafeSelect && (
        <div
          className="p-2.5 rounded-lg text-[11px] flex items-start gap-2 border"
          style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            The AI suggestion was rejected as unsafe ({result.safetyError}) and is shown for
            reference only — do not run it.
          </span>
        </div>
      )}
      <div
        className="rounded-xl p-3 overflow-x-auto max-h-64 border"
        style={{ backgroundColor: INK, borderColor: '#334155' }}
      >
        {result.optimizedSql ? (
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all" style={{ color: '#6EE7B7' }}>
            {result.optimizedSql}
          </pre>
        ) : (
          <p className="text-[11px] font-mono italic" style={{ color: MUTED }}>No optimized SQL returned.</p>
        )}
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        {result.verified ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border"
            style={{ backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', color: '#047857' }}
          >
            <Check className="w-3 h-3" /> Compiles (EXPLAIN-verified, not executed)
          </span>
        ) : result.verificationError ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border"
            style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}
            title={result.verificationError}
          >
            <AlertTriangle className="w-3 h-3" /> Failed to compile
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: FAINT }}>Not verified against Snowflake</span>
        )}
        <div className="flex items-center gap-2">
          {result.executionStatsUsed && (
            <span className="text-[10px] font-semibold" style={{ color: '#047857' }}>
              Grounded in real execution statistics
            </span>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(result.optimizedSql || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            disabled={!result.optimizedSql}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors disabled:opacity-40 bg-white border"
            style={{ color: BRAND, borderColor: '#D1DEFF' }}
          >
            {copied ? <><Check className="w-3 h-3" /><span>Copied</span></> : <><Copy className="w-3 h-3" /><span>Copy SQL</span></>}
          </button>
        </div>
      </div>
      {result.explanation && (
        <div
          className="text-[11px] leading-relaxed rounded-lg p-3 whitespace-pre-wrap border"
          style={{ backgroundColor: '#F8FAFC', borderColor: BORDER, color: '#334155' }}
        >
          {result.explanation}
        </div>
      )}
      {result.keyChanges?.length > 0 && (
        <ul className="space-y-1 pl-1">
          {result.keyChanges.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: '#334155' }}>
              <span className="font-black leading-none mt-0.5" style={{ color: BRAND }}>&bull;</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      {result.caution && <p className="text-[10px] italic" style={{ color: FAINT }}>{result.caution}</p>}
    </div>
  );
}
