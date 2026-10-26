import React from 'react';
import { CreditCard, Clock, CheckCircle2, AlertOctagon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Page4Gateway({ data }) {
  if (!data) return null;
  const visuals = data.visuals || {};

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
          <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">
            <CreditCard className="w-4 h-4 text-[#1C58F6]" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Connected Gateways</p>
            <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{data.kpis?.active_gateways ?? visuals.performance?.length ?? 0}</h4>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
          <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Settled Volume</p>
            <h4 className="text-xl font-black text-[#0F172A] tracking-tight">
              {Number(data.kpis?.settled_volume || 0) >= 1000000 
                ? `$${(Number(data.kpis?.settled_volume || 0) / 1000000).toFixed(2)}M` 
                : `$${Number(data.kpis?.settled_volume || 0).toLocaleString()}`}
            </h4>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
          <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Avg Latency</p>
            <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{Number(data.kpis?.avg_latency || 0).toFixed(0)} ms</h4>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
          <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Discrepancies</p>
            <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{data.kpis?.discrepancies_count ?? visuals.discrepancies?.length ?? 0}</h4>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Gateway Performance */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9]">
            <h3 className="font-bold text-[#0F172A] text-sm">Processor Performance & Success Rate</h3>
            <p className="text-[11px] text-[#64748B]">Authorization success percentage vs processing fee</p>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visuals.performance || []} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="gateway_name" tick={{fontSize: 11, fill: '#64748B'}} />
                <YAxis yAxisId="left" domain={[90, 100]} tick={{fontSize: 10, fill: '#64748B'}} />
                <YAxis yAxisId="right" orientation="right" tick={{fontSize: 10, fill: '#64748B'}} tickFormatter={(v) => `$${v/1000}k`} />
                <RechartsTooltip contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar yAxisId="left" dataKey="success_rate" name="Success %" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="total_fees" name="Total Fees ($)" fill="#1C58F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Settlement Discrepancies */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-[#0F172A] text-sm">Settlement Audit & Discrepancies</h3>
              <p className="text-[11px] text-[#64748B]">Clearing variances and pending reconciliations</p>
            </div>
            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
              Audit Flagged
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F8FAFC] text-[#64748B] text-[11px] uppercase font-bold border-b border-[#E2E8F0]">
                <tr>
                  <th className="px-4 py-2.5">Batch ID</th>
                  <th className="px-4 py-2.5">Gateway</th>
                  <th className="px-4 py-2.5">Variance</th>
                  <th className="px-4 py-2.5">Reason</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {(visuals.discrepancies || []).map((d, i) => (
                  <tr key={i} className="hover:bg-[#F8FAFC]">
                    <td className="px-4 py-2.5 font-mono font-bold text-[#10338D]">{d.batch_id}</td>
                    <td className="px-4 py-2.5 text-[#0F172A] font-medium">{d.gateway_name}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-rose-600">${Number(d.discrepancy_amount).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-[#64748B]">{d.reason}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        {d.settlement_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
