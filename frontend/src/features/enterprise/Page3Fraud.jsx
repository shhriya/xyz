import React from 'react';
import { ShieldAlert, AlertTriangle, Crosshair, Lock } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ZAxis } from 'recharts';

export default function Page3Fraud({ data }) {
  if (!data) return null;
  const visuals = data.visuals || {};

  const stats = [
    { label: 'Open Alerts', value: String(data.kpis?.open_alerts ?? 0), icon: <AlertTriangle className="w-4 h-4 text-rose-600" />, badge: 'Needs Triage' },
    { label: 'Under Investigation', value: String(data.kpis?.investigating ?? 0), icon: <Crosshair className="w-4 h-4 text-amber-600" />, badge: 'In Progress' },
    { label: 'Confirmed Fraud', value: String(data.kpis?.confirmed_fraud ?? 0), icon: <Lock className="w-4 h-4 text-rose-700" />, badge: 'Blocked' },
    { label: 'False Positives', value: String(data.kpis?.false_positives ?? 0), icon: <ShieldAlert className="w-4 h-4 text-emerald-600" />, badge: 'Cleared' }
  ];

  return (
    <div className="space-y-6">
      {/* Security Operations Header & KPI cards in clean white theme */}
      <div className="bg-white rounded-xl p-5 shadow-2xs border border-[#E2E8F0] space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Security Operations & Fraud Intelligence</h2>
              <p className="text-[11px] text-[#64748B]">Real-time anomaly detection and risk scoring matrix</p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
            Real-time Threat Interceptor
          </span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {stats.map((k, i) => (
            <div key={i} className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">{k.label}</span>
                {k.icon}
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <h4 className="text-xl font-black text-[#0F172A] tracking-tight">{k.value}</h4>
                <span className="text-[10px] font-medium text-[#64748B] bg-white border border-[#E2E8F0] px-1.5 py-0.5 rounded">
                  {k.badge}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Scatter Timeline Chart */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-[#0F172A] text-xs uppercase tracking-wider">Fraud Alert Timeline & Risk Matrix</h3>
            <div className="flex items-center space-x-3 text-[11px]">
              <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span><span className="text-[#64748B]">Confirmed</span></span>
              <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="text-[#64748B]">Open</span></span>
              <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-[#64748B]">Cleared</span></span>
            </div>
          </div>
          <div className="h-[280px] bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis type="category" dataKey="date" name="Detected At" tick={{fill: '#64748B', fontSize: 10}} tickFormatter={(t) => String(t).split(' ')[0]} />
                <YAxis type="number" dataKey="risk_score" name="Risk Score" domain={[50, 100]} tick={{fill: '#64748B', fontSize: 10}} />
                <ZAxis type="number" range={[80, 250]} />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }} 
                  contentStyle={{ backgroundColor: '#0F172A', border: 'none', color: '#fff', borderRadius: '8px', fontSize: '11px' }} 
                />
                <Scatter name="Alerts" data={visuals.fraud_timeline || []}>
                  {(visuals.fraud_timeline || []).map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.alert_status === 'BLOCKED' ? '#EF4444' : entry.alert_status === 'INVESTIGATING' ? '#F59E0B' : '#10B981'} 
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
