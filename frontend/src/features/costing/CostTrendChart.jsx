import React from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function CostTrendChart({ trendData = [], billingPeriod = 'Last 30 Days' }) {
  if (!trendData || trendData.length === 0) return null;

  const hasUsd = trendData.some(d => d.totalCostUsd != null && d.totalCostUsd > 0);

  return (
    <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-black text-[#10338D] tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#1C58F6]" />
            Credit Burn Trend ({billingPeriod})
          </h2>
          <p className="text-xs text-[#666666] mt-0.5">
            Daily Snowflake compute credit consumption {hasUsd ? 'vs Total Cost (USD)' : 'over time'}.
          </p>
        </div>
      </div>

      <div className="h-72 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="99%" height="100%">
          <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCompute" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1C58F6" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#1C58F6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
            {hasUsd && (
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={10} />
            )}
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: '1px solid #D1DEFF', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ fontWeight: 600 }}
            />
            <Area 
              yAxisId="left"
              type="monotone" 
              dataKey="computeCredits" 
              name="Compute Credits"
              stroke="#1C58F6" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorCompute)" 
            />
            {hasUsd && (
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="totalCostUsd" 
                name="Total Cost ($)"
                stroke="#10b981" 
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-4 flex items-center justify-center gap-6 text-xs font-semibold text-[#666666]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-[#1C58F6]"></div>
          Compute Credits
        </div>
        {hasUsd && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500 border border-emerald-500 border-dashed bg-opacity-20"></div>
            Total Cost (USD)
          </div>
        )}
      </div>
    </div>
  );
}
