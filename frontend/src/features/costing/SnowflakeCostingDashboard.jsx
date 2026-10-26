import React, { useState, useEffect, useCallback } from 'react';
import OverviewLevel0 from './OverviewLevel0';
import PlatformLevel1 from './PlatformLevel1';
import CortexLevel1 from './CortexLevel1';
import CostFilterBar from './CostFilterBar';
import {
  fetchSnowflakeOverview,
  fetchSnowflakePlatform,
  fetchSnowflakeCortexAI,
  fetchSnowflakeFilters,
} from '@/api';
import {
  Sparkles,
  Server,
  Cpu,
  Sliders,
  Database,
  RefreshCw,
  Plus,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';
import SnowflakeConnectionModal from '@/components/SnowflakeConnectionModal';

const FETCHERS = {
  OVERVIEW: fetchSnowflakeOverview,
  PLATFORM: fetchSnowflakePlatform,
  CORTEX_AI: fetchSnowflakeCortexAI,
};

const CACHE_KEYS = {
  OVERVIEW: 'snowflakeOverviewData',
  PLATFORM: 'snowflakePlatformData',
  CORTEX_AI: 'snowflakeCortexData',
};

const EMPTY_TAB_DATA = { OVERVIEW: null, PLATFORM: null, CORTEX_AI: null };

export default function SnowflakeCostingDashboard({ projectState, setProjectState, externalCredentials, providerPicker, onAddAccount }) {
  const initialCostingCreds = (() => {
    if (externalCredentials) return externalCredentials;
    if (projectState?.snowflakeCostingCredentials && projectState?.snowflakeCostingCredentials?.account) {
      return projectState.snowflakeCostingCredentials;
    }
    try {
      const stored = localStorage.getItem('agy_costing_credentials');
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  })();

  const [credentials, setCredentials] = useState(initialCostingCreds || null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [timeRange, setTimeRange] = useState(projectState?.snowflakeCostingTimeRange || 'monthly');
  const [activeSubTab, setActiveSubTab] = useState('OVERVIEW');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const [tabData, setTabData] = useState(() => ({
    OVERVIEW: projectState?.snowflakeOverviewData || null,
    PLATFORM: projectState?.snowflakePlatformData || null,
    CORTEX_AI: projectState?.snowflakeCortexData || null,
  }));
  const [tabLoading, setTabLoading] = useState({ OVERVIEW: false, PLATFORM: false, CORTEX_AI: false });

  const [filterDimensions, setFilterDimensions] = useState(projectState?.snowflakeCostingFilters || null);
  const [selectedFilters, setSelectedFilters] = useState({});

  const hasAuth = !!(credentials && credentials.account && credentials.username && (
    credentials.password ||
    credentials.authMethod === 'externalbrowser' ||
    credentials.authenticator === 'externalbrowser' ||
    credentials.privateKey ||
    credentials.token
  ));

  // Sync with FinOpsDashboard wrapper
  useEffect(() => {
    if (externalCredentials && externalCredentials.id !== credentials?.id) {
      setCredentials(externalCredentials);
      setTabData(EMPTY_TAB_DATA);
      setFilterDimensions(null);
      setErrorMsg(null);
    }
  }, [externalCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTab = useCallback(async (tab, rangeOverride) => {
    if (!hasAuth) return;
    const activeRange = rangeOverride || timeRange;
    setTabLoading((prev) => ({ ...prev, [tab]: true }));
    setErrorMsg(null);
    try {
      const res = await FETCHERS[tab]({ ...credentials, timeRange: activeRange, scope: 'costing' });
      if (res && res.status === 'success') {
        setTabData((prev) => ({ ...prev, [tab]: res }));
        setLastSyncedAt(new Date().toLocaleTimeString());
        if (setProjectState) {
          setProjectState((prev) => ({
            ...prev,
            [CACHE_KEYS[tab]]: res,
            snowflakeCostingCredentials: credentials,
            snowflakeCostingTimeRange: activeRange,
          }));
        }
      } else {
        setErrorMsg(res?.message || `Failed to load ${tab.replace('_', ' ').toLowerCase()} data.`);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Connection to backend telemetry service failed.');
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab]: false }));
    }
  }, [credentials, timeRange, hasAuth, setProjectState]);

  // Lazy-load the active tab the first time it's opened (or after its cache was cleared)
  useEffect(() => {
    if (hasAuth && !tabData[activeSubTab] && !tabLoading[activeSubTab]) {
      loadTab(activeSubTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, credentials, hasAuth]);

  // Filter-bar dimensions: fetched once per credentials change, shared by all tabs
  useEffect(() => {
    if (!hasAuth || filterDimensions) return;
    fetchSnowflakeFilters({ ...credentials, scope: 'costing' }).then((res) => {
      if (res && res.status === 'success') {
        setFilterDimensions(res);
        if (setProjectState) {
          setProjectState((prev) => ({ ...prev, snowflakeCostingFilters: res }));
        }
      }
    });
  }, [credentials, hasAuth, filterDimensions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live Auto-Refresh Timer — refetches only the currently active tab
  useEffect(() => {
    if (!autoRefresh || !hasAuth) return;
    const interval = setInterval(async () => {
      setIsRefreshing(true);
      try {
        await loadTab(activeSubTab);
      } finally {
        setIsRefreshing(false);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, hasAuth, activeSubTab, loadTab]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadTab(activeSubTab);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTimeRangeChange = (newRange) => {
    setTimeRange(newRange);
    setTabData(EMPTY_TAB_DATA);
    loadTab(activeSubTab, newRange);
  };

  const handleSaveConnection = async (creds) => {
    setErrorMsg(null);
    const costingCreds = { ...creds, scope: 'costing' };
    setCredentials(costingCreds);
    try {
      localStorage.setItem('agy_costing_credentials', JSON.stringify(costingCreds));
    } catch {}
    setTabData(EMPTY_TAB_DATA);
    setFilterDimensions(null);
    if (setProjectState) {
      setProjectState((prev) => ({
        ...prev,
        snowflakeCostingCredentials: costingCreds,
        snowflakeOverviewData: null,
        snowflakePlatformData: null,
        snowflakeCortexData: null,
        snowflakeCostingFilters: null,
      }));
    }
    setIsModalOpen(false);
  };

  // No credentials at all yet: show the connect screen, same as before
  if (!hasAuth) {
    return (
      <>
        <div className="flex-1 py-6 bg-[#F8FAFC] min-h-screen overflow-y-auto w-full min-w-0">
          <div className="space-y-6 min-w-0 w-full">
            <div className="bg-white border border-[#D1DEFF] rounded-2xl p-12 text-center shadow-sm max-w-xl mx-auto space-y-4">
              <div className="bg-blue-50 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto">
                <CreditCard className="w-7 h-7 text-[#1C58F6]" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#10338D] mb-1">Connect Snowflake Account</h2>
                <p className="text-xs text-[#666666] max-w-md mx-auto">
                  Connect your live Snowflake account (Trial, Standard, Enterprise, or Business Critical) to inspect organization-wide spend, platform compute, and Cortex AI usage.
                </p>
              </div>

              {errorMsg && (
                <div className="max-w-md mx-auto bg-red-50 text-red-700 p-3.5 rounded-xl text-xs font-medium border border-red-200 text-left space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block mb-0.5">Authentication / MFA Challenge:</span>
                      {errorMsg}
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-[#10338D] hover:bg-[#0D266B] text-white font-bold py-2.5 px-6 rounded-xl text-xs transition-all shadow-md cursor-pointer"
              >
                {errorMsg ? 'Configure Credentials with MFA / Passkey' : 'Connect Snowflake Account'}
              </button>
            </div>
          </div>
        </div>

        <SnowflakeConnectionModal
          isOpen={isModalOpen}
          initialCredentials={credentials}
          onClose={() => setIsModalOpen(false)}
          onSaveConnection={handleSaveConnection}
        />
      </>
    );
  }

  const identity = tabData.OVERVIEW || tabData.PLATFORM || tabData.CORTEX_AI || {};

  const tabs = [
    { id: 'OVERVIEW', label: 'Overview', icon: Sparkles },
    { id: 'PLATFORM', label: 'Platform', icon: Server },
    { id: 'CORTEX_AI', label: 'Cortex AI', icon: Cpu },
  ];

  return (
    <>
      <div className="w-full space-y-6 py-5 pb-12 min-w-0 overflow-hidden">

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block mb-0.5">Refresh Failed</span>
              {errorMsg}
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-red-500 hover:text-red-700 font-bold text-xs cursor-pointer shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {/* ============================================================ */}
        {/* INTEGRATION CONTROL & SUB-TAB BAR — unchanged from the Monitoring-matching header built
            earlier this session: icon + name + metadata pill + subtext on the left, compact
            controls on the right, a divider, then tabs. Only the tab list and header data source
            changed (now sourced from whichever of the 3 lazily-loaded tabs has data). */}
        {/* ============================================================ */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2 pt-1">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-2xs shrink-0"
                style={{ backgroundColor: `${providerPicker?.color || '#1C58F6'}1A`, borderColor: `${providerPicker?.color || '#1C58F6'}33` }}
              >
                {providerPicker?.icon
                  ? <providerPicker.icon className="w-4 h-4" style={{ color: providerPicker.color }} />
                  : <Database className="w-4 h-4" style={{ color: '#1C58F6' }} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5 flex-wrap">
                  {providerPicker?.providerSelect || (
                    <span className="text-xs font-bold text-[#1E293B] font-mono truncate">
                      {credentials?.account || 'Snowflake'}
                    </span>
                  )}
                  {providerPicker?.accountSelect}
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#ECEFFF] text-[#1C58F6] border border-[#D1DEFF] shrink-0">
                    {identity.edition || '—'} · ${identity.creditRate ?? '—'}/cr
                  </span>
                </div>
                <p className="text-[11px] text-[#64748B] mt-0.5 truncate">
                  Connected as {credentials?.username || 'User'} [{identity.role || 'ROLE'}]
                  {lastSyncedAt && ` · synced ${lastSyncedAt}`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Live Auto-Refresh Toggle */}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  autoRefresh
                    ? 'text-emerald-700 hover:bg-emerald-50'
                    : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
                }`}
                title={autoRefresh ? 'Auto-sync active (every 30 seconds)' : 'Click to activate 30-second live polling'}
              >
                <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'}`}></span>
                <span>{autoRefresh ? 'Auto-Sync (30s)' : 'Auto-Sync'}</span>
              </button>

              {/* Add Account (provided by FinOpsDashboard's picker, so the account switcher
                  and the action to add a new one live in the same header) */}
              {onAddAccount && (
                <button
                  onClick={onAddAccount}
                  className="px-2 py-1.5 rounded-lg text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9] text-xs font-bold cursor-pointer flex items-center space-x-1.5 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Account</span>
                </button>
              )}

              {/* Update Credentials Button (Hidden when managed externally by FinOpsDashboard) */}
              {!externalCredentials && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-2 py-1.5 rounded-lg text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9] font-bold text-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Update Credentials</span>
                </button>
              )}

              <span className="text-[#E2E8F0]">|</span>

              {/* Time Range Selector — the one control here you reach for often, so it's the
                  only one that stays boxed; everything else is a plain text/icon control. */}
              <div className="bg-[#F8FAFC] p-1 rounded-xl border border-[#CBD5E1] flex items-center shadow-2xs">
                {['weekly', 'monthly', 'yearly'].map((range) => (
                  <button
                    key={range}
                    onClick={() => handleTimeRangeChange(range)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
                      timeRange === range
                        ? 'bg-[#10338D] text-white shadow-xs'
                        : 'text-[#666666] hover:text-[#10338D] hover:bg-white'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>

              {/* Refresh Button */}
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="p-2 rounded-lg text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9] cursor-pointer transition-all disabled:opacity-50"
                title="Refresh Live Telemetry Now"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#1C58F6]' : ''}`} />
              </button>
            </div>
          </div>

          {/* Tab Navigation Segmented Bar */}
          <div className="flex items-center space-x-1.5 px-2 pt-2.5 border-t border-[#F1F5F9] overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`px-3.5 py-2 text-xs font-bold flex items-center space-x-2 cursor-pointer transition-all whitespace-nowrap rounded-xl shrink-0 ${
                    isActive
                      ? 'text-white bg-[#10338D] shadow-sm'
                      : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#94A3B8]'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeSubTab === 'PLATFORM' && (
          <CostFilterBar
            dimensions={filterDimensions}
            selected={selectedFilters}
            onChange={setSelectedFilters}
            showAccounts={false}
          />
        )}
        {activeSubTab === 'OVERVIEW' && (
          <CostFilterBar
            dimensions={filterDimensions}
            selected={selectedFilters}
            onChange={setSelectedFilters}
            showAccounts={true}
          />
        )}

        {/* ============================================================ */}
        {/* SUB-TAB CONTENTS */}
        {/* ============================================================ */}
        <div className="space-y-6 min-w-0 w-full max-w-full">
          {activeSubTab === 'OVERVIEW' && (
            <OverviewLevel0
              data={tabData.OVERVIEW}
              loading={tabLoading.OVERVIEW}
              error={!tabData.OVERVIEW ? errorMsg : null}
              selectedFilters={selectedFilters}
            />
          )}

          {activeSubTab === 'PLATFORM' && (
            <PlatformLevel1
              data={tabData.PLATFORM}
              loading={tabLoading.PLATFORM}
              error={!tabData.PLATFORM ? errorMsg : null}
              selectedFilters={selectedFilters}
            />
          )}

          {activeSubTab === 'CORTEX_AI' && (
            <CortexLevel1
              data={tabData.CORTEX_AI}
              loading={tabLoading.CORTEX_AI}
              error={!tabData.CORTEX_AI ? errorMsg : null}
              credentials={{ ...credentials, scope: 'costing' }}
            />
          )}
        </div>

      </div>

      {!externalCredentials && (
        <SnowflakeConnectionModal
          isOpen={isModalOpen}
          initialCredentials={credentials}
          onClose={() => setIsModalOpen(false)}
          onSaveConnection={handleSaveConnection}
        />
      )}
    </>
  );
}
