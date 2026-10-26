import React from 'react';
import { Users, UserCheck, ShieldAlert, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const COLORS = ['#1C58F6', '#10338D', '#10B981', '#F59E0B', '#EF4444'];

export default function Page2Customer({ data }) {
  if (!data) return null;
  const visuals = data.visuals || {};

  const kpis = [
    { label: 'Total Customers', value: (data.kpis?.total_customers ?? 0).toLocaleString(), icon: <Users className="w-4 h-4 text-[#1C58F6]" /> },
    { label: 'Verified KYC', value: `${data.kpis?.kyc_rate ?? 0}%`, icon: <UserCheck className="w-4 h-4 text-emerald-600" /> },
    { label: 'High Risk Accounts', value: String(data.kpis?.high_risk_count ?? visuals.high_risk_accounts?.length ?? 0), icon: <ShieldAlert className="w-4 h-4 text-rose-600" /> },
    { label: 'Avg Risk Score', value: String(data.kpis?.avg_risk_score ?? 0), icon: <Activity className="w-4 h-4 text-amber-600" /> }
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {kpis.map((k, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-2xs border border-[#E2E8F0] flex items-center space-x-3.5">
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl shrink-0">{k.icon}</div>
            <div>
              <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">{k.label}</p>
              <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{k.value}</h4>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Segmentation */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9]">
            <h3 className="font-bold text-[#0F172A] text-sm">Customer Segmentation</h3>
            <p className="text-[11px] text-[#64748B]">Accounts grouped by business classification</p>
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={visuals.segmentation || []} 
                  dataKey="count" 
                  nameKey="customer_segment" 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={55} 
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {(visuals.segmentation || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {(visuals.segmentation || []).map((entry, idx) => (
              <div key={idx} className="flex items-center space-x-1.5 text-xs text-[#334155]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                <span>{entry.customer_segment}: <strong>{entry.count?.toLocaleString()}</strong></span>
              </div>
            ))}
          </div>
        </div>

        {/* KYC Status */}
        <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
          <div className="mb-4 pb-3 border-b border-[#F1F5F9]">
            <h3 className="font-bold text-[#0F172A] text-sm">KYC Verification Status</h3>
            <p className="text-[11px] text-[#64748B]">Compliance and identity documentation verification</p>
          </div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visuals.kyc_status || []} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" tick={{fontSize: 10, fill: '#64748B'}} />
                <YAxis dataKey="kyc_status" type="category" tick={{fontSize: 11, fill: '#0F172A'}} width={90} />
                <RechartsTooltip contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontSize: '11px' }} />
                <Bar dataKey="count" fill="#1C58F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* High Risk Table */}
      <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0]">
        <div className="mb-4 pb-3 border-b border-[#F1F5F9] flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#0F172A] text-sm">Highest Risk Accounts & Compliance Audit</h3>
            <p className="text-[11px] text-[#64748B]">Accounts with risk score exceeding internal compliance threshold</p>
          </div>
          <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
            Flagged Review Required
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F8FAFC] text-[#64748B] text-[11px] uppercase font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="px-4 py-2.5">Customer Name</th>
                <th className="px-4 py-2.5">Risk Score</th>
                <th className="px-4 py-2.5">Jurisdiction</th>
                <th className="px-4 py-2.5">Account Status</th>
                <th className="px-4 py-2.5">KYC Document</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {(visuals.high_risk_accounts || []).map((acct, i) => (
                <tr key={i} className="hover:bg-[#F8FAFC]">
                  <td className="px-4 py-2.5 font-bold text-[#0F172A]">{acct.customer_name}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-800 font-mono font-bold rounded">
                      {acct.risk_score} / 100
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#64748B]">{acct.country}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      acct.account_status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {acct.account_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#334155] font-medium">{acct.kyc_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
