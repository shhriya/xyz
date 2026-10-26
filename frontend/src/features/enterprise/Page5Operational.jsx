import React from 'react';
import { Activity, Search, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

export default function Page5Operational({ data }) {
  if (!data) return null;
  const visuals = data.visuals || {};

  const stats = [
    { label: 'Peak Transaction Velocity', value: data.kpis?.peak_hour || 'N/A', icon: <Activity className="w-4 h-4 text-[#1C58F6]" /> },
    { label: 'Cross-Border Volume', value: data.kpis?.cross_border_pct || '0.0%', icon: <Search className="w-4 h-4 text-[#10338D]" /> },
    { label: 'Core System Uptime', value: data.kpis?.system_uptime || '100.0%', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> }
  ];

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {stats.map((k, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">{k.icon}</div>
            <div>
              <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">{k.label}</p>
              <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{k.value}</h4>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Failure Reasons */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9]">
            <h3 className="font-bold text-[#0F172A] text-sm">Transaction Failure Classification</h3>
            <p className="text-[11px] text-[#64748B]">Root cause grouping for declined transactions</p>
          </div>
          <div className="h-[270px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visuals.failure_reasons || []} layout="vertical" margin={{ left: 50, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fontSize: 10, fill: '#64748B'}} />
                <YAxis dataKey="failure_reason" type="category" tick={{fontSize: 10, fill: '#0F172A'}} width={150} />
                <RechartsTooltip contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }} />
                <Bar dataKey="count" fill="#EF4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Currency Distribution */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9]">
            <h3 className="font-bold text-[#0F172A] text-sm">Currency Volume Distribution</h3>
            <p className="text-[11px] text-[#64748B]">Settlement distribution across active currencies</p>
          </div>
          <div className="h-[270px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visuals.currency_dist || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="currency" tick={{fontSize: 11, fill: '#64748B'}} />
                <YAxis tick={{fontSize: 10, fill: '#64748B'}} tickFormatter={(v) => `$${v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : `${(v/1000).toFixed(0)}k`}`} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }} 
                  formatter={(val) => [`$${Number(val).toLocaleString()}`, 'Volume']}
                />
                <Bar dataKey="volume" fill="#1C58F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
