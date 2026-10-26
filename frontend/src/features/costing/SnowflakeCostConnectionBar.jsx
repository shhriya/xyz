import React from 'react';
import { Database, ShieldCheck, CreditCard, Play, Server } from 'lucide-react';

export default function SnowflakeCostConnectionBar({
  activeDatabase = '',
  activeWarehouse = '',
  onTestConnection = () => {},
  isConnected = false,
  accountName = ''
}) {
  return (
    <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
          <CreditCard className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-sm font-black text-[#10338D] tracking-tight flex items-center gap-2">
            Snowflake Costing &amp; FinOps
          </h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-[#666666] font-medium">
            {accountName && (
              <span className="flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2 py-0.5 rounded text-xs font-mono font-bold text-[#10338D]">
                <Database className="w-3 h-3 text-[#1C58F6]" />
                {accountName}
              </span>
            )}
            {activeWarehouse && (
              <span className="flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2 py-0.5 rounded text-xs">
                <Server className="w-3 h-3 text-[#10338D]" />
                {activeWarehouse}
              </span>
            )}
            <span className="flex items-center gap-1 bg-[#F8FAFC] border border-[#D1DEFF] px-2 py-0.5 rounded text-xs">
              <ShieldCheck className={`w-3 h-3 ${isConnected ? 'text-emerald-600' : 'text-slate-400'}`} />
              {isConnected ? 'Live Telemetry Active' : 'Account Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onTestConnection}
          className="flex items-center gap-1.5 bg-[#F8FAFC] border border-[#D1DEFF] text-[#10338D] font-bold px-3 py-1.5 rounded-lg text-xs hover:bg-[#ECEFFF] transition-colors shadow-sm cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 text-[#1C58F6] fill-current" />
          {isConnected ? 'Update Credentials' : 'Connect Snowflake Account'}
        </button>
      </div>
    </div>
  );
}
