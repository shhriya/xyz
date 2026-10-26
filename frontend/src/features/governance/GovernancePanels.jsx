import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  Database,
  Droplets,
  GitBranch,
  Layers,
  Search,
  ShieldCheck,
  Tag,
  Timer,
  TrendingUp,
  X,
  XCircle,
  Zap
} from 'lucide-react';

// Panels are rendered from GOV_KPI_DEFINITIONS + V_GOV_KPI_* view rows; styling mirrors the original dbt dashboard.

const ICONS = { Activity, AlertTriangle, BarChart3, BookOpen, Briefcase, CheckCircle2, Clock, Database, Droplets, GitBranch, Layers, ShieldCheck, Tag, Timer, TrendingUp, XCircle, Zap };
const PALETTE = ['#1C58F6', '#10338D', '#FF3C00', '#071339', '#6366F1', '#16A34A', '#F59E0B', '#EC4899'];
const TOOLTIP_STYLE = { backgroundColor: '#FFF', borderColor: '#E2E8F0', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };

const humanize = (col) => col.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function statusTone(value) {
  const v = String(value ?? '').toLowerCase();
  if (/(success|pass|ok|fresh|healthy|complete)/.test(v)) return 'success';
  if (/(error|fail|stale|critical|high)/.test(v)) return 'error';
  if (/(warn|cancel|skip|medium|upstream|retry)/.test(v)) return 'warn';
  if (/(running|queued|starting|progress|scheduled)/.test(v)) return 'running';
  return 'neutral';
}

const TONE_COLORS = { success: '#16A34A', error: '#DC2626', warn: '#D97706', running: '#3B82F6', neutral: '#6B7280' };

function formatValue(value, unit) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') {
    const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return unit ? `${formatted}${unit}` : formatted;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value.replace('T', ' ').substring(0, 16);
  }
  return unit && !isNaN(Number(value)) ? `${value}${unit}` : String(value);
}

function colorFor(label, index) {
  const tone = statusTone(label);
  return tone === 'neutral' ? PALETTE[index % PALETTE.length] : TONE_COLORS[tone];
}

function PanelShell({ panel, children, className = '' }) {
  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl p-5 shadow-xs flex flex-col ${className}`}>
      <h3 className="text-sm font-bold text-[#1E1E1E] mb-0.5">{panel.label}</h3>
      {panel.description && (
        <p className="text-[11px] font-medium mb-3" style={{ color: panel.display?.accent || '#666666' }}>{panel.description}</p>
      )}
      {panel.error ? (
        <div className="p-3 rounded-xl border text-xs flex items-center space-x-2 bg-[#FEF2F2] border-[#FECACA] text-[#DC2626] mt-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="truncate">KPI view failed: {panel.error}</span>
        </div>
      ) : children}
    </div>
  );
}

function EmptyChart({ icon: Icon = BarChart3, message = 'No data recorded' }) {
  return (
    <div className="h-56 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#E2E8F0] rounded-xl bg-[#F8F9FC]">
      <Icon className="w-8 h-8 text-[#94A3B8] mb-2" />
      <p className="text-xs font-bold text-[#1E1E1E]">{message}</p>
    </div>
  );
}

export function KpiCardGrid({ panels }) {
  if (!panels.length) return null;
  // auto-fit keeps the row full whatever the KPI count is, instead of leaving a fixed
  // number of columns with a gap at the end
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
      {panels.map((panel) => {
        const KIcon = ICONS[panel.display?.icon] || Activity;
        const row = panel.rows?.[0] || {};
        const value = panel.error ? '—' : formatValue(row.VALUE ?? Object.values(row)[0], panel.unit);
        return (
          <div key={panel.kpi_name} title={panel.description || panel.label} className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-all">
            <KIcon className="w-4 h-4 mb-2" style={{ color: panel.display?.color || '#1C58F6' }} />
            <div className="text-xl font-black text-[#1E1E1E] font-mono tracking-tight">{value}</div>
            <div className="text-[11px] text-[#666666] font-medium mt-0.5">{panel.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function LinePanel({ panel }) {
  const xKey = panel.columns?.[0] || 'X';
  const series = (panel.columns || []).slice(1);
  const gradientId = `grad_${panel.kpi_name}`;
  return (
    <PanelShell panel={panel}>
      {panel.rows?.length ? (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={panel.rows} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s} id={`${gradientId}_${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey={xKey} stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(v)} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} unit={panel.unit || undefined} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#1E1E1E', fontWeight: 'bold' }} labelFormatter={(v) => formatValue(v)} />
              {series.map((s, i) => (
                <Area key={s} type="monotone" dataKey={s} name={humanize(s)} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} fillOpacity={1} fill={`url(#${gradientId}_${i})`} dot={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <EmptyChart icon={TrendingUp} />}
    </PanelShell>
  );
}

