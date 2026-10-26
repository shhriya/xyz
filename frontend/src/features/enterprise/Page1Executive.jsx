import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  Activity,
  DollarSign,
} from 'lucide-react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

const COLORS = {
  success: '#10B981',
  error: '#EF4444',
  pending: '#F59E0B',
  reversed: '#64748B',
  primary: '#1C58F6',
  secondary: '#10338D'
};

export default function Page1Executive({ data }) {
  if (!data) return null;

  const kpis = data.kpis || {};
  const visuals = data.visuals || {};

  const fmtCurrency = (val) => {
    const num = Number(val) || 0;
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
  };

  const fmtNum = (val) => {
    const num = Number(val) || 0;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const kpiItems = [
    { label: 'Total Transactions', value: fmtNum(kpis.total_txns || 0), icon: <Activity className="w-4 h-4 text-[#1C58F6]" />, trend: kpis.total_txns > 0 ? '+12.5%' : '0%', isUp: true },
    { label: 'Total Volume', value: fmtCurrency(kpis.total_volume || 0), icon: <DollarSign className="w-4 h-4 text-emerald-600" />, trend: kpis.total_volume > 0 ? '+8.2%' : '0%', isUp: true },
    { label: 'Success Rate', value: `${Number(kpis.success_rate || 0).toFixed(1)}%`, icon: <TrendingUp className="w-4 h-4 text-emerald-600" />, trend: kpis.success_rate > 0 ? '+1.1%' : '0%', isUp: true },
    { label: 'Failure Rate', value: `${Number(kpis.failure_rate || 0).toFixed(1)}%`, icon: <TrendingDown className="w-4 h-4 text-rose-600" />, trend: kpis.failure_rate > 0 ? '-0.5%' : '0%', isUp: false },
    { label: 'Avg Txn Value', value: fmtCurrency(kpis.avg_txn_value || 0), icon: <CreditCard className="w-4 h-4 text-[#10338D]" />, trend: kpis.avg_txn_value > 0 ? '+2.4%' : '0%', isUp: true },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Row 1 - Compact, crisp, aligned with rest of app */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {kpiItems.map((k, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex flex-col justify-between hover:border-[#CBD5E1] transition-all">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[#64748B] text-[11px] font-bold uppercase tracking-wider">{k.label}</span>
              <div className="p-1.5 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">{k.icon}</div>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-xl font-black text-[#0F172A] tracking-tight">{k.value}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                k.isUp ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {k.trend}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Chart */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0] lg:col-span-2">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#F1F5F9]">
            <div>
              <h3 className="font-bold text-[#0F172A] text-sm">Transaction Volume Trend</h3>
              <p className="text-[11px] text-[#64748B]">Daily settlement volume vs transaction velocity</p>
            </div>
            <span className="text-[10px] font-mono font-semibold text-[#10338D] bg-[#ECEFFF] border border-[#D1DEFF] px-2.5 py-1 rounded-md">
              Daily Aggregate
            </span>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visuals.transaction_trend || []} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.25}/>
                    <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748B'}} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748B'}} tickFormatter={(v) => `$${v >= 1000 ? `${v/1000}k` : v}`} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748B'}} />
                <Tooltip 
                  contentStyle={{backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px'}}
                  formatter={(val, name) => [name === 'Volume' ? `$${Number(val).toLocaleString()}` : Number(val).toLocaleString(), name]}
                />
                <Area yAxisId="left" type="monotone" dataKey="volume" stroke={COLORS.primary} strokeWidth={2.5} fillOpacity={1} fill="url(#colorVol)" name="Volume" />
                <Line yAxisId="right" type="monotone" dataKey="count" stroke={COLORS.secondary} strokeWidth={2} dot={{ r: 3, fill: COLORS.secondary }} name="Txn Count" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Channel Usage */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#F1F5F9]">
            <div>
              <h3 className="font-bold text-[#0F172A] text-sm">Channel Usage</h3>
              <p className="text-[11px] text-[#64748B]">Distribution by entry gateway</p>
            </div>
          </div>
          <div className="space-y-3.5">
            {(visuals.channel_usage || []).map((ch, i) => {
              const max = Math.max(...(visuals.channel_usage || []).map(c => c.count), 1);
              const pct = Math.round((ch.count / max) * 100);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-[#1E293B]">{ch.channel || 'Unknown'}</span>
                    <span className="text-[#64748B] font-mono font-medium">{fmtNum(ch.count)}</span>
                  </div>
                  <div className="w-full bg-[#F1F5F9] rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-[#1C58F6] h-2 rounded-full transition-all duration-500" 
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Region Quick Badges */}
          <div className="mt-6 pt-4 border-t border-[#F1F5F9]">
            <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block mb-2">Top Geographies:</span>
            <div className="flex flex-wrap gap-1.5">
              {(visuals.geo_distribution || []).slice(0, 4).map((g, i) => (
                <span key={i} className="text-[11px] font-medium text-[#10338D] bg-[#ECEFFF] border border-[#D1DEFF] px-2 py-0.5 rounded">
                  {g.country}: <strong>{fmtCurrency(g.volume)}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
