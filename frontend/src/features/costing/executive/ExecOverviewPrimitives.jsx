import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Info, ChevronUp, ChevronDown, Search } from 'lucide-react';

/* Shared primitives for the Executive Cost Overview.
   This app remaps Tailwind's slate scale for a white theme, so colours are explicit hex. */
export const INK = 'text-[#0F172A]';
export const BODY = 'text-[#334155]';
export const MUTED = 'text-[#64748B]';
export const CARD = 'bg-white border border-[#E2E8F0] rounded-2xl';
export const BRAND = '#10338D';
export const ACCENT = '#1C58F6';
export const SERIES = ['#1C58F6', '#10338D', '#FF3C00', '#F88B26', '#7FA2FF', '#0A225E'];

export function fmtMoney(v, currency = 'USD') {
  const n = Number(v) || 0;
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const body = Math.abs(n) >= 1000000 ? `${(n / 1000000).toFixed(2)}M`
    : Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}K`
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return sym ? `${sym}${body}` : `${body} ${currency}`;
}

export function fmtNum(v, digits = 0) {
  const n = Number(v) || 0;
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001';
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** A value that genuinely cannot be derived from the connected account. Rendered as an explicit
 *  "not available" rather than a zero, so nothing here can be mistaken for real data. */
export function NotAvailable({ reason }) {
  return (
    <span className="inline-flex items-center gap-1 text-[#94A3B8]" title={reason}>
      <span className="text-[15px] font-bold">&mdash;</span>
      <Info className="w-3 h-3" />
    </span>
  );
}

export function Sparkline({ points = [], color = ACCENT, height = 24 }) {
  const vals = points.map((p) => Number(p) || 0);
  if (vals.length < 2) return <div style={{ height }} />;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  const w = 100;
  const step = w / (vals.length - 1);
  const d = vals.map((v, i) =>
    `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(height - ((v - min) / span) * height).toFixed(2)}`
  ).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** KPI card. `deltaPct` renders only when a real previous-period figure exists. */
export function KpiCard({ label, value, unit, icon: Icon, deltaPct, invertDelta = true, spark, footnote, unavailable }) {
  const hasDelta = typeof deltaPct === 'number' && Number.isFinite(deltaPct);
  const up = hasDelta && deltaPct > 0;
  const flat = hasDelta && Math.abs(deltaPct) < 0.5;
  // For cost metrics a rise is bad; invertDelta=false flips it for "good when up" metrics.
  const bad = invertDelta ? up : !up;
  const tone = !hasDelta || flat ? 'text-[#64748B]' : bad ? 'text-[#DC2626]' : 'text-[#059669]';
  const DeltaIcon = !hasDelta || flat ? Minus : up ? TrendingUp : TrendingDown;

  return (
    <div className={`${CARD} p-4 flex flex-col justify-between gap-2 hover:border-[#1C58F6]/40 hover:shadow-sm transition-all`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-[10px] font-bold uppercase tracking-wide ${MUTED} leading-tight`}>{label}</p>
        {Icon && <Icon className="w-4 h-4 text-[#94A3B8] shrink-0" />}
      </div>
      <div className={`text-[19px] font-black ${INK} font-mono tracking-tight leading-none`}>
        {unavailable
          ? <NotAvailable reason={unavailable} />
          : <>{value}{unit && <span className={`text-[12px] ml-0.5 ${MUTED}`}>{unit}</span>}</>}
      </div>
      {!unavailable && spark?.length > 1 && <Sparkline points={spark} />}
      <div className="flex items-center justify-between gap-2">
        {hasDelta && !unavailable ? (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${tone}`}>
            <DeltaIcon className="w-3 h-3" />{Math.abs(deltaPct).toFixed(1)}% vs prev
          </span>
        ) : (
          <span className={`text-[10px] ${MUTED}`}>{footnote || ''}</span>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
      <div>
        <h3 className={`text-[14px] font-bold ${INK}`}>{title}</h3>
        {subtitle && <p className={`text-[11px] ${MUTED} mt-0.5`}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ title, detail, icon: Icon }) {
  return (
    <div className="py-10 text-center space-y-2">
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-[#F1F5F9] text-[#94A3B8] flex items-center justify-center mx-auto">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <p className={`text-[13px] font-bold ${INK}`}>{title}</p>
      {detail && <p className={`text-[11px] ${MUTED} max-w-md mx-auto leading-relaxed`}>{detail}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#F1F5F9] rounded ${className}`} />;
}

/** Sortable, searchable, paginated table for the "Top cost consumers" section. */
export function DataTable({ columns, rows, initialSort, searchKeys = [], pageSize = 8, emptyText = 'No rows.' }) {
  const [sort, setSort] = useState(initialSort || { key: columns[0]?.key, dir: 'desc' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const filtered = !q ? rows : rows.filter((r) =>
    searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase())));

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av ?? '').localeCompare(String(bv ?? ''));
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="space-y-2">
      {searchKeys.length > 0 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search..."
            className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#CBD5E1] rounded-lg focus:outline-none focus:border-[#1C58F6] text-[#0F172A]"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E2E8F0]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                  className={`px-2.5 py-2 text-[10px] font-bold uppercase ${MUTED} whitespace-nowrap cursor-pointer select-none hover:text-[#0F172A] ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort.key === c.key && (sort.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2.5 py-2 text-[12px] ${BODY} whitespace-nowrap ${c.align === 'right' ? 'text-right font-mono' : ''}`}>
                    {c.render ? c.render(r) : String(r[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <p className={`text-[12px] ${MUTED} py-4 text-center`}>{emptyText}</p>}
      {pages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className={`text-[11px] ${MUTED}`}>Page {safePage + 1} of {pages} &middot; {sorted.length} rows</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
              className="px-2 py-1 text-[11px] font-semibold border border-[#CBD5E1] rounded disabled:opacity-40 cursor-pointer">Prev</button>
            <button onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1}
              className="px-2 py-1 text-[11px] font-semibold border border-[#CBD5E1] rounded disabled:opacity-40 cursor-pointer">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Checkbox dropdown multi-select.
 *  A native <select multiple size={1}> shows only one cropped row and a click-drag across it
 *  selects every option at once, so it is replaced with an explicit checkbox list. */
export function MultiSelect({ label, icon: Icon, options, selected, onChange, allLabel = 'All' }) {
  const [open, setOpen] = useState(false);
  const toggle = (val) =>
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);

  const summary = selected.length === 0
    ? `${allLabel} (${options.length})`
    : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="relative">
      <label className={`text-[10px] font-bold uppercase ${MUTED} flex items-center gap-1`}>
        {Icon && <Icon className="w-3 h-3" />}{label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 min-w-[170px] max-w-[230px] text-[12px] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 bg-white text-[#0F172A] cursor-pointer flex items-center justify-between gap-2 hover:border-[#1C58F6]"
      >
        <span className="truncate font-mono">{summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* click-away catcher */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 w-[240px] max-h-64 overflow-y-auto bg-white border border-[#CBD5E1] rounded-lg shadow-lg p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`w-full text-left text-[11px] font-bold px-2 py-1.5 rounded hover:bg-[#F1F5F9] ${selected.length === 0 ? 'text-[#1C58F6]' : 'text-[#64748B]'} cursor-pointer`}
            >
              {allLabel} ({options.length})
            </button>
            <div className="h-px bg-[#E2E8F0] my-1" />
            {options.length === 0 && <p className={`text-[11px] ${MUTED} px-2 py-2`}>Nothing to filter.</p>}
            {options.map((o) => (
              <label key={o} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#F1F5F9] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  onChange={() => toggle(o)}
                  className="cursor-pointer shrink-0"
                />
                <span className="text-[12px] text-[#0F172A] font-mono truncate" title={o}>{o}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
