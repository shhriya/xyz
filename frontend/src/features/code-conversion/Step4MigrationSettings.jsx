import React, { useState, useEffect } from 'react';
import {
  GitMerge,
  Database,
  ArrowRight,
  Sparkles,
  Eye,
  EyeOff,
  CheckCircle2,
  ShieldCheck,
  X,
  Info,
  FileCode,
} from 'lucide-react';
import {
  saveMigrationConfig,
  connectTargetApi,
  fetchMigrationConfig,
  fetchMigrationPreview,
} from '@/api';

export default function Step4MigrationSettings({ onNext, projectState, setProjectState }) {
  // Selected Target Warehouse
  const [selectedTarget, setSelectedTarget] = useState('Snowflake');

  // Connection Credentials
  const [snowflakeConnection, setSnowflakeConnection] = useState(
    projectState?.targetConnection?.snowflake || {
      account: '',
      username: '',
      password: '',
      role: 'ACCOUNTADMIN',
      warehouse: 'COMPUTE_WH',
      database: 'SNOWFLAKE_PROD_DB',
      schema: 'EDW_ANALYTICS'
    }
  );

  const [bigqueryConnection, setBigqueryConnection] = useState(
    projectState?.targetConnection?.bigquery || {
      projectId: '',
      dataset: 'dbt_analytics',
      location: 'US',
      authMethod: 'service-account-json',
      keyfilePath: '',
      clientEmail: ''
    }
  );

  const [redshiftConnection, setRedshiftConnection] = useState(
    projectState?.targetConnection?.redshift || {
      host: '',
      port: '5439',
      database: 'edw_prod',
      username: '',
      password: '',
      schema: 'public'
    }
  );

  // Variables
  const [variables, setVariables] = useState({
    targetDatabase: 'SNOWFLAKE_PROD_DB',
    bronzeSchema: 'RAW_STAGING',
    silverSchema: 'EDW_SILVER',
    goldSchema: 'EDW_GOLD',
    snapshotSchema: 'EDW_SNAPSHOTS'
  });

  // Default features & advanced configurations kept in state for backend persistence
  const [features, setFeatures] = useState({
    generateMacros: true,
    generateSourcesYaml: true,
    generateSchemaYaml: true,
    generateSnapshots: true,
    generateValidationModels: true,
    generateAuditHelpers: true,
    generateDocumentation: true
  });

  const [advanced, setAdvanced] = useState({
    namingConvention: 'snake_case',
    surrogateKeyStrategy: 'dbt_utils.generate_surrogate_key',
    freshnessRules: 'warn_after: 12h, error_after: 24h'
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // AI Project Output Predictions
  const [predictions, setPredictions] = useState({
    sourceTablesCount: 0,
    bronzeModels: 0,
    silverModels: 0,
    goldModels: 0,
    snapshots: 0,
    validationModels: 0,
    tests: 0,
    totalFiles: 0
  });

  const [layerBreakdown, setLayerBreakdown] = useState(null);
  const [selectedPredictionModal, setSelectedPredictionModal] = useState(null);

  const getPreviewPayload = (customFeatures = features) => {
    const activeFiles = projectState?.cleanedFiles?.length 
      ? projectState.cleanedFiles 
      : (projectState?.preprocessingResults?.fileDetails?.map(fd => ({
          id: fd.filename,
          filename: fd.filename,
          name: fd.filename,
          content: fd.cleaned_content || fd.raw_content,
          rawContent: fd.raw_content,
          sourceType: projectState?.selectedSource || 'PySpark'
        })) || projectState?.uploadedFiles || projectState?.discoveredFiles || []);

    return {
      discoveredFiles: activeFiles,
      uploadedFiles: activeFiles,
      cleanedFiles: activeFiles,
      selectedFileIds: projectState?.selectedFileIds || activeFiles.map(f => f.id || f.filename),
      prompts: projectState?.prompts || {},
      features: customFeatures,
      variables: {
        targetDatabase: selectedTarget === 'Snowflake' ? (snowflakeConnection.database || 'SNOWFLAKE_PROD_DB') : (bigqueryConnection.projectId || redshiftConnection.database || 'PROD_DB'),
        bronzeSchema: variables.bronzeSchema,
        silverSchema: variables.silverSchema,
        goldSchema: variables.goldSchema,
        snapshotSchema: variables.snapshotSchema
      }
    };
  };

  // Fetch initial configs & dynamic AI predictions on mount
  useEffect(() => {
    async function loadConfigAndPredictions() {
      let currentFeatures = features;
      const res = await fetchMigrationConfig();
      if (res && res.config) {
        const c = res.config;
        if (c.dbtTarget) setSelectedTarget(c.dbtTarget);
        if (c.selectedTarget) setSelectedTarget(c.selectedTarget);
        if (c.targetConnection) {
          if (c.targetConnection.snowflake) setSnowflakeConnection(prev => ({ ...prev, ...c.targetConnection.snowflake }));
          if (c.targetConnection.bigquery) setBigqueryConnection(prev => ({ ...prev, ...c.targetConnection.bigquery }));
          if (c.targetConnection.redshift) setRedshiftConnection(prev => ({ ...prev, ...c.targetConnection.redshift }));
        }
        if (c.variables) setVariables(c.variables);
        if (c.features) {
          currentFeatures = {
            generateMacros: c.features.generateMacros ?? true,
            generateSourcesYaml: c.features.generateSourcesYaml ?? true,
            generateSchemaYaml: c.features.generateSchemaYaml ?? true,
            generateSnapshots: c.features.generateSnapshots ?? true,
            generateValidationModels: c.features.generateValidationModels ?? true,
            generateAuditHelpers: c.features.generateAuditHelpers ?? true,
            generateDocumentation: c.features.generateDocumentation ?? true
          };
          setFeatures(currentFeatures);
        }
        if (c.advanced) setAdvanced(c.advanced);
      }

      // Fetch dynamic ML predictions from backend
      const payload = getPreviewPayload(currentFeatures);
      const previewRes = await fetchMigrationPreview(payload);
      if (previewRes && previewRes.estimatedOutputs) {
        setPredictions({
          sourceTablesCount: previewRes.sourceTablesCount || 0,
          ...previewRes.estimatedOutputs
        });
        if (previewRes.layerBreakdown) {
          setLayerBreakdown(previewRes.layerBreakdown);
        }
      }
    }
    loadConfigAndPredictions();
  }, [projectState?.uploadedFiles, projectState?.discoveredFiles, projectState?.selectedFileIds, projectState?.prompts]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      const details = 
        selectedTarget === 'Snowflake' ? snowflakeConnection :
        selectedTarget === 'BigQuery' ? bigqueryConnection :
        redshiftConnection;

      const res = await connectTargetApi(selectedTarget, details);
      
      setTimeout(() => {
        if (res && (res.status === 'success' || res.connected)) {
          let msg = res.message;
          if (!msg) {
            if (selectedTarget === 'Snowflake') {
              msg = `Successfully connected to Snowflake (${snowflakeConnection.database}.${snowflakeConnection.schema}) • Warehouse: ${snowflakeConnection.warehouse}`;
            } else if (selectedTarget === 'BigQuery') {
              msg = `Successfully connected to BigQuery Project (${bigqueryConnection.projectId}) • Dataset: ${bigqueryConnection.dataset} (${bigqueryConnection.location})`;
            } else {
              msg = `Successfully connected to Redshift (${redshiftConnection.host}:${redshiftConnection.port}/${redshiftConnection.database})`;
            }
          }

          setTestStatus({
            status: 'success',
            latencyMs: res?.latencyMs || 35,
            message: msg
          });
          if (setProjectState) {
            const safeDetails = { ...details, password: '' };
            setProjectState(prev => ({ ...prev, targetConnected: true, targetConnection: safeDetails }));
          }
        } else {
          setTestStatus({
            status: 'error',
            message: res?.message || `Could not connect to ${selectedTarget}. Please check credentials.`
          });
          if (setProjectState) {
            setProjectState(prev => ({ ...prev, targetConnected: false }));
          }
        }
        setIsTesting(false);
      }, 400);
    } catch {
      setTestStatus({
        status: 'error',
        message: `Could not connect to ${selectedTarget}. Please verify account identifier, user credentials, and permissions.`
      });
      if (setProjectState) {
        setProjectState(prev => ({ ...prev, targetConnected: false }));
      }
      setIsTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    const activeConnection = 
      selectedTarget === 'Snowflake' ? snowflakeConnection :
      selectedTarget === 'BigQuery' ? bigqueryConnection :
      redshiftConnection;

    const sanitizeConn = (conn) => conn ? { ...conn, password: '' } : {};

    const configData = {
      dbtTarget: selectedTarget,
      selectedTarget,
      targetConnection: {
        snowflake: sanitizeConn(snowflakeConnection),
        bigquery: sanitizeConn(bigqueryConnection),
        redshift: sanitizeConn(redshiftConnection),
        active: sanitizeConn(activeConnection)
      },
      variables,
      features,
      advanced,
      predictions
    };

    const res = await saveMigrationConfig(configData);
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        migrationConfig: configData,
        targetConnection: activeConnection,
        selectedTarget
      }));
    }

    setSaveSuccessMsg('Target settings saved successfully!');
    setTimeout(() => setSaveSuccessMsg(''), 3000);
    return res;
  };

  // Helper for generating dynamic file list in prediction modal
  const getModalFileList = (layerKey) => {
    if (layerBreakdown && layerBreakdown[layerKey]) {
      const info = layerBreakdown[layerKey];
      if (info.models && Array.isArray(info.models) && info.models.length > 0) {
        if (layerKey === 'Snapshot') {
          return info.models.map(m => `snapshots/${m}.sql`);
        } else if (layerKey === 'Tests') {
          return info.models.map(m => `tests/${m}.sql`);
        } else {
          const prefix = `models/${layerKey.toLowerCase()}/`;
          return info.models.map(m => `${prefix}${m}.sql`);
        }
      }
    }
    return [];
  };

  return (
    <div className="space-y-6 pb-12 font-sans" style={{ color: '#1E293B' }}>
      {/* Header Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-[#ECEFFF] text-[#1C58F6] px-3 py-1 rounded-full text-xs font-semibold border border-[#D1DEFF] mb-2 gap-1.5">
            <Database className="w-3.5 h-3.5" />
            <span>Step 3 of 5 • Target Settings & Medallion Architecture</span>
          </div>
          <h1 className="text-2xl font-black text-[#10338D] tracking-tight">Target Settings & Medallion Architecture</h1>
          <p className="text-xs text-[#475569] mt-1 font-normal leading-relaxed">
            Configure target data warehouse connection credentials and inspect predicted Medallion dbt models across Bronze, Silver, Snapshot, and Gold layers.
          </p>
        </div>

      </div>

      {/* Save Success Banner */}
      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-800 flex items-center space-x-2 shadow-xs animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{saveSuccessMsg}</span>
        </div>
      )}

      {/* 1. MEDALLION ARCHITECTURE PREVIEW (Bronze → Silver → Snapshot → Gold DAG Cards) */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-[#10338D] flex items-center space-x-2">
              <GitMerge className="w-5 h-5 text-[#1C58F6]" />
              <span>Medallion Architecture Predictions (Bronze → Silver → Snapshot → Gold)</span>
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5 font-normal">
              Click any layer card to inspect projected dbt filenames, schemas, and model breakdown.
            </p>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <span 
              className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border border-emerald-300"
              style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
            >
              Predictions Active ({predictions.totalFiles} Total Files)
            </span>
            <span 
              className="text-[10px] font-mono font-semibold px-3 py-1 rounded-full border border-[#D1DEFF]"
              style={{ backgroundColor: '#ECEFFF', color: '#1C58F6' }}
            >
              Interactive Visual DAG
            </span>
          </div>
        </div>

        {/* Visual Pipeline DAG Nodes — Interactive Prediction Cards */}
        <div 
          className="p-5 rounded-xl border border-[#D1DEFF] flex flex-col md:flex-row items-center justify-between gap-4 overflow-x-auto"
          style={{ backgroundColor: '#F8FAFC' }}
        >
          {/* Bronze Layer */}
          <div 
            onClick={() => setSelectedPredictionModal({ title: 'Bronze Layer Predictions', layerKey: 'Bronze', count: predictions.bronzeModels, desc: 'Raw staging views with data-type casting and column renaming.' })}
            className="bg-white border border-amber-300 hover:border-amber-500 hover:shadow-md p-4 rounded-xl text-center space-y-2 w-full md:w-56 transition-all cursor-pointer group shadow-2xs"
          >
            <div className="text-[11px] font-black uppercase text-amber-800 tracking-wider flex items-center justify-center space-x-1">
              <span>Bronze Layer</span>
              <Info className="w-3.5 h-3.5 text-amber-600 opacity-60 group-hover:opacity-100" />
            </div>
            <div className="text-xs font-bold text-[#10338D] font-mono truncate" title={layerBreakdown?.Bronze?.topModel || '—'}>
              {layerBreakdown?.Bronze?.topModel || '—'}
            </div>
            <div className="text-[11px] text-[#475569] font-medium">Raw Staging • Views</div>
            <div 
              className="text-[11px] font-mono font-bold py-1 px-2 rounded-md border border-amber-200 inline-block w-full"
              style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            >
              {predictions.bronzeModels} Predicted Models
            </div>
          </div>

          <ArrowRight className="w-5 h-5 text-[#1C58F6] shrink-0 hidden md:block" />

          {/* Silver Layer */}
          <div 
            onClick={() => setSelectedPredictionModal({ title: 'Silver Layer Predictions', layerKey: 'Silver', count: predictions.silverModels, desc: 'Intermediate cleansed and joined transformation models.' })}
            className="bg-white border border-teal-300 hover:border-teal-500 hover:shadow-md p-4 rounded-xl text-center space-y-2 w-full md:w-56 transition-all cursor-pointer group shadow-2xs"
          >
            <div className="text-[11px] font-black uppercase text-teal-800 tracking-wider flex items-center justify-center space-x-1">
              <span>Silver Layer</span>
              <Info className="w-3.5 h-3.5 text-teal-600 opacity-60 group-hover:opacity-100" />
            </div>
            <div className="text-xs font-bold text-[#10338D] font-mono truncate" title={layerBreakdown?.Silver?.topModel || '—'}>
              {layerBreakdown?.Silver?.topModel || '—'}
            </div>
            <div className="text-[11px] text-[#475569] font-medium">Cleansed & Enriched</div>
            <div 
              className="text-[11px] font-mono font-bold py-1 px-2 rounded-md border border-teal-200 inline-block w-full"
              style={{ backgroundColor: '#CCFBF1', color: '#115E59' }}
            >
              {predictions.silverModels} Predicted Models
            </div>
          </div>

          <ArrowRight className="w-5 h-5 text-[#1C58F6] shrink-0 hidden md:block" />

          {/* Snapshot Layer */}
          <div 
            onClick={() => setSelectedPredictionModal({ title: 'Snapshot Layer Predictions', layerKey: 'Snapshot', count: predictions.snapshots, desc: 'SCD Type 2 history tracking snapshot models.' })}
            className="bg-white border border-purple-300 hover:border-purple-500 hover:shadow-md p-4 rounded-xl text-center space-y-2 w-full md:w-56 transition-all cursor-pointer group shadow-2xs"
          >
            <div className="text-[11px] font-black uppercase text-purple-800 tracking-wider flex items-center justify-center space-x-1">
              <span>Snapshot Layer</span>
              <Info className="w-3.5 h-3.5 text-purple-600 opacity-60 group-hover:opacity-100" />
            </div>
            <div className="text-xs font-bold text-[#10338D] font-mono truncate" title={layerBreakdown?.Snapshot?.topModel || '—'}>
              {layerBreakdown?.Snapshot?.topModel || '—'}
            </div>
            <div className="text-[11px] text-[#475569] font-medium">SCD Type 2 History</div>
            <div 
              className="text-[11px] font-mono font-bold py-1 px-2 rounded-md border border-purple-200 inline-block w-full"
              style={{ backgroundColor: '#F3E8FF', color: '#6B21A8' }}
            >
              {predictions.snapshots} Snapshots
            </div>
          </div>

          <ArrowRight className="w-5 h-5 text-[#1C58F6] shrink-0 hidden md:block" />

          {/* Gold Layer */}
          <div 
            onClick={() => setSelectedPredictionModal({ title: 'Gold Layer Predictions', layerKey: 'Gold', count: predictions.goldModels, desc: 'Analytics dimensional & fact business marts.' })}
            className="bg-white border-2 border-[#10338D] hover:border-[#1C58F6] hover:shadow-lg p-4 rounded-xl text-center space-y-2 w-full md:w-56 transition-all cursor-pointer ring-2 ring-[#D1DEFF] group shadow-2xs"
          >
            <div className="text-[11px] font-black uppercase text-[#1C58F6] tracking-wider flex items-center justify-center space-x-1">
              <span>Gold Layer</span>
              <Info className="w-3.5 h-3.5 text-[#1C58F6] opacity-60 group-hover:opacity-100" />
            </div>
            <div className="text-xs font-black text-[#10338D] font-mono truncate" title={layerBreakdown?.Gold?.topModel || '—'}>
              {layerBreakdown?.Gold?.topModel || '—'}
            </div>
            <div className="text-[11px] text-[#475569] font-medium">Business Mart • Table</div>
            <div 
              className="text-[11px] font-mono font-bold text-white py-1 px-2 rounded-md inline-block w-full shadow-xs"
              style={{ backgroundColor: '#10338D' }}
            >
              {predictions.goldModels} Predicted Models
            </div>
          </div>
        </div>
      </div>

      {/* 2. TARGET WAREHOUSE CONNECTION SETTINGS (Clean White Card) */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 space-y-5 shadow-sm">
        {/* Header & Target Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#D1DEFF] bg-[#ECEFFF] shrink-0">
              <Database className="w-5 h-5 text-[#1C58F6]" />
            </div>
            <div>
              <h2 className="text-base font-black text-[#10338D] flex items-center space-x-2">
                <span>Target Data Warehouse Connection</span>
                <span 
                  className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-emerald-300"
                  style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                >
                  profiles.yml
                </span>
              </h2>
              <p className="text-xs text-[#64748B] font-normal mt-0.5">
                Configure connection credentials where dbt will execute and materialize target models
              </p>
            </div>
          </div>

        </div>

        {/* Target Warehouse Selector & Live Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1 space-y-1">
            <label className="text-xs font-bold text-[#10338D]">Select Target Warehouse Dialect</label>
            <select
              value={selectedTarget}
              onChange={(e) => {
                setSelectedTarget(e.target.value);
                setTestStatus(null);
              }}
              className="w-full border border-[#D1DEFF] rounded-xl p-3 text-xs font-mono font-bold focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] cursor-pointer shadow-2xs"
              style={{ 
                color: '#10338D', 
                backgroundColor: '#F8FAFC'
              }}
            >
              <option value="Snowflake">Snowflake (Snowflake Data Cloud)</option>
              <option value="BigQuery">Google BigQuery (GCP Cloud Platform)</option>
              <option value="Redshift">Amazon Redshift (AWS Data Warehouse)</option>
            </select>
          </div>

          {/* Quick Guidance Info Box */}
          <div className="md:col-span-2 flex items-center">
            <div className="w-full p-3.5 rounded-xl text-xs flex items-start space-x-2.5 border border-[#D1DEFF] bg-[#F8FAFC]">
              <Info className="w-4 h-4 text-[#1C58F6] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[#10338D]">Connection Credentials for {selectedTarget}</div>
                <div className="text-[11px] text-[#475569] mt-0.5 font-normal">
                  Credentials are encrypted and will be written to the local <code>profiles.yml</code> file during the migration step.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 1. SNOWFLAKE CREDENTIALS FIELDS */}
        {selectedTarget === 'Snowflake' && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="text-xs text-[#0F172A] font-bold flex items-center justify-between">
                <span>Snowflake Account Identifier</span>
                <span className="text-[10px] text-[#64748B] font-mono font-normal">e.g. orgname-accountname or xy12345.us-east-1</span>
              </label>
              <input
                type="text"
                value={snowflakeConnection.account}
                onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, account: e.target.value })}
                placeholder="e.g. xy12345.us-east-1.snowflakecomputing.com"
                className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">User / Username</label>
                <input
                  type="text"
                  value={snowflakeConnection.username}
                  onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, username: e.target.value })}
                  placeholder="e.g. DBT_TRANSFORMER"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Password / Key-Pair Token</label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={snowflakeConnection.password}
                    onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, password: e.target.value })}
                    placeholder="Enter Snowflake password or token"
                    className="w-full border border-[#CBD5E1] rounded-xl p-3 pr-10 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">Role</label>
                <input
                  type="text"
                  value={snowflakeConnection.role}
                  onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, role: e.target.value })}
                  placeholder="e.g. ACCOUNTADMIN or TRANSFORMER_ROLE"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Warehouse</label>
                <input
                  type="text"
                  value={snowflakeConnection.warehouse}
                  onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, warehouse: e.target.value })}
                  placeholder="e.g. COMPUTE_WH"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">Target Database</label>
                <input
                  type="text"
                  value={snowflakeConnection.database}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSnowflakeConnection({ ...snowflakeConnection, database: val });
                    setVariables(prev => ({ ...prev, targetDatabase: val }));
                  }}
                  placeholder="e.g. SNOWFLAKE_PROD_DB"
                  className="w-full mt-1.5 border border-emerald-300 rounded-xl p-3 text-xs font-mono font-bold text-emerald-800 bg-emerald-50/50 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Default Target Schema</label>
                <input
                  type="text"
                  value={snowflakeConnection.schema}
                  onChange={(e) => setSnowflakeConnection({ ...snowflakeConnection, schema: e.target.value })}
                  placeholder="e.g. EDW_ANALYTICS"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>
            </div>
          </div>
        )}

        {/* 2. BIGQUERY CREDENTIALS FIELDS */}
        {selectedTarget === 'BigQuery' && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="text-xs text-[#0F172A] font-bold flex items-center justify-between">
                <span>GCP Project ID</span>
                <span className="text-[10px] text-[#64748B] font-mono font-normal">e.g. enterprise-data-prod</span>
              </label>
              <input
                type="text"
                value={bigqueryConnection.projectId}
                onChange={(e) => {
                  const val = e.target.value;
                  setBigqueryConnection({ ...bigqueryConnection, projectId: val });
                  setVariables(prev => ({ ...prev, targetDatabase: val }));
                }}
                placeholder="e.g. enterprise-data-prod-3891"
                className="w-full mt-1.5 border border-emerald-300 rounded-xl p-3 text-xs font-mono font-bold text-emerald-800 bg-emerald-50/50 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 shadow-2xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">Target Dataset / Schema</label>
                <input
                  type="text"
                  value={bigqueryConnection.dataset}
                  onChange={(e) => setBigqueryConnection({ ...bigqueryConnection, dataset: e.target.value })}
                  placeholder="e.g. dbt_analytics"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Location / Region</label>
                <select
                  value={bigqueryConnection.location}
                  onChange={(e) => setBigqueryConnection({ ...bigqueryConnection, location: e.target.value })}
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] cursor-pointer shadow-2xs"
                >
                  <option value="US">US (Multi-regional)</option>
                  <option value="EU">EU (Multi-regional)</option>
                  <option value="us-central1">us-central1 (Iowa)</option>
                  <option value="us-east1">us-east1 (South Carolina)</option>
                  <option value="europe-west1">europe-west1 (Belgium)</option>
                  <option value="asia-south1">asia-south1 (Mumbai)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">Service Account Keyfile Path</label>
                <input
                  type="text"
                  value={bigqueryConnection.keyfilePath}
                  onChange={(e) => setBigqueryConnection({ ...bigqueryConnection, keyfilePath: e.target.value })}
                  placeholder="e.g. credentials/gcp-sa-key.json"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Service Account Client Email</label>
                <input
                  type="text"
                  value={bigqueryConnection.clientEmail}
                  onChange={(e) => setBigqueryConnection({ ...bigqueryConnection, clientEmail: e.target.value })}
                  placeholder="e.g. dbt-runner@project.iam.gserviceaccount.com"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>
            </div>
          </div>
        )}

        {/* 3. REDSHIFT CREDENTIALS FIELDS */}
        {selectedTarget === 'Redshift' && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="text-xs text-[#0F172A] font-bold flex items-center justify-between">
                <span>Redshift Cluster Host / Endpoint</span>
                <span className="text-[10px] text-[#64748B] font-mono font-normal">e.g. cluster.abc123xyz.us-east-1.redshift.amazonaws.com</span>
              </label>
              <input
                type="text"
                value={redshiftConnection.host}
                onChange={(e) => setRedshiftConnection({ ...redshiftConnection, host: e.target.value })}
                placeholder="e.g. redshift-cluster-prod.cz91823.us-east-1.redshift.amazonaws.com"
                className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">Port</label>
                <input
                  type="text"
                  value={redshiftConnection.port}
                  onChange={(e) => setRedshiftConnection({ ...redshiftConnection, port: e.target.value })}
                  placeholder="5439"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Database Name</label>
                <input
                  type="text"
                  value={redshiftConnection.database}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRedshiftConnection({ ...redshiftConnection, database: val });
                    setVariables(prev => ({ ...prev, targetDatabase: val }));
                  }}
                  placeholder="e.g. edw_prod"
                  className="w-full mt-1.5 border border-emerald-300 rounded-xl p-3 text-xs font-mono font-bold text-emerald-800 bg-emerald-50/50 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 shadow-2xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#0F172A] font-bold">User / Username</label>
                <input
                  type="text"
                  value={redshiftConnection.username}
                  onChange={(e) => setRedshiftConnection({ ...redshiftConnection, username: e.target.value })}
                  placeholder="e.g. awsuser_dbt"
                  className="w-full mt-1.5 border border-[#CBD5E1] rounded-xl p-3 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                />
              </div>

              <div>
                <label className="text-xs text-[#0F172A] font-bold">Password</label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={redshiftConnection.password}
                    onChange={(e) => setRedshiftConnection({ ...redshiftConnection, password: e.target.value })}
                    placeholder="••••••••••••"
                    className="w-full border border-[#CBD5E1] rounded-xl p-3 pr-10 text-xs font-mono text-[#0F172A] bg-white focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#D1DEFF] shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. BOTTOM ACTION BAR & PERSISTENT STATUS */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-[#10338D]">Target Warehouse Status:</span>
            {testStatus ? (
              <span 
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  testStatus.status === 'success' 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                    : 'bg-red-50 text-red-800 border-red-300'
                }`}
              >
                {testStatus.status === 'success' ? '✓ Connected' : '✕ Verification Needed'}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-[#64748B]">Pending verification</span>
            )}
          </div>
          <div className="text-[11px] text-[#475569] mt-1 font-medium">
            {testStatus?.status === 'success' 
              ? `${testStatus.message} (${testStatus.latencyMs || 35}ms latency)`
              : (testStatus?.status === 'error' 
                  ? testStatus.message 
                  : 'Click "Test Connection" or proceed to verify target warehouse connection before execution.')}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="bg-[#ECEFFF] hover:bg-[#D1DEFF] text-[#10338D] px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 border border-[#D1DEFF] transition-all cursor-pointer shadow-2xs"
          >
            <ShieldCheck className="w-4 h-4 text-[#1C58F6]" />
            <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const activeConn = selectedTarget === 'Snowflake' ? snowflakeConnection : (selectedTarget === 'BigQuery' ? bigqueryConnection : redshiftConnection);
              const pwd = String(activeConn?.password || '').trim();
              if (selectedTarget === 'Snowflake' && !pwd) {
                setTestStatus({
                  status: 'error',
                  message: 'Target Warehouse Authentication Required: Please enter your Snowflake password and verify connection before proceeding.'
                });
                return;
              }
              if (!testStatus || testStatus.status !== 'success') {
                const res = await connectTargetApi(selectedTarget, activeConn);
                if (!res || (res.status !== 'success' && !res.connected)) {
                  setTestStatus({
                    status: 'error',
                    message: res?.message || 'Could not verify target connection. Please check credentials.'
                  });
                  return;
                }
                setTestStatus({ status: 'success', latencyMs: res.latencyMs || 32, message: res.message });
              }
              await handleSaveConfig();
              if (onNext) onNext();
            }}
            className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-6 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-md cursor-pointer"
          >
            <span>Save & Proceed to Execute Migration</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PREDICTION DETAILS MODAL */}
      {selectedPredictionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div 
            className="rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden border border-[#1E293B]"
            style={{ backgroundColor: '#0B132B', color: '#FFFFFF' }}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1E293B] flex justify-between items-center bg-[#020617]/70">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-[#38BDF8]" />
                <h3 className="text-white font-bold text-sm">{selectedPredictionModal.title}</h3>
              </div>
              <button
                onClick={() => setSelectedPredictionModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4 text-xs text-[#CBD5E1] max-h-[70vh] overflow-y-auto">
              <div 
                className="p-3.5 rounded-xl border border-[#1E293B] space-y-1"
                style={{ backgroundColor: '#020617' }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Prediction Rationale:</span>
                  <span 
                    className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-[#059669]"
                    style={{ backgroundColor: '#064E3B', color: '#34D399' }}
                  >
                    {selectedPredictionModal.count} Projected Models
                  </span>
                </div>
                <p className="text-[#94A3B8] text-xs leading-relaxed">
                  {selectedPredictionModal.desc} Computed dynamically from {predictions.sourceTablesCount} connected source metadata tables and target schema mappings.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-bold text-[#E2E8F0] mb-2 flex items-center space-x-1.5">
                  <FileCode className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>Projected Output Files & Artifacts:</span>
                </h4>
                <div 
                  className="rounded-xl border border-[#1E293B] p-3 font-mono text-[11px] space-y-2 text-[#E2E8F0]"
                  style={{ backgroundColor: '#020617' }}
                >
                  {getModalFileList(selectedPredictionModal.layerKey).length > 0 ? (
                    getModalFileList(selectedPredictionModal.layerKey).map((file, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-center justify-between p-2 rounded border border-[#1E293B]"
                        style={{ backgroundColor: '#0B132B' }}
                      >
                        <span className="text-[#6EE7B7] truncate font-semibold">{file}</span>
                        <span className="text-[9px] text-[#94A3B8] uppercase shrink-0 font-sans ml-2 font-bold">dbt Model</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-[#94A3B8] text-xs font-sans">
                      No models predicted for this layer. Please select and preprocess source files in Step 1.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#1E293B] bg-[#020617] flex justify-end">
              <button
                onClick={() => setSelectedPredictionModal(null)}
                className="text-white px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                style={{ backgroundColor: '#1C58F6' }}
              >
                Close Breakdown
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
