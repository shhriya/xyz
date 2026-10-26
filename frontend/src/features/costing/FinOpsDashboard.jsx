import React, { useState, useEffect } from 'react';
import { Database, Layers, Plus, ChevronDown, ChevronRight, ArrowLeft, Wind, Cloud } from 'lucide-react';
import SnowflakeCostingDashboard from './SnowflakeCostingDashboard';
import DbtCostingDashboard from './DbtCostingDashboard';
import AirflowCostingDashboard from './AirflowCostingDashboard';
import SnowflakeConnectionModal from '@/components/SnowflakeConnectionModal';
import { fetchSavedConnections } from '@/api';

// The set of cost sources this console can show. Adding a new one later is exactly this: one
// entry here (with whichever dashboard component already exists for it) — the landing grid and
// the detail view both drive off this list instead of a hardcoded single tool.
const PROVIDERS = [
  { id: 'snowflake', label: 'Snowflake', icon: Database, color: '#1C58F6', hasAccounts: true, description: 'Warehouse compute, storage and Cortex AI spend' },
  { id: 'dbt', label: 'dbt Cloud', icon: Layers, color: '#FF6B00', hasAccounts: false, description: 'Job run minutes and plan usage' },
  { id: 'airflow', label: 'Managed Airflow', icon: Wind, color: '#0D9488', hasAccounts: false, description: 'Environment and worker spend' },
];

// Sources shown on the landing grid to signal roadmap breadth, not yet wired to a dashboard.
const COMING_SOON = [
  { id: 'bigquery', label: 'BigQuery', description: 'Slot usage and storage spend' },
  { id: 'redshift', label: 'Redshift', description: 'Cluster compute and storage spend' },
  { id: 'databricks', label: 'Databricks', description: 'DBU usage across workspaces' },
];

