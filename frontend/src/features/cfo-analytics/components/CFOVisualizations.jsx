import React, { useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  PieChart,
  Globe,
  Users,
  Building2,
  AlertCircle,
} from 'lucide-react';

export default function CFOVisualizations({ visualizations }) {
  const [activeTab, setActiveTab] = useState('all');

  if (!visualizations) return null;

  const {
    monthly_revenue_trend = [],
    monthly_expense_trend = [],
    revenue_by_region = [],
    revenue_by_customer_top10 = [],
    expense_by_department = [],
    invoice_status_distribution = [],
    receivables_by_customer = []
  } = visualizations;

  // Detect if this is Financial Transaction Monitoring domain
  const isTxnDomain = revenue_by_region.some(r => /MOBILE|WEB|ATM|POS|BRANCH/i.test(r.region))
    || invoice_status_distribution.some(s => /SUCCESS|FAILED|PENDING|REVERSED/i.test(s.status));

  // Smart value formatter: avoids dividing tiny values by 1M
  const fmt = (val) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
    return `$${val.toLocaleString()}`;
  };

  // Max value helper for bar charts scaling
  const maxRevenue = Math.max(...monthly_revenue_trend.map(d => d.revenue), 1);
  const maxExpense = Math.max(...monthly_expense_trend.map(d => d.expenses), 1);
  const maxCustRev = Math.max(...revenue_by_customer_top10.map(d => d.revenue), 1);
  const maxDeptExp = Math.max(...expense_by_department.map(d => d.amount), 1);
  const maxRec = Math.max(...receivables_by_customer.map(d => d.overdue), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span>7 Executive Visualizations & Performance Analytics</span>
        </h2>
        <span className="text-[10px] text-slate-400 font-mono">Real-time MCP Finance Aggregations</span>
      </div>

      {/* Grid Layout for Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* 1. Monthly Revenue Trend (7 Cols) */}
        {/* 1. Monthly Revenue / Daily Transaction Trend (7 Cols) */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>Monthly Revenue Trend</span>
              </h3>
              <p className="text-[11px] text-slate-400">Total revenue generated per month</p>
            </div>
            <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
              {monthly_revenue_trend.length > 0 ? `Peak: ${fmt(maxRevenue)}` : 'Live Stream'}
            </span>
          </div>

          <div className="h-48 flex items-end justify-between gap-1.5 pt-6 pb-2 px-2 border-b border-slate-800/80">
            {monthly_revenue_trend.length === 0 ? (
              <div className="w-full text-slate-500 text-xs text-center font-mono my-auto">Waiting for schema selection...</div>
            ) : monthly_revenue_trend.map((item, idx) => {
              const heightPct = Math.round((item.revenue / maxRevenue) * 100);
              return (
                <div key={idx} className="flex-1 flex flex-col items-center group relative">
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950 border border-emerald-500/40 text-emerald-300 px-2 py-1 rounded text-[10px] font-mono font-bold whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    {item.month}: {fmt(item.revenue)}
                  </div>

                  <div className="w-full bg-slate-800/60 rounded-t-md relative flex items-end justify-center overflow-hidden" style={{ height: '140px' }}>
                    <div 
                      className="w-full bg-gradient-to-t from-emerald-600 to-teal-400 group-hover:from-emerald-500 group-hover:to-teal-300 transition-all rounded-t-md"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 mt-1.5 group-hover:text-emerald-400 truncate max-w-[60px]">{item.month}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span><span>{isTxnDomain ? 'Daily Txn Value' : 'Actual Volume'}</span></span>
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-700 inline-block"></span><span>{isTxnDomain ? 'Daily Baseline' : 'Target'}</span></span>
          </div>
        </div>

        {/* 2. Monthly Expense Trend / Gateway Fees (5 Cols) */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                <BarChart3 className="w-4 h-4 text-rose-400" />
                <span>Monthly Expense Trend</span>
              </h3>
              <p className="text-[11px] text-slate-400">Total expenses incurred per month</p>
            </div>
            <span className="text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
              {monthly_expense_trend.length} Months
            </span>
          </div>

          <div className="h-48 flex items-end justify-between gap-1.5 pt-6 pb-2 px-2 border-b border-slate-800/80">
            {monthly_expense_trend.length === 0 ? (
              <div className="w-full text-slate-500 text-xs text-center font-mono my-auto">Waiting for schema selection...</div>
            ) : monthly_expense_trend.map((item, idx) => {
              const heightPct = Math.round((item.expenses / maxExpense) * 100);
              return (
                <div key={idx} className="flex-1 flex flex-col items-center group relative">
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950 border border-rose-500/40 text-rose-300 px-2 py-1 rounded text-[10px] font-mono font-bold whitespace-nowrap z-10 pointer-events-none shadow-lg">
                    {item.month}: {fmt(item.expenses)}
                  </div>

                  <div className="w-full bg-slate-800/60 rounded-t-md relative flex items-end justify-center overflow-hidden" style={{ height: '140px' }}>
                    <div 
                      className="w-full bg-gradient-to-t from-rose-600 to-amber-500 group-hover:from-rose-500 group-hover:to-amber-400 transition-all rounded-t-md"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 mt-1.5 group-hover:text-rose-400 truncate max-w-[60px]">{item.month}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span><span>{isTxnDomain ? 'Gateway Fees' : 'Model Metric'}</span></span>
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-700 inline-block"></span><span>{isTxnDomain ? 'Fee Threshold' : 'Threshold'}</span></span>
          </div>
        </div>

        {/* 3. Revenue by Region / Channel (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
              <Globe className="w-4 h-4 text-sky-400" />
              <span>Revenue by Region</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">{revenue_by_region.length} Regions</span>
          </div>

          <div className="space-y-3 pt-1">
            {revenue_by_region.length === 0 ? (
              <div className="text-slate-500 text-xs text-center font-mono py-4">No partition data found</div>
            ) : revenue_by_region.map((r, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-200">{r.region}</span>
                  <span className="text-emerald-400 font-mono font-bold">{fmt(r.amount)} ({r.pct}%)</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                  <div 
                    className="bg-gradient-to-r from-sky-500 to-emerald-400 h-full rounded-full transition-all"
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Invoice Status Distribution / Transaction Status (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
              <PieChart className="w-4 h-4 text-purple-400" />
              <span>Invoice Status Distribution (Paid/Open/Overdue)</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">{invoice_status_distribution.reduce((s,i) => s + (i.count||0), 0)} Total Invoices</span>
          </div>

          <div className="space-y-3 pt-1">
            {invoice_status_distribution.length === 0 ? (
              <div className="text-slate-500 text-xs text-center font-mono py-4">No object records found</div>
            ) : invoice_status_distribution.map((inv, idx) => (
              <div key={idx} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: inv.color }} />
                  <div>
                    <div className="font-bold text-slate-200">{inv.status}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{inv.count} Records ({inv.pct}%)</div>
                  </div>
                </div>
                <div className="text-right font-mono font-bold text-slate-100">
                  {fmt(inv.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Revenue by Customer / Top Senders (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
              <Users className="w-4 h-4 text-teal-400" />
              <span>Revenue by Customer (Top 10)</span>
            </h3>
            <span className="text-[10px] font-mono text-emerald-400">{revenue_by_customer_top10.length} Top Customers</span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {revenue_by_customer_top10.length === 0 ? (
              <div className="text-slate-500 text-xs text-center font-mono py-4">No records analyzed</div>
            ) : revenue_by_customer_top10.map((c, idx) => {
              const widthPct = Math.round((c.revenue / maxCustRev) * 100);
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-semibold truncate">{idx + 1}. {c.customer}</span>
                    <span className="text-teal-300 font-mono font-bold shrink-0">{fmt(c.revenue)} ({c.share})</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div 
                      className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full rounded-full"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 6. Expense by Department / Fraud Alerts (6 Cols) */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-amber-400" />
              <span>Expense by Department / Cost Center</span>
            </h3>
            <span className="text-[10px] font-mono text-slate-400">{expense_by_department.length} Departments</span>
          </div>

          <div className="space-y-3 pt-1">
            {expense_by_department.length === 0 ? (
              <div className="text-slate-500 text-xs text-center font-mono py-4">No categories found</div>
            ) : expense_by_department.map((d, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-200">{d.department}</span>
                  <span className="text-amber-400 font-mono font-bold">{isTxnDomain ? `${d.pct}%` : `${fmt(d.amount)} (${d.pct}%)`}</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                  <div 
                    className="bg-gradient-to-r from-amber-500 to-rose-500 h-full rounded-full"
                    style={{ width: `${d.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Receivables / Settlement Status (Full Width - 12 Cols) */}
        <div className="lg:col-span-12 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <span>Outstanding Receivables by Customer</span>
              </h3>
              <p className="text-[11px] text-slate-400">Total open and overdue receivables</p>
            </div>
            <span className="text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 px-2.5 py-1 rounded border border-rose-500/30">
              {receivables_by_customer.length} Customers
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {receivables_by_customer.length === 0 ? (
              <div className="col-span-4 text-slate-500 text-xs text-center font-mono py-4">No settlement or object profiles found</div>
            ) : receivables_by_customer.map((item, idx) => (
              <div key={idx} className={`p-3.5 rounded-xl border bg-slate-950 space-y-2 ${
                item.status === 'Critical' ? 'border-rose-500/40 text-rose-300' :
                item.status === 'Warning' ? 'border-amber-500/40 text-amber-300' :
                'border-slate-800 text-slate-300'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 truncate">{item.customer}</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    item.status === 'Critical' ? 'bg-rose-500/20 text-rose-400' :
                    item.status === 'Warning' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {item.status}
                  </span>
                </div>
                <div className="text-lg font-bold font-mono text-slate-100">
                  {fmt(item.overdue)}
                </div>
                <div className="text-[10px] text-slate-400 flex items-center justify-between font-mono">
                  <span>{isTxnDomain ? `${item.days_overdue} Settlement(s)` : `${item.days_overdue} Columns Detected`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
