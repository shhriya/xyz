import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  Loader2,
  Shield,
  Sliders,
  Sparkles,
  X
} from 'lucide-react';
import {
  fetchMonitoringSourceTypes,
  fetchMonitoringSources,
  syncMonitoringSource,
  testMonitoringConnection
} from '@/api';

const INPUT_CLASS = 'w-full bg-white border border-[#D1DEFF] rounded-xl px-3.5 py-2 text-[#1E1E1E] font-mono text-xs focus:outline-none focus:border-[#1C58F6] focus:ring-1 focus:ring-[#1C58F6]';

const DEFAULT_SOURCE_TYPES = [
  {
    source_type: 'dbt',
    display_label: 'dbt Cloud',
    credential_fields: [
      { key: 'dbtServiceToken', label: 'dbt Cloud Service Token', type: 'password', required: true, placeholder: 'dbtc_xxxxxxxxxxxxxxxxxxxx', help: 'Service token from dbt Cloud → Account Settings → API Tokens' },
      { key: 'dbtBaseUrl', label: 'dbt Cloud Base URL', type: 'text', required: false, placeholder: 'https://pt733.us1.dbt.com', default: 'https://pt733.us1.dbt.com' },
    ],
    default_target_db: 'DBT_MONITORING',
    default_target_schema: 'METADATA',
    extension_tables: ['DBT_MODELS', 'DBT_SOURCES', 'DBT_TESTS', 'DBT_COLUMNS', 'DBT_EXPOSURES'],
  },
  {
    source_type: 'airflow',
    display_label: 'Apache Airflow',
    credential_fields: [
      { key: 'airflowBaseUrl', label: 'Airflow Base URL', type: 'text', required: true, placeholder: 'http://localhost:8080', default: 'http://localhost:8080' },
      { key: 'airflowApiPath', label: 'REST API Path', type: 'text', required: false, placeholder: '/api/v1', default: '/api/v1', help: 'Stable REST API prefix of your Airflow deployment' },
      { key: 'airflowAuthToken', label: 'Bearer Token', type: 'password', required: false, placeholder: 'Optional – use instead of username/password' },
      { key: 'airflowUsername', label: 'Username', type: 'text', required: false, placeholder: 'admin' },
      { key: 'airflowPassword', label: 'Password', type: 'password', required: false, placeholder: '••••••••' },
      { key: 'useSampleData', label: 'Demo mode: use built-in sample DAG metadata (no Airflow server needed)', type: 'checkbox', required: false, default: false },
    ],
    default_target_db: 'AIRFLOW_MONITORING',
    default_target_schema: 'METADATA',
    extension_tables: [],
  },
  {
    source_type: 'oracle_scheduler',
    display_label: 'Oracle Scheduler',
    credential_fields: [
      { key: 'oracleHost', label: 'Oracle Host', type: 'text', required: true, placeholder: 'db.example.com' },
      { key: 'oraclePort', label: 'Port', type: 'text', required: false, default: '1521', placeholder: '1521' },
      { key: 'oracleServiceName', label: 'Service Name / SID', type: 'text', required: true, placeholder: 'ORCLPDB1' },
      { key: 'oracleUsername', label: 'Username', type: 'text', required: true },
      { key: 'oraclePassword', label: 'Password', type: 'password', required: true },
    ],
    default_target_db: 'ORACLE_MONITORING',
    default_target_schema: 'METADATA',
    extension_tables: [],
  },
  {
    source_type: 'other',
    display_label: 'Other (Custom Sources)',
    credential_fields: [
      { key: 'customHost', label: 'Host', type: 'text', required: false, placeholder: 'api.example.com' },
      { key: 'customToken', label: 'API Token', type: 'password', required: false, placeholder: 'Token...' },
    ],
    default_target_db: 'CUSTOM_MONITORING',
    default_target_schema: 'TELEMETRY',
    extension_tables: [],
  }
];