export default function FinOpsDashboard({ projectState, setProjectState }) {
  const [provider, setProvider] = useState(() => projectState?.costingActiveProvider || null);
  const [connections, setConnections] = useState([]);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const activeProvider = PROVIDERS.find((p) => p.id === provider) || null;
  const ActiveIcon = activeProvider?.icon;

  useEffect(() => {
    async function load() {
      const res = await fetchSavedConnections();
      if (res && res.connections) {
        // Filter connections used for costing
        const costingConn = res.connections.filter(c => c.scope === 'costing');
        setConnections(costingConn);

        if (costingConn.length > 0) {
          // Check if we have an active one in projectState
          const active = projectState?.snowflakeCostingCredentials;
          if (active && costingConn.find(c => c.id === active.id)) {
            setSelectedConnection(active);
          } else {
            setSelectedConnection(costingConn[0]);
          }
        }
      }
    }
    load();
  }, [projectState?.snowflakeCostingCredentials]);

  const selectProvider = (id) => {
    setProvider(id);
    if (setProjectState) {
      setProjectState(prev => ({ ...prev, costingActiveProvider: id }));
    }
  };

  const goToSources = () => {
    setProvider(null);
    if (setProjectState) {
      setProjectState(prev => ({ ...prev, costingActiveProvider: null }));
    }
  };

  const handleConnectionChange = (e) => {
    const connId = e.target.value;
    const conn = connections.find(c => c.id === connId);
    if (conn) {
      setSelectedConnection(conn);
      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          snowflakeCostingCredentials: conn,
          snowflakeCostingData: null // force reload for new account
        }));
      }
      try {
        localStorage.setItem('agy_costing_credentials', JSON.stringify(conn));
      } catch {}
    }
  };

  const handleSaveConnection = (newConn) => {
    // modal handles API save, we just get the new object
    const costingConn = { ...newConn, scope: 'costing' };
    setSelectedConnection(costingConn);
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        snowflakeCostingCredentials: costingConn,
        snowflakeCostingData: null
      }));
    }
    try {
      localStorage.setItem('agy_costing_credentials', JSON.stringify(costingConn));
    } catch {}

    setIsModalOpen(false);
  };

  // Snowflake's account dropdown, handed down so its dashboard can fold it into its own header
  // card instead of sitting in a separate picker card above it.
  const accountSelect = activeProvider?.hasAccounts && connections.length > 0 ? (
    <>
      <span className="text-[#CBD5E1] text-xs">·</span>
      <div className="relative">
        <select
          value={selectedConnection?.id || ''}
          onChange={handleConnectionChange}
          className="text-xs font-semibold text-[#64748B] bg-transparent pr-6 appearance-none cursor-pointer focus:outline-none"
          title="Switch account"
        >
          {connections.map(c => (
            <option key={c.id} value={c.id}>{c.account} ({c.username})</option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-[#64748B] absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </>
  ) : null;

  const providerPicker = activeProvider ? {
    icon: ActiveIcon,
    color: activeProvider.color,
    providerSelect: <span className="text-xs font-bold text-[#1E293B]">{activeProvider.label}</span>,
    accountSelect,
  } : null;

  // Landing grid: every cost source is a clickable card, so you pick a tool before seeing any
  // of its numbers — mirrors a real product catalog instead of defaulting into one vendor.
  if (!provider) {
    return (
      <div className="w-full space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            const connectedCount = p.hasAccounts ? connections.length : 0;
            return (
              <button
                key={p.id}
                onClick={() => selectProvider(p.id)}
                className="text-left bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-xs hover:shadow-sm hover:border-[#CBD5E1] transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-2xs"
                    style={{ backgroundColor: `${p.color}1A`, borderColor: `${p.color}33` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: p.color }} />
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#CBD5E1] group-hover:text-[#64748B] group-hover:translate-x-0.5 transition-all" />
                </div>
                <h3 className="text-sm font-bold text-[#1E293B] mt-3">{p.label}</h3>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">{p.description}</p>
                <div className="mt-3 pt-3 border-t border-[#F1F5F9]">
                  {p.hasAccounts ? (
                    connectedCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {connectedCount} account{connectedCount > 1 ? 's' : ''} connected
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-[#94A3B8]">Not connected yet</span>
                    )
                  ) : (
                    <span className="text-[11px] font-semibold text-[#94A3B8]">Click to view</span>
                  )}
                </div>
              </button>
            );
          })}

          {COMING_SOON.map((p) => (
            <div
              key={p.id}
              className="bg-[#F8FAFC] border border-dashed border-[#E2E8F0] rounded-2xl p-4 opacity-70 cursor-not-allowed"
              title="Coming soon"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#E2E8F0] bg-white">
                  <Cloud className="w-5 h-5 text-[#94A3B8]" />
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#94A3B8] border border-[#E2E8F0]">
                  Coming Soon
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#64748B] mt-3">{p.label}</h3>
              <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>

        <SnowflakeConnectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSaveConnection={handleSaveConnection}
          scope="costing"
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <button
        onClick={goToSources}
        className="flex items-center gap-1.5 text-xs font-bold text-[#64748B] hover:text-[#1E293B] transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>All Sources</span>
      </button>

      {provider === 'snowflake' && (
        <SnowflakeCostingDashboard
          projectState={projectState}
          setProjectState={setProjectState}
          externalCredentials={selectedConnection}
          providerPicker={providerPicker}
          onAddAccount={() => setIsModalOpen(true)}
        />
      )}
      {provider === 'dbt' && (
        <DbtCostingDashboard
          projectState={projectState}
          setProjectState={setProjectState}
        />
      )}
      {provider === 'airflow' && (
        <AirflowCostingDashboard
          projectState={projectState}
          setProjectState={setProjectState}
        />
      )}

      {/* Connection Modal for Snowflake */}
      <SnowflakeConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaveConnection={handleSaveConnection}
        scope="costing"
      />
    </div>
  );
}
