import React from 'react';
import { Server, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function WarehouseCostGrid({ warehouses = [] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 min-w-0">
      {warehouses.map((wh) => (
        <div key={wh.name} className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-[#F8FAFC] rounded-lg border border-[#D1DEFF]">
                  <Server className="w-5 h-5 text-[#1C58F6]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#10338D]">{wh.name}</h3>
                  <p className="text-[10px] text-[#666666] font-mono">{wh.size} • {wh.activeClusters} Cluster(s)</p>
                </div>
              </div>
              <div className={`px-2 py-1 rounded text-[10px] font-bold border flex items-center gap-1 ${
                wh.optimization === 'Optimal' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                wh.optimization === 'Warning' ? 'bg-amber-50 text-emerald-600 border-amber-200' :
                'bg-rose-50 text-rose-700 border-rose-200'
              }`}>
                {wh.optimization === 'Optimal' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {wh.optimization}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[10px] text-[#666666] font-semibold uppercase tracking-wider mb-1">Credits</p>
                <p className="text-lg font-black text-[#10338D]">{wh.creditsConsumed}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#666666] font-semibold uppercase tracking-wider mb-1">Cost</p>
                <p className="text-lg font-black text-[#10338D]">
                  {wh.costUsd != null ? `$${wh.costUsd.toFixed(2)}` : '—'}
                </p>
              </div>
            </div>
            
            <div className="mb-2">
              <p className="text-[10px] text-[#666666] font-semibold uppercase tracking-wider mb-1">Auto-Suspend</p>
              <div className="flex items-center gap-2">
                 <span className="text-sm font-bold text-[#10338D] font-mono">{wh.autoSuspendSec}s</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#ECEFFF]">
            <p className="text-xs text-[#666666] flex items-start gap-1.5">
              <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>{wh.recommendation}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
