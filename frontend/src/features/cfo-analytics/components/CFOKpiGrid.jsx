import React from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Users,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Wallet,
  Sparkles,
  Database,
  Layers,
  Cpu,
} from 'lucide-react';

export default function CFOKpiGrid({ kpis, domain = 'Executive Analytics' }) {
  if (!kpis) return null;

  // Standardize kpiItems array whether kpis is passed as an Array or Object Dict
  let kpiItems = [];
  if (Array.isArray(kpis)) {
    kpiItems = kpis;
  } else if (typeof kpis === 'object') {
    kpiItems = Object.keys(kpis).map(key => ({ key, ...kpis[key] }));
  }

  if (kpiItems.length === 0) return null;

  const iconList = [DollarSign, CreditCard, TrendingUp, Users, FileText, CheckCircle2, Clock, AlertTriangle, Wallet, Sparkles, Database, Layers, Cpu];
  const colorList = [
    { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
    { color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30' },
    { color: 'text-[#1C58F6]', bg: 'bg-[#1C58F6]/10', border: 'border-[#1C58F6]/40' },
    { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    { color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' },
    { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
    { color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/30' },
    { color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/40' },
    { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
    { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' }
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
          <span>{domain} Telemetry KPIs ({kpiItems.length} Dynamic Metrics)</span>
        </h2>
        <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20 flex items-center space-x-1">
          <Sparkles className="w-3 h-3 text-emerald-400" />
          <span>Column SQL Analyzed</span>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {kpiItems.map((item, idx) => {
          const Icon = iconList[idx % iconList.length];
          const style = colorList[idx % colorList.length];

          return (
            <div 
              key={item.key || idx} 
              className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 space-y-2.5 shadow-md hover:shadow-lg transition-all duration-200 group relative overflow-hidden"
            >
              {/* Subtle background glow */}
              <div className="absolute -right-6 -top-6 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition-all" />

              <div className="flex items-center justify-between">
                <div className={`w-9 h-9 rounded-xl ${style.bg} ${style.border} ${style.color} flex items-center justify-center shrink-0 border`}>
                  <Icon className="w-4 h-4" />
                </div>
                {item.badge ? (
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    item.badge.includes('SUM') || item.badge.includes('AVG') || item.badge.includes('Distinct')
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                      : 'text-slate-300 bg-slate-800 border-slate-700'
                  }`}>
                    {item.badge}
                  </span>
                ) : item.trend === 'up' ? (
                  <span className="text-emerald-400 bg-emerald-500/10 p-1 rounded-md text-xs">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </span>
                ) : item.trend === 'down' ? (
                  <span className="text-rose-400 bg-rose-500/10 p-1 rounded-md text-xs">
                    <TrendingDown className="w-3.5 h-3.5" />
                  </span>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-400 group-hover:text-slate-300 transition-colors truncate">
                  {item.label}
                </p>
                <div className="text-lg font-black text-slate-100 tracking-tight font-mono mt-0.5">
                  {item.value}
                </div>
              </div>

              {item.sub && (
                <div className="pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 truncate flex items-center justify-between">
                  <span>{item.sub}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
