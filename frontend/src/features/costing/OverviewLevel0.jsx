import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { DollarSign, Server, Cpu, PieChart, Info } from 'lucide-react';
import { KpiCard, SectionTitle, DataTable, EmptyState, Skeleton, MUTED, SERIES, fmtMoney } from './executive/ExecOverviewPrimitives';

export default function OverviewLevel0({ data, loading, error, selectedFilters = {} }) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error || !data || data.status !== 'success') {
    return (
      <EmptyState
        icon={DollarSign}
        title="Overview could not be loaded"
        detail={error || data?.message || 'Failed to fetch organization-wide spend overview.'}
      />
    );
  }

  const { kpis = {}, spendByCategory = [], dailyTrend = [], topServices = [], topAccounts: allTopAccounts = [], scope, message } = data;

  const accountFilter = selectedFilters.accounts || [];
  const topAccounts = accountFilter.length ? allTopAccounts.filter((a) => accountFilter.includes(a.account)) : allTopAccounts;

  const trendKeys = Array.from(
    new Set(dailyTrend.flatMap((d) => Object.keys(d).filter((k) => k !== 'day')))
  );

  return (
    <div className="space-y-5">
      {scope === 'account_fallback' && message && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Spend" value={fmtMoney(kpis.totalSpendUsd)} icon={DollarSign} />
        <KpiCard label="Platform Spend" value={fmtMoney(kpis.platformSpendUsd)} icon={Server} />
        <KpiCard label="Cortex AI Spend" value={fmtMoney(kpis.cortexSpendUsd)} icon={Cpu} footnote="Live Gross Usage" />
        <KpiCard label="Cortex Share" value={`${kpis.cortexSharePct ?? 0}%`} icon={PieChart} footnote="of total spend" />
      </div>

      {dailyTrend.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <SectionTitle title="Daily Spend Trend" subtitle={data.billingPeriod} />
          <div className="h-64 w-full">
            <ResponsiveContainer width="99%" height="100%">
              <AreaChart data={dailyTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #D1DEFF', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {trendKeys.map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="1"
                    stroke={SERIES[i % SERIES.length]}
                    fill={SERIES[i % SERIES.length]}
                    fillOpacity={0.35}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <SectionTitle title="Spend by Category" />
          {spendByCategory.length === 0 ? (
            <p className={`text-[12px] ${MUTED} py-4 text-center`}>No category breakdown available.</p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="99%" height="100%">
                <BarChart data={spendByCategory} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis type="category" dataKey="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={100} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #D1DEFF', fontSize: 12 }} formatter={(v) => fmtMoney(v)} />
                  <Bar dataKey="amountUsd" fill={SERIES[0]} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <SectionTitle title="Top Services" />
          <DataTable
            columns={[
              { key: 'service', label: 'Service' },
              { key: 'amountUsd', label: 'Spend', align: 'right', render: (r) => fmtMoney(r.amountUsd) },
              { key: 'sharePct', label: 'Share', align: 'right', render: (r) => (r.sharePct != null ? `${r.sharePct}%` : '—') },
            ]}
            rows={topServices}
            searchKeys={['service']}
            emptyText="No service breakdown available."
          />
        </div>
      </div>

      {topAccounts.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
          <SectionTitle title="Top Accounts" subtitle="Organization-wide, ranked by spend" />
          <DataTable
            columns={[
              { key: 'account', label: 'Account' },
              { key: 'amountUsd', label: 'Spend', align: 'right', render: (r) => fmtMoney(r.amountUsd) },
              { key: 'sharePct', label: 'Share', align: 'right', render: (r) => (r.sharePct != null ? `${r.sharePct}%` : '—') },
            ]}
            rows={topAccounts}
            searchKeys={['account']}
            emptyText="No account breakdown available."
          />
        </div>
      )}
    </div>
  );
}