export default function SourceSyncModal({
  isOpen,
  onClose,
  onSynced,
  selectedConnection,
  initialSourceType = 'dbt'
}) {
  const [sourceTypes, setSourceTypes] = useState(DEFAULT_SOURCE_TYPES);
  const [sourceType, setSourceType] = useState(initialSourceType);
  const [credentials, setCredentials] = useState({});

  const [sfAccount, setSfAccount] = useState('');
  const [sfUser, setSfUser] = useState('');
  const [sfPassword, setSfPassword] = useState('');
  const [sfWarehouse, setSfWarehouse] = useState('COMPUTE_WH');
  const [sfRole, setSfRole] = useState('ACCOUNTADMIN');
  const [registeredSources, setRegisteredSources] = useState([]);
  const [targetDatabase, setTargetDatabase] = useState('');
  const [targetSchema, setTargetSchema] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [syncCurrentStep, setSyncCurrentStep] = useState(0);
  const [syncMode, setSyncMode] = useState(null); // null (undecided) | 'setup' | 'refresh'
  const [syncDetail, setSyncDetail] = useState('');
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncMessage, setSyncMessage] = useState(null);

  const typeConfig = useMemo(() => sourceTypes.find((t) => t.source_type === sourceType) || DEFAULT_SOURCE_TYPES.find(t => t.source_type === sourceType), [sourceTypes, sourceType]);
  const label = typeConfig?.display_label || sourceType;

  useEffect(() => {
    if (!isOpen) return;
    fetchMonitoringSourceTypes().then((res) => {
      if (res?.source_types && res.source_types.length > 0) {
        setSourceTypes(res.source_types);
      }
    });
    // Needed to prefill the target database from an already-registered source rather than the
    // adapter default — see the prefill effect below.
    fetchMonitoringSources().then((res) => setRegisteredSources(res?.sources || []));
  }, [isOpen]);

  useEffect(() => { if (isOpen) setSourceType(initialSourceType); }, [isOpen, initialSourceType]);

  // An already-registered source of this type tells us where this account's monitoring data actually
  // lives. Prefer it over the adapter default: `source_id` is derived from the source type and
  // connection identity only, never the database, so re-syncing against the default silently builds
  // a second, empty set of GOV_* tables in a different database and every count reads zero.
  const existingForType = useMemo(
    () => registeredSources.find((s) => s.source_type === sourceType && s.target_db),
    [registeredSources, sourceType]
  );
  const defaultDbForType = typeConfig?.default_target_db;
  const adoptedExistingTarget = Boolean(
    existingForType && defaultDbForType && existingForType.target_db !== defaultDbForType
  );

  useEffect(() => {
    if (!typeConfig) return;
    const defaults = {};
    typeConfig.credential_fields.forEach((f) => { if (f.default !== undefined) defaults[f.key] = f.default; });
    setCredentials(defaults);
    setTargetDatabase(existingForType?.target_db || typeConfig.default_target_db);
    setTargetSchema(existingForType?.target_schema || typeConfig.default_target_schema);
    setTestResult(null);
    setSyncMessage(null);
  }, [typeConfig, existingForType]);

  useEffect(() => {
    if (!selectedConnection) return;
    if (selectedConnection.account && !sfAccount) setSfAccount(selectedConnection.account);
    if ((selectedConnection.username || selectedConnection.user) && !sfUser) setSfUser(selectedConnection.username || selectedConnection.user);
    if (selectedConnection.password && !sfPassword) setSfPassword(selectedConnection.password);
    if (selectedConnection.warehouse) setSfWarehouse(selectedConnection.warehouse);
    if (selectedConnection.role) setSfRole(selectedConnection.role);
  }, [selectedConnection]);

  if (!isOpen) return null;

  const setCredential = (key, value) => setCredentials((prev) => ({ ...prev, [key]: value }));
  const sampleMode = Boolean(credentials.useSampleData);
  const missingRequired = (typeConfig?.credential_fields || [])
    .filter((f) => f.required && f.type !== 'checkbox' && !String(credentials[f.key] ?? '').trim() && !(sampleMode && f.key !== 'useSampleData'))
    .map((f) => f.label);

  const handleClose = () => {
    if (syncing) return;
    onClose();
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    const res = await testMonitoringConnection(sourceType, credentials);
    setTestResult(res);
    setTestingConn(false);
  };

  const handleSyncNow = async () => {
    if (missingRequired.length) { setSyncMessage({ status: 'error', message: `Please enter: ${missingRequired.join(', ')}.` }); return; }
    if (!sfAccount.trim()) { setSyncMessage({ status: 'error', message: 'Please enter your Snowflake Account Identifier.' }); return; }
    if (!sfUser.trim()) { setSyncMessage({ status: 'error', message: 'Please enter your Snowflake Username.' }); return; }
    if (!sfPassword.trim()) { setSyncMessage({ status: 'error', message: 'Please enter your Snowflake Password.' }); return; }

    setSyncing(true);
    setSyncMessage(null);
    setSyncMode(null);
    setSyncDetail('');
    setSyncCurrentStep(1);

    const res = await syncMonitoringSource(sourceType, {
      credentials,
      targetDatabase: (targetDatabase || typeConfig?.default_target_db || '').trim().toUpperCase(),
      targetSchema: (targetSchema || typeConfig?.default_target_schema || '').trim().toUpperCase(),
      snowflakeCredentials: {
        account: sfAccount.trim(),
        username: sfUser.trim(),
        password: sfPassword,
        warehouse: (sfWarehouse || 'COMPUTE_WH').trim(),
        role: sfRole ? sfRole.trim() : null
      }
    }, (event) => {
      if (event.type === 'step') { setSyncCurrentStep(event.step); setSyncDetail(event.message || ''); }
      if (event.type === 'mode') setSyncMode(event.mode);
      if (event.type === 'log') setSyncDetail(event.message || '');
    });

    if (res && res.status === 'success') {
      setSyncCurrentStep(6);
      const discovery = res.kpi_discovery;
      const detail = res.mode === 'setup' && discovery
        ? ` ${discovery.active_kpis.length} AI-selected KPIs active${discovery.rejected_kpis.length ? `, ${discovery.rejected_kpis.length} rejected by validation` : ''}.`
        : ' Source already registered with unchanged structure — KPI discovery skipped.';
      const roleWarning = res.readonly_role && !res.readonly_role.ready ? ' Read-only chatbot role could not be fully provisioned; see backend logs.' : '';
      setSyncMessage({ status: 'success', message: `${res.message}.${detail}${roleWarning}` });
      onSynced(res);
      setTimeout(() => { setSyncing(false); setSyncCurrentStep(0); onClose(); }, 2000);
    } else {
      setSyncMessage({ status: 'error', message: res?.detail || res?.message || 'Sync failed. Please verify credentials.' });
      setSyncing(false);
      setSyncCurrentStep(0);
    }
  };

  const allSteps = [
    { step: 1, title: `Authenticating ${label} API`, desc: 'Verifying credentials and resolving source identity' },
    { step: 2, title: 'Pulling Source Metadata', desc: 'Fetching jobs, runs and run results through the source adapter' },
    { step: 3, title: 'Connecting to Snowflake & Loading Tables', desc: `Checking source registry and loading GOV_* tables in ${targetDatabase}.${targetSchema}` },
    { step: 4, title: 'Analyze & Build with AI', desc: 'LLM proposes KPIs from this source\'s metadata; each SQL is validated and materialized as a view', aiOnly: true },
    { step: 5, title: 'Rendering Live Dashboard', desc: 'Executing KPI views for this source' },
  ];
  const visibleSteps = syncMode === 'refresh' ? allSteps.filter((s) => !s.aiOnly) : allSteps;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2.5 rounded-xl bg-[#ECEFFF] text-[#10338D] border border-[#D1DEFF]">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1E1E1E]">Sync Live {label} &amp; Snowflake</h3>
              <p className="text-xs text-[#666666]">New or changed sources are analyzed by AI once; registered sources simply refresh</p>
            </div>
          </div>
          <button onClick={handleClose} disabled={syncing} className="p-2 text-[#94A3B8] hover:text-[#1E1E1E] rounded-xl hover:bg-[#F1F5F9] transition-colors cursor-pointer disabled:opacity-30">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SYNC PROGRESS STEPPER */}
        {syncing ? (
          <div className="bg-[#F8F9FC] border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
            <div className="flex items-center space-x-2 text-[#10338D] font-bold text-xs uppercase tracking-wider">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {syncMode === 'setup' ? `Setting Up ${label} Source with AI...` : syncMode === 'refresh' ? `Refreshing Registered ${label} Source...` : `Executing ${label} & Snowflake Sync Pipeline...`}
              </span>
            </div>
            <div className="space-y-3 text-xs">
              {visibleSteps.map(({ step, title, desc }, idx) => (
                <div key={step} className={`flex items-center space-x-3 p-2.5 rounded-xl transition-all ${
                  syncCurrentStep >= step
                    ? (syncCurrentStep > step ? 'bg-[#F0FDF4] border border-[#BBF7D0] text-[#16A34A]' : 'bg-[#ECEFFF] border border-[#D1DEFF] text-[#10338D]')
                    : 'text-[#94A3B8]'
                }`}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold">
                    {syncCurrentStep > step ? <CheckCircle2 className="w-4 h-4 text-[#16A34A]" /> : (syncCurrentStep === step ? <Loader2 className="w-4 h-4 animate-spin text-[#1C58F6]" /> : idx + 1)}
                  </div>
                  <div>
                    <div className="font-bold">Step {idx + 1}: {title}</div>
                    <div className="text-[10px] text-[#94A3B8]">{syncCurrentStep === step && syncDetail ? syncDetail : desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* 1. Source Section */}
            <div className="space-y-3 bg-[#F8F9FC] border border-[#E2E8F0] rounded-2xl p-4">
              <div className="text-[11px] font-bold text-[#10338D] uppercase tracking-wider flex items-center space-x-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>1. Source Type &amp; Credentials</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[#444444] font-semibold">Source Type <span className="text-[#DC2626]">*</span></label>
                <div className="relative">
                  <select
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value)}
                    className={`${INPUT_CLASS} appearance-none pr-8 cursor-pointer font-semibold`}
                  >
                    {sourceTypes.length === 0 && <option value={sourceType}>Loading source types...</option>}
                    {sourceTypes.map((t) => <option key={t.source_type} value={t.source_type}>{t.display_label}</option>)}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-[#666666] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {(typeConfig?.credential_fields || []).map((field) => (
                field.type === 'checkbox' ? (
                  <label key={field.key} className="flex items-center space-x-2 text-[#444444] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(credentials[field.key])}
                      onChange={(e) => setCredential(field.key, e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#10338D] cursor-pointer"
                    />
                    <span>{field.label}</span>
                  </label>
                ) : (
                  <div key={field.key} className="space-y-1.5">
                    <label className="text-[#444444] font-semibold">
                      {field.label} {field.required && <span className="text-[#DC2626]">*</span>}
                    </label>
                    <input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={credentials[field.key] ?? ''}
                      onChange={(e) => setCredential(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className={INPUT_CLASS}
                    />
                    {field.help && <p className="text-[10px] text-[#94A3B8]">{field.help}</p>}
                  </div>
                )
              ))}

              <div className="pt-1 flex items-center justify-between">
                <button type="button" onClick={handleTestConnection} disabled={testingConn || !typeConfig || (missingRequired.length > 0 && !sampleMode)} className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#ECEFFF] text-[#10338D] border border-[#D1DEFF] font-bold text-[11px] cursor-pointer flex items-center space-x-1.5 transition-all disabled:opacity-50">
                  {testingConn ? <Loader2 className="w-3 h-3 animate-spin text-[#1C58F6]" /> : <Shield className="w-3 h-3" />}
                  <span>{testingConn ? 'Testing API...' : 'Test Connection & Verify'}</span>
                </button>
                {testResult && (
                  <div className={`text-[11px] font-mono flex items-center space-x-1 ${testResult.status === 'success' ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                    {testResult.status === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate max-w-xs">{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Snowflake Section */}
            <div className="space-y-3 bg-[#F8F9FC] border border-[#E2E8F0] rounded-2xl p-4">
              <div className="text-[11px] font-bold text-[#1C58F6] uppercase tracking-wider flex items-center space-x-1.5">
                <Database className="w-3.5 h-3.5" />
                <span>2. Target Snowflake Connection &amp; Credentials</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Snowflake Account Identifier', value: sfAccount, setter: setSfAccount, placeholder: 'e.g. xy12345.us-east-1' },
                  { label: 'Snowflake Username', value: sfUser, setter: setSfUser, placeholder: 'e.g. ADHANAN' },
                  { label: 'Snowflake Password', value: sfPassword, setter: setSfPassword, placeholder: '••••••••••••', type: 'password' },
                  { label: 'Warehouse', value: sfWarehouse, setter: setSfWarehouse, placeholder: 'COMPUTE_WH' },
                  { label: 'Target Database', value: targetDatabase, setter: setTargetDatabase, placeholder: typeConfig?.default_target_db },
                  { label: 'Target Schema', value: targetSchema, setter: setTargetSchema, placeholder: typeConfig?.default_target_schema },
                ].map((field) => (
                  <div key={field.label} className="space-y-1.5">
                    <label className="text-[#444444] font-semibold">{field.label}</label>
                    <input type={field.type || 'text'} value={field.value} onChange={(e) => field.setter(e.target.value)} placeholder={field.placeholder} className="w-full bg-white border border-[#D1DEFF] rounded-xl px-3.5 py-2 text-[#1E1E1E] font-mono text-xs focus:outline-none focus:border-[#1C58F6]" />
                  </div>
                ))}
              </div>
              {adoptedExistingTarget && (
                <div className="text-[10.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2 leading-relaxed">
                  Using <strong className="font-mono">{existingForType.target_db}</strong> because your
                  existing {label} source is already stored there. The default for this source type is{' '}
                  <span className="font-mono">{defaultDbForType}</span> — syncing to that instead would
                  create a second, empty set of monitoring tables rather than updating your data.
                </div>
              )}
              <p className="text-[10px] text-[#94A3B8]">
                Loads GOV_JOBS, GOV_RUNS, GOV_RUN_RESULTS{typeConfig?.extension_tables?.length ? ` + ${typeConfig.extension_tables.join(', ')}` : ''} and KPI views in {targetDatabase}.{targetSchema}
              </p>
            </div>
          </div>
        )}

        {/* Sync Feedback */}
        {syncMessage && (
          <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${syncMessage.status === 'success' ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]' : 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]'}`}>
            {syncMessage.status === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{syncMessage.message}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button type="button" onClick={handleClose} disabled={syncing} className="px-4 py-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#666666] text-xs font-bold cursor-pointer transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={handleSyncNow} disabled={syncing || !typeConfig} className="px-5 py-2.5 rounded-xl bg-[#10338D] hover:bg-[#1C58F6] text-white text-xs font-bold cursor-pointer flex items-center space-x-2 shadow-lg transition-all disabled:opacity-50">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Sparkles className="w-4 h-4 text-white" />}
            <span>{syncing ? 'Syncing Source...' : 'Sync & Build Dashboard'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
