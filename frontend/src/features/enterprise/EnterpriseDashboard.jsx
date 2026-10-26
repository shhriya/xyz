import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  SlidersHorizontal,
  Database,
  AlertTriangle,
} from 'lucide-react';
import { fetchEnterpriseDashboard } from '@/api';

import Page1Executive from './Page1Executive';
import Page2Customer from './Page2Customer';
import Page3Fraud from './Page3Fraud';
import Page4Gateway from './Page4Gateway';
import Page5Operational from './Page5Operational';

export default function EnterpriseDashboard({ 
  selectedConnection, 
  activeDatabase, 
  activeSchema,
  activeTab = 'executive'
}) {
  const [loading, setLoading] = useState(false);
  const [dashboardData, setDashboardData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [tablesQueried, setTablesQueried] = useState([]);
  
  // Global filters state
  const [filters, setFilters] = useState({
    dateRange: 'Last 30 Days',
    country: 'All Countries',
    currency: 'All Currencies',
    customerSegment: 'All Segments'
  });

  useEffect(() => {
    async function loadData() {
      if (!activeDatabase || !activeSchema) {
        setDashboardData(null);
        return;
      }
      setLoading(true);
      setErrorMessage(null);
      try {
        const res = await fetchEnterpriseDashboard({
          credentials: { ...(selectedConnection || {}), scope: 'analytics' },
          database: activeDatabase,
          schema: activeSchema,
          filters: filters
        });
        if (res && res.status === 'success' && res.pages) {
          setDashboardData(res.pages);
          setTablesQueried(res.tablesQueried || []);
          setErrorMessage(null);
        } else {
          setDashboardData(null);
          setErrorMessage(res?.message || 'Could not query live Snowflake tables.');
        }
      } catch (err) {
        setDashboardData(null);
        setErrorMessage(err?.message || 'Error querying live Snowflake instance.');
      }
      setLoading(false);
    }
    loadData();
  }, [selectedConnection, activeDatabase, activeSchema, filters]);

  return (
    <div className="space-y-6">
      {/* Quick Filter Ribbon */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2 text-xs font-semibold text-[#1E293B]">
          <SlidersHorizontal className="w-4 h-4 text-[#1C58F6]" />
          <span>Live Snowflake Filters:</span>
          {tablesQueried.length > 0 && (
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">
              {tablesQueried.length} Live Objects Inspected
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Date Range */}
          <select
            value={filters.dateRange}
            onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value }))}
            className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E293B] focus:outline-none focus:border-[#1C58F6] cursor-pointer"
          >
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
            <option>This Month</option>
            <option>Year to Date</option>
          </select>

          {/* Country */}
          <select
            value={filters.country}
            onChange={(e) => setFilters(prev => ({ ...prev, country: e.target.value }))}
            className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E293B] focus:outline-none focus:border-[#1C58F6] cursor-pointer"
          >
            <option>All Countries</option>
            <option>United States</option>
            <option>United Kingdom</option>
            <option>European Union</option>
            <option>Singapore</option>
          </select>

          {/* Currency */}
          <select
            value={filters.currency}
            onChange={(e) => setFilters(prev => ({ ...prev, currency: e.target.value }))}
            className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E293B] focus:outline-none focus:border-[#1C58F6] cursor-pointer"
          >
            <option>All Currencies</option>
            <option>USD ($)</option>
            <option>EUR (€)</option>
            <option>GBP (£)</option>
            <option>SGD ($)</option>
          </select>

          {/* Customer Segment */}
          <select
            value={filters.customerSegment}
            onChange={(e) => setFilters(prev => ({ ...prev, customerSegment: e.target.value }))}
            className="bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 font-medium text-[#1E293B] focus:outline-none focus:border-[#1C58F6] cursor-pointer"
          >
            <option>All Segments</option>
            <option>Retail Banking</option>
            <option>Corporate Accounts</option>
            <option>Small & Medium Biz</option>
            <option>High Net Worth (HNI)</option>
          </select>

          <button
            type="button"
            onClick={() => setFilters({
              dateRange: 'Last 30 Days',
              country: 'All Countries',
              currency: 'All Currencies',
              customerSegment: 'All Segments'
            })}
            className="text-[11px] text-[#64748B] hover:text-[#1E293B] font-semibold underline ml-1 cursor-pointer"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      {loading ? (
        <div className="bg-white border border-[#CBD5E1] rounded-2xl p-16 text-center space-y-3 shadow-xs">
          <RefreshCw className="w-8 h-8 text-[#1C58F6] animate-spin mx-auto" />
          <p className="text-xs text-[#0F172A] font-bold">
            Querying Live Snowflake Instance...
          </p>
          <p className="text-[11px] text-[#64748B] font-mono">
            Executing real SQL queries against '{activeDatabase}.{activeSchema}' (Zero Mock Data)
          </p>
        </div>
      ) : errorMessage ? (
        <div className="bg-white border border-[#CBD5E1] rounded-2xl p-12 text-center space-y-4 shadow-xs max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0F172A]">Live Snowflake Telemetry Status</h3>
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 mt-2 font-mono text-left">
              {errorMessage}
            </p>
            <p className="text-xs text-[#64748B] mt-3">
              Please check that your Snowflake account credentials in the top bar are authenticated and that your chosen database/schema contains table objects.
            </p>
          </div>
        </div>
      ) : !dashboardData ? (
        <div className="bg-white border border-[#CBD5E1] rounded-2xl p-12 text-center space-y-4 shadow-xs max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 text-[#1C58F6] flex items-center justify-center mx-auto">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0F172A]">Select a Live Snowflake Database & Schema</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Select an authenticated Snowflake database and schema from the control bar above to stream live telemetry.
            </p>
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in duration-300">
          {activeTab === 'executive' && <Page1Executive data={dashboardData.executive} />}
          {activeTab === 'customer' && <Page2Customer data={dashboardData.customer} />}
          {activeTab === 'fraud' && <Page3Fraud data={dashboardData.fraud} />}
          {activeTab === 'gateway' && <Page4Gateway data={dashboardData.gateway} />}
          {activeTab === 'operational' && <Page5Operational data={dashboardData.operational} />}
        </div>
      )}
    </div>
  );
}
