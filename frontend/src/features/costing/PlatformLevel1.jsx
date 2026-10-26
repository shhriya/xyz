import React, { useState } from 'react';
import { Server, Database, Cloud, Users, Terminal } from 'lucide-react';
import { SectionTitle, DataTable, EmptyState, Skeleton, fmtMoney, fmtNum } from './executive/ExecOverviewPrimitives';
import WarehouseCostGrid from './WarehouseCostGrid';
import ExpensiveQueriesGrid from './ExpensiveQueriesGrid';
import UserCostTable from './UserCostTable';

// Grouped the way a business user actually thinks about platform spend — "what's running",
// "which queries cost the most", "who's running it", "where data lives/moves", "automation
// overhead" — instead of one long scrolling page. Each of these reads as a distinct question a
// business user actually asks, so each gets its own tab rather than being bundled together.
const SUB_TABS = [
  { id: 'COMPUTE', label: 'Compute', icon: Server },
  { id: 'QUERIES', label: 'Top Queries', icon: Terminal },
  { id: 'USERS', label: 'Users & Teams', icon: Users },
  { id: 'STORAGE', label: 'Storage & Transfer', icon: Database },
  { id: 'SERVICES', label: 'Platform Services', icon: Cloud },
];

export default function PlatformLevel1({ data, loading, error, selectedFilters = {} }) {
  const [subTab, setSubTab] = useState('COMPUTE');

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data || data.status !== 'success') {
    return (
      <EmptyState
        icon={Server}
        title="Platform spend could not be loaded"
        detail={error || data?.message || 'Failed to fetch platform cost telemetry.'}
      />
    );
  }

  const {
    warehouses: allWarehouses = [], warehousesByTeam = [], topQueries: allTopQueries = [], users: allUsers = [],
    cloudServices = [], otherServerless = [], storage = {}, dataTransfer = [],
  } = data;
  const { byDatabase = [], byTable = [] } = storage;
  const latestCloudServices = cloudServices[0];

  // Client-side filtering over already-fetched data, matching the pattern already used by
  // ExecutiveCostOverview's filter bar — the warehouse/role dimensions are the only ones directly
  // attached to warehouse/query/user rows, so those are what the shared filter bar can narrow here.
  const whFilter = selectedFilters.warehouses || [];
  const roleFilter = selectedFilters.roles || [];
  const warehouses = whFilter.length ? allWarehouses.filter((w) => whFilter.includes(w.name)) : allWarehouses;
  const topQueries = allTopQueries.filter((q) =>
    (!whFilter.length || whFilter.includes(q.warehouseName)) &&
    (!roleFilter.length || roleFilter.includes(q.roleName))
  );
  const users = allUsers.filter((u) =>
    (!whFilter.length || whFilter.includes(u.topWarehouse)) &&
    (!roleFilter.length || roleFilter.includes(u.role))
  );

  return (
    <div className="space-y-6">
      {/* Sub-tab bar — deliberately NOT the same boxed-pill style as the Overview/Platform/Cortex
          AI tabs above: an underline strip reads as "section within this page" rather than
          another full tab bar, so the two levels don't look like duplicate navigation stacked
          on top of each other. */}
      <div className="flex items-center space-x-5 border-b border-[#E2E8F0] overflow-x-auto scrollbar-none">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`flex items-center space-x-1.5 pb-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer shrink-0 ${
                isActive
                  ? 'text-[#10338D] border-[#10338D]'
                  : 'text-[#64748B] border-transparent hover:text-[#1E293B]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#10338D]' : 'text-[#94A3B8]'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'COMPUTE' && (
        <div className="space-y-6">
          <div>
            <SectionTitle title="Virtual Warehouse Compute" subtitle="Credit consumption, idle %, and auto-suspend configuration per warehouse" />
            {warehouses.length === 0 ? (
              <p className="text-[12px] text-[#64748B] py-4">No warehouse activity in this period.</p>
            ) : (
              <WarehouseCostGrid warehouses={warehouses} />
            )}
          </div>
        </div>
      )}

      {subTab === 'QUERIES' && (
        <div className="space-y-6">
          <div>
            <SectionTitle title="Top Queries" subtitle="Ranked by attributed compute credits" />
            <ExpensiveQueriesGrid queries={topQueries} />
          </div>
        </div>
      )}

      {subTab === 'USERS' && (
        <div className="space-y-6">
          {warehousesByTeam.length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <SectionTitle title="Warehouses by Team" subtitle="From the COST_CENTER tag on each warehouse, when tagged" />
              <DataTable
                columns={[
                  { key: 'team', label: 'Team' },
                  { key: 'warehouse', label: 'Warehouse' },
                  { key: 'credits', label: 'Credits', align: 'right', render: (r) => fmtNum(r.credits, 2) },
                  { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => fmtMoney(r.costUsd) },
                ]}
                rows={warehousesByTeam}
                searchKeys={['team', 'warehouse']}
              />
            </div>
          )}

          <div>
            <SectionTitle title="User Attribution" subtitle="Compute credits by user, with per-query SQL drill-down" />
            <UserCostTable users={users} />
          </div>
        </div>
      )}

      {subTab === 'STORAGE' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <SectionTitle title="Storage by Database" />
              <DataTable
                columns={[
                  { key: 'database', label: 'Database' },
                  { key: 'databaseTb', label: 'TB', align: 'right', render: (r) => fmtNum(r.databaseTb, 3) },
                  { key: 'estMonthlyUsd', label: 'Est. Monthly', align: 'right', render: (r) => fmtMoney(r.estMonthlyUsd) },
                ]}
                rows={byDatabase}
                searchKeys={['database']}
                emptyText="No database storage data available."
              />
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <SectionTitle title="Storage by Table" subtitle="Top 50 by total bytes" />
              <DataTable
                columns={[
                  { key: 'table', label: 'Table' },
                  { key: 'activeGb', label: 'Active GB', align: 'right', render: (r) => fmtNum(r.activeGb, 2) },
                  { key: 'timeTravelGb', label: 'Time Travel GB', align: 'right', render: (r) => fmtNum(r.timeTravelGb, 2) },
                ]}
                rows={byTable}
                searchKeys={['table']}
                emptyText="No table storage data available."
              />
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
            <SectionTitle title="Data Transfer" subtitle="By source/target cloud and region" />
            <DataTable
              columns={[
                { key: 'sourceRegion', label: 'Source' },
                { key: 'targetRegion', label: 'Target' },
                { key: 'transferType', label: 'Type' },
                { key: 'tb', label: 'TB', align: 'right', render: (r) => fmtNum(r.tb, 3) },
              ]}
              rows={dataTransfer}
              searchKeys={['sourceRegion', 'targetRegion', 'transferType']}
              emptyText="No cross-region data transfer in this period."
            />
          </div>
        </div>
      )}

      {subTab === 'SERVICES' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
            <SectionTitle title="Cloud Services" subtitle="Used vs. the free 10% allowance vs. billed" />
            {!latestCloudServices ? (
              <p className="text-[12px] text-[#64748B] py-4">No cloud services usage in this period.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-[#64748B]">Used</p>
                  <p className="text-sm font-black text-[#0F172A] mt-1">{fmtNum(latestCloudServices.used, 2)} cr</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-[#64748B]">Free Adjustment</p>
                  <p className="text-sm font-black text-emerald-600 mt-1">{fmtNum(latestCloudServices.freeAdjustment, 2)} cr</p>
                </div>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[10px] font-bold uppercase text-[#64748B]">Billed</p>
                  <p className="text-sm font-black text-[#0F172A] mt-1">{fmtNum(latestCloudServices.billed, 2)} cr</p>
                </div>
              </div>
            )}
          </div>

          {otherServerless.length > 0 && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
              <SectionTitle
                title="Other Serverless Features"
                subtitle="Auto-clustering, search optimization, materialized views, serverless tasks/alerts, data quality monitoring, replication, Snowpipe, container services and notebooks"
              />
              <DataTable
                columns={[
                  { key: 'serviceType', label: 'Service' },
                  { key: 'objectName', label: 'Object' },
                  { key: 'databaseName', label: 'Database' },
                  { key: 'credits', label: 'Credits', align: 'right', render: (r) => fmtNum(r.credits, 3) },
                  { key: 'costUsd', label: 'Cost', align: 'right', render: (r) => fmtMoney(r.costUsd) },
                ]}
                rows={otherServerless}
                searchKeys={['serviceType', 'objectName', 'databaseName']}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
