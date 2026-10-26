import React from 'react';
import {
  Area,
  AreaChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function CortexTrendChart({ trendData = [], billingPeriod = 'Last 30 Days' }) {
  if (!trendData || trendData.length === 0) return null;

  const hasCredits = trendData.some(d => d.credits != null && d.credits > 0);

  return (
    <div className="bg-white border border-[#D1DEFF] rounded-2xl p-4 sm:p-6 shadow-sm min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-black text-[#10338D] tracking-tight flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            Cortex Token Trend ({billingPeriod})
          </h2>
          <p className="text-xs text-[#666666] mt-0.5">
            Daily AI tokens processed by Snowflake Cortex functions{hasCredits ? ' vs AI credits consumed' : ''}.
          </p>
        </div>
      </div>

      <div className="h-64 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="99%" height="100%">
          <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCortexTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9333ea" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#9333ea" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
            {hasCredits && (
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={10} />
            )}
            <Tooltip
              contentStyle={{ borderRadius: '12px', border: '1px solid #D1DEFF', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ fontWeight: 600 }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="tokens"
              name="Tokens Processed"
              stroke="#9333ea"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorCortexTokens)"
            />
            {hasCredits && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="credits"
                name="AI Credits"
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
          <div className="w-3 h-3 rounded bg-purple-600"></div>
          Tokens Processed
        </div>
        {hasCredits && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500 border border-emerald-500 border-dashed bg-opacity-20"></div>
            AI Credits
          </div>
        )}
      </div>
    </div>
  );
}
