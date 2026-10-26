import React, { useState, useEffect } from 'react';
import {
  Activity,
  CreditCard
} from 'lucide-react';
import FinOpsDashboard from '@/features/costing/FinOpsDashboard';
import MonitoringView from './MonitoringView';
import SnowflakeConnectionModal from '@/components/SnowflakeConnectionModal';
import { fetchSavedConnections, saveSnowflakeConnection } from '@/api';

export default function AIGovernanceDashboard({ projectState, setProjectState }) {
  const [activePrimaryTab, setActivePrimaryTab] = useState('monitoring'); // 'monitoring' | 'costing'

  // Dedicated AI Governance connection - completely isolated from other tabs
  const initialGovernanceCreds = (() => {
    if (projectState?.governanceConnection && projectState?.governanceConnection?.account) {
      return projectState.governanceConnection;
    }
    try {
      const stored = localStorage.getItem('agy_governance_credentials');
      if (stored) return JSON.parse(stored);
    } catch { }
    return null;
  })();

  const [selectedConnection, setSelectedConnection] = useState(initialGovernanceCreds || null);
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

  useEffect(() => {
    async function loadConnections() {
      const res = await fetchSavedConnections();
      if (res && res.connections && res.connections.length > 0) {
        if (!selectedConnection) {
          const active = (initialGovernanceCreds && res.connections.find(c => c.account === initialGovernanceCreds.account)) || initialGovernanceCreds || res.connections[0];
          setSelectedConnection(active);
        }
      } else if (initialGovernanceCreds) {
        setSelectedConnection(initialGovernanceCreds);
      }
    }
    loadConnections();
  }, []);

  const handleSaveConnection = async (details) => {
    const payload = { ...details, scope: 'governance' };
    const res = details.id ? { status: 'success', connection: payload } : await saveSnowflakeConnection(payload);
    if (res && res.status === 'success' && res.connection) {
      setSelectedConnection(res.connection);
      try {
        localStorage.setItem('agy_governance_credentials', JSON.stringify(res.connection));
      } catch { }
      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          governanceConnection: res.connection
        }));
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 relative">

      {/* Top Primary Tabs */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-2 sm:p-2.5 shadow-xs w-full mb-4">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActivePrimaryTab('monitoring')}
            className={`px-4 py-2 text-xs font-bold flex items-center space-x-2 rounded-xl transition-all ${activePrimaryTab === 'monitoring'
              ? 'text-white bg-[#10338D] shadow-sm'
              : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
              }`}
          >
            <Activity className="w-4 h-4" />
            <span>Monitoring</span>
          </button>

          <button
            onClick={() => setActivePrimaryTab('costing')}
            className={`px-4 py-2 text-xs font-bold flex items-center space-x-2 rounded-xl transition-all ${activePrimaryTab === 'costing'
              ? 'text-white bg-[#10338D] shadow-sm'
              : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
              }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Cost Tracking</span>
          </button>
        </div>
      </div>

      {activePrimaryTab === 'monitoring' ? (
        <div className="space-y-6">
          <p className="text-xs text-[#64748B] leading-relaxed max-w-2xl px-1">
            Connect any scheduler or pipeline source — dbt, Airflow and more. AI analyzes each new source's
            metadata once to choose its KPIs; refreshes are plain data pulls.
          </p>

          <MonitoringView
            selectedConnection={selectedConnection}
            projectState={projectState}
            setProjectState={setProjectState}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-[#64748B] leading-relaxed max-w-2xl px-1">
            Connect any warehouse or orchestration platform — Snowflake, dbt Cloud, Managed Airflow and more.
            Track spend, attribute cost by user and workload, and catch waste before it hits the bill.
          </p>

          <FinOpsDashboard projectState={projectState} setProjectState={setProjectState} />
        </div>
      )}

      {/* Snowflake Connection Modal for persistent 1-click connections */}
      <SnowflakeConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        onConnectionAdded={handleSaveConnection}
        onSaveConnection={handleSaveConnection}
        scope="governance"
      />
    </div>
  );
}