function DonutPanel({ panel }) {
  const data = (panel.rows || []).map((r, i) => ({ name: String(r.LABEL ?? '(none)'), value: Number(r.VALUE) || 0, color: colorFor(r.LABEL, i) })).filter((d) => d.value > 0);
  return (
    <PanelShell panel={panel}>
      {data.length ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="45%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8}
                formatter={(val) => <span className="text-[11px] text-[#666666] font-medium">{val}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : <EmptyChart icon={Activity} />}
    </PanelShell>
  );
}

function BarPanel({ panel }) {
  const data = (panel.rows || []).map((r, i) => ({ label: String(r.LABEL ?? '(none)'), value: Number(r.VALUE) || 0, color: colorFor(r.LABEL, i) }));
  const horizontal = panel.display?.orientation === 'horizontal';
  const axisProps = { stroke: '#64748B', fontSize: 11, tickLine: false, axisLine: { stroke: '#E2E8F0' } };
  return (
    <PanelShell panel={panel}>
      {data.length ? (
        <div className="h-64 w-full min-h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            {horizontal ? (
              <BarChart layout="vertical" data={data} margin={{ top: 10, right: 25, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" {...axisProps} tick={{ fill: '#475569', fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="label" type="category" {...axisProps} fontSize={10} width={115} tick={{ fill: '#1E293B', fontSize: 10, fontWeight: 500 }} interval={0} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(28, 88, 246, 0.05)' }} />
                <Bar dataKey="value" name={panel.unit || 'Value'} fill="#1C58F6" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            ) : (
              <BarChart data={data} margin={{ top: 15, right: 20, left: 0, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="label" {...axisProps} tick={{ fill: '#475569', fontSize: 11 }} interval={0} />
                <YAxis {...axisProps} tick={{ fill: '#475569', fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(28, 88, 246, 0.05)' }} />
                <Bar dataKey="value" name={panel.unit || 'Value'} fill="#1C58F6" radius={[4, 4, 0, 0]} maxBarSize={45}>
                  {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : <EmptyChart icon={ShieldCheck} />}
    </PanelShell>
  );
}

function StatusCell({ value }) {
  const tone = statusTone(value);
  const Icon = { success: CheckCircle2, error: XCircle, warn: AlertTriangle, running: Clock, neutral: Clock }[tone];
  return (
    <span className="inline-flex items-center space-x-1 text-[11px] font-bold" style={{ color: tone === 'neutral' ? '#94A3B8' : TONE_COLORS[tone] }}>
      <Icon className="w-3.5 h-3.5" />
      <span>{value ?? 'Unknown'}</span>
    </span>
  );
}

function CodeModal({ title, subtitle, code, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#ECEFFF] border border-[#D1DEFF] text-[#10338D] flex items-center justify-center">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1E1E1E] font-mono">{title}</h3>
              {subtitle && <p className="text-xs text-[#666666] font-mono">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="bg-[#10338D] hover:bg-[#1C58F6] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              {copied ? <><Check className="w-3.5 h-3.5" /><span>Copied!</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy SQL</span></>}
            </button>
            <button onClick={onClose} className="text-[#94A3B8] hover:text-[#1E1E1E] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition-colors cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="bg-[#0F172A] border border-[#334155] rounded-xl p-4 overflow-x-auto max-h-96">
          {code ? (
            <pre className="text-xs font-mono text-emerald-300 leading-relaxed whitespace-pre-wrap">{code}</pre>
          ) : (
            <p className="text-xs font-mono text-[#64748B] italic">No SQL available for this record.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TablePanel({ panel }) {
  const [search, setSearch] = useState('');
  const [codeRow, setCodeRow] = useState(null);
  const rows = panel.rows || [];
  const columns = panel.columns || [];

  const codeColumns = useMemo(() => (panel.columns || []).filter((c) =>
    /(SQL|CODE)$/.test(c) || (panel.rows || []).some((r) => typeof r[c] === 'string' && r[c].length > 300)
  ), [panel.columns, panel.rows]);
  const visibleColumns = columns.filter((c) => !codeColumns.includes(c));
  const isStatusCol = (c) => /(STATUS|STATE|RESULT)$/.test(c);
  const isBadgeCol = (c) => /(SEVERITY|PRIORITY|TYPE|TRIGGER|LAYER)$/.test(c);

  const filtered = search
    ? rows.filter((r) => visibleColumns.some((c) => String(r[c] ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows;

  return (
    <PanelShell panel={panel}>
      {rows.length > 10 && (
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Search ${panel.label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#F8F9FC] border border-[#E2E8F0] rounded-lg pl-10 pr-4 py-2.5 text-xs text-[#1E1E1E] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1C58F6]/20 focus:border-[#1C58F6] transition-colors"
          />
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-center text-xs text-[#94A3B8] p-6 border border-dashed border-[#E2E8F0] rounded-xl bg-[#F8F9FC]">No records</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[#666666] text-[11px] uppercase tracking-wider font-semibold">
                {visibleColumns.map((c) => <th key={c} className="py-2.5 px-3 whitespace-nowrap">{humanize(c)}</th>)}
                {codeColumns.length > 0 && <th className="py-2.5 px-3 text-right"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {filtered.map((r, idx) => (
                <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                  {visibleColumns.map((c, cIdx) => (
                    <td key={c} className="py-3 px-3 max-w-xs">
                      {isStatusCol(c) ? (
                        <StatusCell value={r[c]} />
                      ) : isBadgeCol(c) && r[c] ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ECEFFF] text-[#1C58F6] border border-[#D1DEFF] uppercase whitespace-nowrap">{r[c]}</span>
                      ) : cIdx === 0 ? (
                        <span className="font-mono font-bold text-[#1C58F6] text-xs">{formatValue(r[c])}</span>
                      ) : (
                        <span className={`font-mono text-[#666666] ${/DESCRIPTION|MESSAGE/.test(c) ? 'line-clamp-2 font-sans' : 'truncate block'}`}>{formatValue(r[c])}</span>
                      )}
                    </td>
                  ))}
                  {codeColumns.length > 0 && (
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => setCodeRow(r)}
                        className="inline-flex items-center space-x-1 text-[11px] font-bold text-[#10338D] bg-white border border-[#D1DEFF] hover:bg-[#ECEFFF] px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <Code className="w-3 h-3" />
                        <span>View SQL</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {codeRow && (
        <CodeModal
          title={String(codeRow[visibleColumns[0]] ?? panel.label)}
          subtitle={codeColumns.map(humanize).join(', ')}
          code={codeColumns.map((c) => codeRow[c]).filter(Boolean).join('\n\n')}
          onClose={() => setCodeRow(null)}
        />
      )}
    </PanelShell>
  );
}

function RecommendationPanel({ panel }) {
  const rows = panel.rows || [];
  return (
    <div>
      <h3 className="text-sm font-bold text-[#1E1E1E] mb-4">{panel.label}</h3>
      {panel.error ? <PanelShell panel={{ ...panel, label: '' }} /> : !rows.length ? (
        <EmptyChart icon={Zap} message="No optimization recommendations for this source yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {rows.map((rec, idx) => (
            <div key={idx} className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-xs space-y-2">
              <span className={`inline-block text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
                rec.PRIORITY === 'HIGH' ? 'bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]' :
                rec.PRIORITY === 'MEDIUM' ? 'bg-[#FFF7ED] text-[#D97706] border border-[#FED7AA]' :
                'bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0]'
              }`}>
                {rec.PRIORITY}
              </span>
              <h4 className="font-bold text-xs text-[#1E1E1E]">{rec.TITLE}</h4>
              <p className="text-[11px] text-[#666666] leading-relaxed">{rec.DESCRIPTION}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const RENDERERS = { line: LinePanel, donut: DonutPanel, bar: BarPanel, table: TablePanel, recommendation: RecommendationPanel };
const FULL_WIDTH_TYPES = new Set(['table', 'recommendation']);

/**
 * Charts sit two per row; tables and recommendations always take the whole row.
 * A chart with no neighbour to pair with is widened to the full row, so a tab that
 * holds a single chart never renders it against a band of empty space.
 */
function spanClasses(panels) {
  return panels.map((panel, idx) => {
    if (FULL_WIDTH_TYPES.has(panel.chart_type)) return 'lg:col-span-2';
    // Position within the current run of charts (a full-width panel starts a new run).
    let offset = 0;
    for (let i = idx - 1; i >= 0 && !FULL_WIDTH_TYPES.has(panels[i].chart_type); i--) offset++;
    if (offset % 2 === 1) return 'lg:col-span-1'; // second chart of a pair
    const next = panels[idx + 1];
    const hasPartner = next && !FULL_WIDTH_TYPES.has(next.chart_type);
    return hasPartner ? 'lg:col-span-1' : 'lg:col-span-2';
  });
}

export function PanelGrid({ panels }) {
  const renderable = panels.filter((p) => RENDERERS[p.chart_type]);
  if (!renderable.length) return null;
  const spans = spanClasses(renderable);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {renderable.map((panel, idx) => {
        const Renderer = RENDERERS[panel.chart_type];
        return (
          <div key={panel.kpi_name} className={spans[idx]}>
            <Renderer panel={panel} />
          </div>
        );
      })}
    </div>
  );
}
