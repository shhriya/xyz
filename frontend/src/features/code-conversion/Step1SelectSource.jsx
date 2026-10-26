import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Flame,
  Server,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Eye,
  EyeOff,
  Zap,
  FileCode,
  Filter,
  ArrowDownCircle,
  Sparkles,
  Loader2,
  AlertTriangle,
  FolderOpen,
  Search,
  CheckSquare,
  Square,
  X,
  Copy,
  Check,
  Code2,
  Bookmark,
  Plus,
  Upload,
  HardDrive,
  FolderCheck,
  FileUp,
} from 'lucide-react';
import { connectSource, testConnection, preprocessSource, discoverSourceFiles, fetchSavedSourceConnections, saveSourceConnection, uploadSourceFolder } from '@/api';

const SOURCE_TYPES = [
  {
    id: 'Informatica PowerCenter',
    category: 'Legacy ETL',
    desc: 'Connect to Informatica PowerCenter repository to auto-fetch workflows, mappings, and transformations.',
    icon: Server,
    badge: 'Popular',
    color: '#FF6B35',
    bgGradient: 'from-orange-500/10 to-orange-600/5',
    borderColor: 'border-orange-500',
    badgeBg: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    defaultFolder: 'GLOBAL_EDW_MKTG'
  },
  {
    id: 'PySpark (Databricks)',
    category: 'Code ETL',
    desc: 'Connect to Databricks workspace to auto-fetch PySpark notebooks, jobs, and transformation scripts.',
    icon: Flame,
    badge: 'Spark',
    color: '#E23838',
    bgGradient: 'from-red-500/10 to-red-600/5',
    borderColor: 'border-red-500',
    badgeBg: 'bg-red-500/15 text-red-400 border-red-500/30',
    defaultFolder: '/Shared/ETL/pyspark_jobs/'
  }
];

// Informatica connection fields
const INFORMATICA_FIELDS = [
  { key: 'repository', label: 'Repository Name', placeholder: 'REP_GLOBAL_EDW', required: true, icon: '📦' },
  { key: 'domain', label: 'Domain', placeholder: 'DOM_ENTERPRISE', required: true, icon: '🌐' },
  { key: 'integrationService', label: 'Integration Service', placeholder: 'IS_DATA_QUALITY', required: true, icon: '⚙️' },
  { key: 'account', label: 'Gateway Host / Node', placeholder: 'infa-node01.corp.internal:6005', required: false, icon: '🖥️' },
  { key: 'username', label: 'Username / User ID', placeholder: 'infa_admin', required: true, icon: '👤' },
  { key: 'password', label: 'Password / Security Token', placeholder: '••••••••••••', required: true, type: 'password', icon: '🔒' },
  { key: 'folder', label: 'Repository Folder Path', placeholder: 'GLOBAL_EDW_MKTG', required: false, icon: '📁', hint: 'Folder to scan. E.g. GLOBAL_EDW_MKTG or local folder path.' },
];

// Databricks / PySpark connection fields
const DATABRICKS_FIELDS = [
  { key: 'workspace', label: 'Databricks Workspace URL', placeholder: 'https://adb-123456789.azuredatabricks.net', required: true, icon: '🔗' },
  { key: 'token', label: 'Personal Access Token (PAT)', placeholder: 'dapi-xxxxxxxxxxxx', required: true, type: 'password', icon: '🔑' },
  { key: 'catalog', label: 'Unity Catalog Name', placeholder: 'main', required: true, icon: '📚' },
  { key: 'clusterName', label: 'Cluster / SQL Warehouse', placeholder: 'ETL_Cluster_01', required: false, icon: '💻' },
  { key: 'notebookPath', label: 'Workspace Folder / Project Path', placeholder: '/Shared/ETL/pyspark_jobs/', required: false, icon: '📂', hint: 'Folder to scan. E.g. /Shared/ETL/pyspark_jobs/ or local folder.' },
  { key: 'branch', label: 'Git Branch (if Repos)', placeholder: 'main', required: false, icon: '🌿' },
];

// Preprocessing step animations
const PREPROCESSING_STEPS = {
  'Informatica PowerCenter': [
    { id: 1, label: 'Reading selected Informatica XML definitions...', duration: 1200 },
    { id: 2, label: 'Parsing source/target table schemas & connectors...', duration: 1500 },
    { id: 3, label: 'Extracting transformation expressions, lookups & filters...', duration: 1800 },
    { id: 4, label: 'Stripping GUI layout coordinates & runtime configs...', duration: 1000 },
    { id: 5, label: 'Compacting metadata for dbt Jinja models...', duration: 800 },
    { id: 6, label: 'Token optimization complete ✓', duration: 400 },
  ],
  'PySpark (Databricks)': [
    { id: 1, label: 'Fetching selected PySpark script source code...', duration: 1200 },
    { id: 2, label: 'Parsing AST and extracting spark.read / df.write calls...', duration: 1600 },
    { id: 3, label: 'Mapping DataFrame transformations, aggregations & UDFs...', duration: 1800 },
    { id: 4, label: 'Stripping imports, logging, argparse & boilerplate...', duration: 1000 },
    { id: 5, label: 'Compacting logic for dbt SQL models...', duration: 800 },
    { id: 6, label: 'Token optimization complete ✓', duration: 400 },
  ]
};

export default function Step1SelectSource({ onNext, projectState = {}, setProjectState }) {
  const [selectedSource, setSelectedSource] = useState(projectState?.selectedSource || '');
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState(projectState?.connectionDetails || {
    repository: '', domain: '', integrationService: '', account: '',
    username: '', password: '', folder: '',
    workspace: '', token: '', catalog: '', clusterName: '',
    notebookPath: '', branch: ''
  });

  const [connectionStatus, setConnectionStatus] = useState(projectState?.connectionStatus || 'connected');
  const [statusMessage, setStatusMessage] = useState(
    projectState?.statusMessage || 'Manual folder mode active. No Informatica repository credentials required.'
  );

  // Ingestion Mode: 'folder' (manual/no account needed) vs 'remote' (live repository credentials)
  const [sourceMode, setSourceMode] = useState(projectState?.sourceMode || 'folder');
  const [isUploadingFolder, setIsUploadingFolder] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Saved Source Connections State
  const [savedConnections, setSavedConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');

  // Discovery & File selection state — default to user's sample folder
  const DEFAULT_SAMPLE_FOLDER = "C:\\Users\\AdhananKuthpudeen\\Downloads\\MULTIFLOW_IICS_SCD_TYPE2-1775024548378";
  const [folderPathInput, setFolderPathInput] = useState(
    projectState?.connectionDetails?.folder || DEFAULT_SAMPLE_FOLDER
  );
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryInfo, setDiscoveryInfo] = useState(null);
  const [discoveredFiles, setDiscoveredFiles] = useState(projectState?.discoveredFiles || []);
  const [selectedFileIds, setSelectedFileIds] = useState(new Set(projectState?.selectedFileIds || []));
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Preprocessing state
  const [preprocessingStatus, setPreprocessingStatus] = useState(projectState?.preprocessingStatus || 'idle'); // idle, running, complete, error
  const [preprocessingStep, setPreprocessingStep] = useState(0);
  const [preprocessingResults, setPreprocessingResults] = useState(projectState?.preprocessingResults || null);
  const [showDetails, setShowDetails] = useState(true);
  const [activeDiffFileIndex, setActiveDiffFileIndex] = useState(0);
  const [diffViewMode, setDiffViewMode] = useState('sideBySide'); // 'sideBySide' | 'stacked'
  const [copiedDiffSide, setCopiedDiffSide] = useState(null); // 'raw' | 'cleaned'

  // Folder & File Upload Handlers
  const handleFolderUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processUploadedFiles(files);
  };

  const handleFilesUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processUploadedFiles(files);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    await processUploadedFiles(files);
  };

  const processUploadedFiles = async (files) => {
    setIsUploadingFolder(true);
    setStatusMessage(`Uploading and analyzing ${files.length} file(s)...`);
    setPreprocessingStatus('idle');
    setPreprocessingStep(0);
    setPreprocessingResults(null);

    const res = await uploadSourceFolder(files, selectedSource || 'Informatica PowerCenter');
    setIsUploadingFolder(false);

    if (res && res.status === 'success' && res.files && res.files.length > 0) {
      setConnectionStatus('connected');
      setStatusMessage(res.message || `Uploaded ${res.files.length} mapping file(s) successfully.`);
      setDiscoveredFiles(res.files);
      setDiscoveryInfo({ isLive: true, message: res.liveMessage || res.message, isError: false });
      const initiallySelected = new Set(res.files.map(f => f.id));
      setSelectedFileIds(initiallySelected);

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          selectedSource: selectedSource || 'Informatica PowerCenter',
          connectionStatus: 'connected',
          sourceMode: 'folder',
          discoveredFiles: res.files,
          selectedFileIds: Array.from(initiallySelected),
          preprocessingStatus: 'idle',
          preprocessingResults: null
        }));
      }
    } else {
      setStatusMessage(res?.message || 'Failed to parse uploaded files.');
    }
  };


  // Load saved source connections on mount
  useEffect(() => {
    async function loadSavedConnections() {
      const res = await fetchSavedSourceConnections();
      if (res && res.status === 'success' && res.connections) {
        setSavedConnections(res.connections);
        if (res.connections.length > 0 && !selectedConnectionId) {
          const first = res.connections[0];
          setSelectedConnectionId(first.id);
          setSelectedSource(first.sourceType);
          setFormData(first.details || {});
          setFolderPathInput(first.details?.folder || first.details?.notebookPath || (first.sourceType === 'Informatica PowerCenter' ? 'GLOBAL_EDW_MKTG' : '/Shared/ETL/pyspark_jobs/'));
          // Keep connection status unverified until tested/connected
          setConnectionStatus(projectState?.connectionStatus || '');
          setStatusMessage(`Saved connection profile loaded: '${first.name}'. Click 'Test & Connect' to verify.`);
        }
      }
    }
    loadSavedConnections();
  }, []);

  useEffect(() => {
    if (projectState?.selectedSource !== undefined && !selectedConnectionId) {
      setSelectedSource(projectState.selectedSource);
      const defaultP = projectState.selectedSource === 'Informatica PowerCenter' ? 'GLOBAL_EDW_MKTG' : '/Shared/ETL/pyspark_jobs/';
      setFolderPathInput(formData.folder || formData.notebookPath || defaultP);
    }
  }, [projectState?.selectedSource]);

  const handleSelectSavedConnection = (connId) => {
    setSelectedConnectionId(connId);
    if (!connId) return;

    const conn = savedConnections.find(c => c.id === connId);
    if (conn) {
      setSelectedSource(conn.sourceType);
      setFormData(conn.details || {});
      const targetFolder = conn.details?.folder || conn.details?.notebookPath || (conn.sourceType === 'Informatica PowerCenter' ? 'GLOBAL_EDW_MKTG' : '/Shared/ETL/pyspark_jobs/');
      setFolderPathInput(targetFolder);
      setConnectionStatus('connected');
      setStatusMessage(`Switched to saved connection: '${conn.name}'`);

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          selectedSource: conn.sourceType,
          connectionDetails: conn.details,
          connectionStatus: 'connected'
        }));
      }
    }
  };

  const handleAddNewSourceConnection = () => {
    setSelectedConnectionId('');
    setFormData({
      repository: '', domain: '', integrationService: '', account: '',
      username: '', password: '', folder: '',
      workspace: '', token: '', catalog: '', clusterName: '',
      notebookPath: '', branch: ''
    });
    setConnectionStatus('');
    setStatusMessage('Cleared fields to enter a new source connection.');
  };

  const handleSelectSource = (srcId) => {
    setSelectedSource(srcId);
    setSelectedConnectionId('');
    setDiscoveredFiles([]);
    setSelectedFileIds(new Set());
    setPreprocessingStatus('idle');
    setPreprocessingStep(0);
    setPreprocessingResults(null);

    const defaultFolder = srcId === 'Informatica PowerCenter'
      ? (folderPathInput || DEFAULT_SAMPLE_FOLDER)
      : '/Shared/ETL/pyspark_jobs/';
    setFolderPathInput(defaultFolder);

    const activeStatus = sourceMode === 'folder' ? 'connected' : '';
    setConnectionStatus(activeStatus);
    setStatusMessage(sourceMode === 'folder' ? 'Manual Folder & Direct Upload Mode Active. No Informatica credentials required.' : '');

    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        selectedSource: srcId,
        connectionStatus: activeStatus,
        discoveredFiles: [],
        selectedFileIds: [],
        preprocessingStatus: 'idle',
        preprocessingResults: null
      }));
    }
  };

  const persistSavedConnection = async () => {
    const connName = formData.name || `${selectedSource} (${formData.repository || formData.workspace || formData.username || 'Connection'})`;
    const res = await saveSourceConnection({
      name: connName,
      sourceType: selectedSource,
      details: formData
    });
    if (res && res.status === 'success' && res.connection) {
      setSavedConnections(prev => [res.connection, ...prev.filter(c => c.id !== res.connection.id)]);
      setSelectedConnectionId(res.connection.id);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedSource) {
      setConnectionStatus('failed');
      setStatusMessage('Please select a source type above before testing connection.');
      return;
    }
    setConnectionStatus('testing');
    setStatusMessage(`Testing connectivity to ${selectedSource}...`);

    const res = await testConnection(formData, selectedSource);
    if (res && res.connected) {
      setConnectionStatus('connected');
      setStatusMessage(res.message || `Connection verified! Successfully connected to ${selectedSource}.`);
      await persistSavedConnection();
    } else {
      setConnectionStatus('failed');
      const err = res?.message || res?.detail || `Connection failed. Please verify your credentials.`;
      setStatusMessage(typeof err === 'string' ? err : JSON.stringify(err));
    }
  };

  const handleSaveConnection = async () => {
    if (!selectedSource) {
      setConnectionStatus('failed');
      setStatusMessage('Please select a source type above before saving.');
      return;
    }
    setConnectionStatus('testing');
    setStatusMessage(`Validating and saving connection to ${selectedSource}...`);

    const res = await connectSource(selectedSource, 'manual', formData);
    if (res && res.connected) {
      setConnectionStatus('connected');
      setStatusMessage(res.message || `Saved & Connected to ${selectedSource}`);
      await persistSavedConnection();

      const folderVal = formData.notebookPath || formData.folder;
      if (folderVal && (!folderPathInput || folderPathInput === '/Shared/ETL/pyspark_jobs/' || folderPathInput === 'GLOBAL_EDW_MKTG')) {
        setFolderPathInput(folderVal);
      }

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          selectedSource,
          connectionDetails: formData,
          connectionStatus: 'connected'
        }));
      }
    } else {
      setConnectionStatus('failed');
      const err = res?.message || res?.detail || `Failed to save connection. Please check your credentials.`;
      setStatusMessage(typeof err === 'string' ? err : JSON.stringify(err));
    }
  };

  // --- Reset Preprocessing to Scan & Preprocess Different Folder ---
  const handleResetAndRescanFolder = () => {
    setPreprocessingStatus('idle');
    setPreprocessingStep(0);
    setPreprocessingResults(null);
    setDiscoveredFiles([]);
    setSelectedFileIds(new Set());
    setStatusMessage('Ready to enter another folder path and scan files.');
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        preprocessingStatus: 'idle',
        preprocessingResults: null,
        discoveredFiles: [],
        selectedFileIds: []
      }));
    }
  };

  // --- File Discovery Handler ---
  const handleDiscoverFiles = async () => {
    if (!selectedSource) {
      setStatusMessage('Please select a source platform first.');
      return;
    }

    setIsDiscovering(true);

    // Reset preprocessing state when scanning a new folder so fresh files can be preprocessed
    setPreprocessingStatus('idle');
    setPreprocessingStep(0);
    setPreprocessingResults(null);

    const targetFolder = folderPathInput || formData.notebookPath || formData.folder || (selectedSource === 'Informatica PowerCenter' ? DEFAULT_SAMPLE_FOLDER : '/Shared/ETL/pyspark_jobs/');

    const res = await discoverSourceFiles(selectedSource, targetFolder, formData);
    setIsDiscovering(false);

    if (res && res.status === 'success' && res.files && res.files.length > 0) {
      setConnectionStatus('connected');
      setStatusMessage(res.message || `Discovered ${res.files.length} mapping file(s) successfully.`);
      setDiscoveredFiles(res.files);
      setDiscoveryInfo({ isLive: res.isLive, message: res.liveMessage || res.message, isError: false });
      const initiallySelected = new Set(res.files.filter(f => f.selected !== false).map(f => f.id));
      setSelectedFileIds(initiallySelected);

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          connectionStatus: 'connected',
          discoveredFiles: res.files,
          selectedFileIds: Array.from(initiallySelected),
          preprocessingStatus: 'idle',
          preprocessingResults: null
        }));
      }
    } else {
      setDiscoveredFiles([]);
      setSelectedFileIds(new Set());
      setDiscoveryInfo({
        isLive: false,
        message: res?.message || res?.liveMessage || 'No files found in specified Databricks path.',
        isError: true
      });

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          discoveredFiles: [],
          selectedFileIds: [],
          preprocessingStatus: 'idle',
          preprocessingResults: null
        }));
      }
    }
  };

  // Toggle single file selection
  const handleToggleFile = (fileId) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      if (setProjectState) {
        setProjectState(p => ({ ...p, selectedFileIds: Array.from(next) }));
      }
      return next;
    });
  };

  // Select all / deselect all
  const handleSelectAll = (select) => {
    if (select) {
      const allIds = new Set(filteredFiles.map(f => f.id));
      setSelectedFileIds(allIds);
      if (setProjectState) setProjectState(p => ({ ...p, selectedFileIds: Array.from(allIds) }));
    } else {
      setSelectedFileIds(new Set());
      if (setProjectState) setProjectState(p => ({ ...p, selectedFileIds: [] }));
    }
  };

  // --- Preprocessing of Selected Files ---
  const handleStartPreprocessing = async () => {
    if (connectionStatus !== 'connected') {
      setStatusMessage('Please verify connection first (Section B) before preprocessing.');
      setConnectionStatus('failed');
      return;
    }

    const selectedFiles = discoveredFiles.filter(f => selectedFileIds.has(f.id));
    if (selectedFiles.length === 0) {
      setStatusMessage('Please select at least 1 file from the list below to preprocess.');
      return;
    }

    setPreprocessingStatus('running');
    setPreprocessingStep(0);

    const steps = PREPROCESSING_STEPS[selectedSource] || [];

    // Animate steps
    const animateSteps = () => {
      return new Promise((resolve) => {
        let stepIndex = 0;
        const runStep = () => {
          if (stepIndex < steps.length - 1) {
            stepIndex++;
            setPreprocessingStep(stepIndex);
            setTimeout(runStep, steps[stepIndex - 1]?.duration || 1000);
          } else {
            resolve();
          }
        };
        setTimeout(runStep, 800);
      });
    };

    // Preprocess ONLY the selected files payload
    const filesPayload = selectedFiles.map(f => ({
      filename: f.filename,
      content: f.content || ''
    }));

    const [_, apiResult] = await Promise.all([
      animateSteps(),
      preprocessSource(selectedSource, filesPayload)
    ]);

    setPreprocessingStep(steps.length);

    if (apiResult && apiResult.status === 'success') {
      const results = apiResult.summary || {};
      results.originalTokens = results.originalTokens || '~0';
      results.reducedTokens = results.reducedTokens || '~0';
      results.reductionPercent = results.reductionPercent || '0%';
      results.fileDetails = apiResult.fileDetails || [];

      const cleanedList = (apiResult.fileDetails || []).map(fd => ({
        id: fd.filename,
        name: fd.filename,
        filename: fd.filename,
        content: fd.cleaned_content || fd.raw_content || '',
        rawContent: fd.raw_content || '',
        cleaned_content: fd.cleaned_content || '',
        sourceType: selectedSource,
        size: `${fd.cleaned_size || 0} B`
      }));

      setPreprocessingResults(results);
      setActiveDiffFileIndex(0);
      setPreprocessingStatus('complete');
      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          preprocessingStatus: 'complete',
          preprocessingResults: results,
          uploadedFiles: cleanedList,
          discoveredFiles: cleanedList,
          cleanedFiles: cleanedList,
          selectedFileIds: cleanedList.map(f => f.id)
        }));
      }
    } else {
      setPreprocessingStatus('error');
      setStatusMessage(apiResult?.message || 'Preprocessing failed.');
    }
  };

  const getActiveFields = () => {
    if (selectedSource === 'Informatica PowerCenter') return INFORMATICA_FIELDS;
    if (selectedSource === 'PySpark (Databricks)') return DATABRICKS_FIELDS;
    return [];
  };

  // Filter files by search query
  const filteredFiles = discoveredFiles.filter(f =>
    f.filename.toLowerCase().includes(fileSearchQuery.toLowerCase()) ||
    (f.path && f.path.toLowerCase().includes(fileSearchQuery.toLowerCase())) ||
    (f.category && f.category.toLowerCase().includes(fileSearchQuery.toLowerCase()))
  );

  const selectedCount = discoveredFiles.filter(f => selectedFileIds.has(f.id)).length;
  const currentSteps = PREPROCESSING_STEPS[selectedSource] || [];
  const totalSteps = currentSteps.length;
  const progressPercent = totalSteps > 0 ? Math.round((preprocessingStep / totalSteps) * 100) : 0;

  const handleCopyCode = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Step Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-[#ECEFFF] text-[#1C58F6] px-3 py-1 rounded-full text-xs font-semibold border border-[#D1DEFF] mb-2">
            <span>Step 1 of 5 • Source Discovery & Preprocessing</span>
          </div>
          <h1 className="text-2xl font-black text-[#10338D] tracking-tight">Source Connection & Discovery</h1>
          <p className="text-xs text-[#666666] mt-1">
            Connect to your ETL repository, auto-discover project files in your folder, select files, and preprocess for token reduction.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {preprocessingStatus === 'complete' && (
            <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-3.5 py-2 rounded-xl border border-emerald-200 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{selectedCount} Files Preprocessed</span>
            </div>
          )}
        </div>
      </div>

      {/* SECTION A — Source Type Selection (Only 2 Cards) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
            <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-extrabold">A</span>
            <span>Select Source Platform</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Choose the legacy ETL platform to connect and auto-fetch artifacts from.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SOURCE_TYPES.map((src) => {
            const Icon = src.icon;
            const isSelected = selectedSource === src.id;
            return (
              <div
                key={src.id}
                onClick={() => handleSelectSource(src.id)}
                className={`relative p-5 rounded-xl border-2 cursor-pointer transition-all duration-300 ${isSelected
                    ? `bg-gradient-to-br ${src.bgGradient} ${src.borderColor} shadow-lg ring-1 ring-offset-0`
                    : 'bg-slate-800/40 border-slate-700/80 hover:bg-slate-800/70 hover:border-slate-600'
                  }`}
                style={isSelected ? { boxShadow: `0 0 20px ${src.color}15` } : {}}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                )}

                <div className="flex items-start space-x-4">
                  <div className={`p-3 rounded-xl shrink-0 ${isSelected ? 'bg-white/10' : 'bg-slate-700/60'}`} style={isSelected ? { backgroundColor: `${src.color}20` } : {}}>
                    <Icon className="w-6 h-6" style={{ color: isSelected ? src.color : '#6EE7B7' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="text-sm font-bold text-slate-100">{src.id}</h3>
                      <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${src.badgeBg}`}>
                        {src.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{src.desc}</p>
                    <div className="mt-2 pt-2 border-t border-slate-700/60">
                      <span className="text-[10px] text-slate-500 font-medium">{src.category}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION B — Connection & Ingestion Options (Manual Folder vs Remote Repository) */}
      {selectedSource && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-extrabold">B</span>
                <span>Connection & Ingestion Details — {selectedSource}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload or point to your local mappings folder without an account, or connect directly to a remote repository.
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSourceMode('folder');
                  setConnectionStatus('connected');
                  setStatusMessage('Manual folder mode active. No repository credentials required.');
                  if (setProjectState) setProjectState(p => ({ ...p, connectionStatus: 'connected', sourceMode: 'folder' }));
                }}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  sourceMode === 'folder'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Manual Folder & Upload</span>
                <span className="text-[9px] bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 px-1 py-0.2 rounded font-extrabold">
                  NO ACCOUNT NEEDED
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSourceMode('remote');
                  setConnectionStatus(selectedConnectionId ? 'connected' : '');
                  setStatusMessage(selectedConnectionId ? 'Using saved connection profile.' : '');
                  if (setProjectState) setProjectState(p => ({ ...p, sourceMode: 'remote' }));
                }}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  sourceMode === 'remote'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Remote Repository</span>
              </button>
            </div>
          </div>

          {/* ================= MODE 1: MANUAL LOCAL FOLDER & DIRECT UPLOAD ================= */}
          {sourceMode === 'folder' ? (
            <div className="space-y-4">
              {/* Info banner */}
              <div className="p-4 bg-sky-950/40 border border-sky-500/30 rounded-xl text-xs flex items-start space-x-3">
                <FolderCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-sky-200">Manual Folder & Direct Ingestion Mode Active</p>
                  <p className="text-sky-300/90 leading-relaxed font-medium">
                    No active Informatica trial account or server credentials required. Point to your local folder on disk or upload exported files (.DTEMPLATE.zip, .MTT.zip, .xml, .py, .sql, or .zip archives) to discover and preprocess them.
                  </p>
                </div>
              </div>

              {/* Option A: Local Disk Folder Path Input */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                    <HardDrive className="w-4 h-4 text-sky-400" />
                    <span>Option 1: Scan Local Folder Path on Disk</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setFolderPathInput(DEFAULT_SAMPLE_FOLDER)}
                    className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline flex items-center space-x-1"
                  >
                    <span>Use Example Path</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <div className="relative flex-1 w-full">
                    <input
                      type="text"
                      value={folderPathInput}
                      onChange={(e) => setFolderPathInput(e.target.value)}
                      placeholder={DEFAULT_SAMPLE_FOLDER}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleDiscoverFiles}
                    disabled={isDiscovering}
                    className="w-full sm:w-auto bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 cursor-pointer shrink-0 disabled:opacity-50 transition-colors shadow-md"
                  >
                    {isDiscovering ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Scanning Folder...</span>
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Scan Local Folder</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Option B: Direct Drag & Drop / File Browser Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                  isDragOver
                    ? 'border-sky-400 bg-sky-950/30'
                    : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'
                }`}
              >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">
                  Option 2: Upload Mappings Folder or ZIP from your Computer
                </h4>
                <p className="text-[11px] text-slate-400 max-w-lg mx-auto mb-4 leading-relaxed">
                  Drag and drop your extracted Informatica folder, .DTEMPLATE.zip, .xml, .py, or whole zip archive here.
                </p>

                {isUploadingFolder ? (
                  <div className="flex items-center justify-center space-x-2 text-xs font-bold text-sky-400 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading and analyzing mapping files...</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <label className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 cursor-pointer shadow-md transition-colors">
                      <FolderOpen className="w-4 h-4" />
                      <span>Browse Folder from Computer</span>
                      <input
                        type="file"
                        webkitdirectory=""
                        directory=""
                        multiple
                        onChange={handleFolderUpload}
                        className="hidden"
                      />
                    </label>

                    <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 cursor-pointer transition-colors">
                      <FileUp className="w-4 h-4 text-sky-400" />
                      <span>Select Files / ZIP</span>
                      <input
                        type="file"
                        multiple
                        accept=".zip,.dtemplate.zip,.mtt.zip,.workflow.zip,.xml,.json,.py,.sql"
                        onChange={handleFilesUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Status Footer */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-800">
                <div className="text-xs text-slate-400">
                  <span>Current Source: </span>
                  <span className="font-bold text-slate-200">{selectedSource}</span>
                  {discoveredFiles.length > 0 && (
                    <span className="ml-2 text-sky-400 font-mono font-bold">
                      ({discoveredFiles.length} files discovered)
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-xs font-semibold">
                  <span className="text-slate-400">Status:</span>
                  <span className="inline-flex items-center space-x-1.5 bg-emerald-950 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/40">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Connected (Manual Folder Mode Active)</span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* ================= MODE 2: REMOTE REPOSITORY CONNECTION ================= */
            <div className="space-y-5">
              {/* Saved Source Connections Selector Bar */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                    <Bookmark className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Saved Source Connection Profile</span>
                    <select
                      value={selectedConnectionId}
                      onChange={(e) => handleSelectSavedConnection(e.target.value)}
                      className="w-full bg-transparent text-emerald-400 font-mono font-bold text-xs focus:outline-none cursor-pointer truncate"
                    >
                      <option value="" className="bg-slate-900 text-slate-300">
                        -- Select a Saved Source Profile ({savedConnections.length} available) --
                      </option>
                      {savedConnections.map(c => (
                        <option key={c.id} value={c.id} className="bg-slate-900 text-emerald-400">
                          {c.name} [{c.sourceType}]
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddNewSourceConnection}
                  className="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer shrink-0 transition-colors"
                  title="Clear credentials to create a new source connection"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ New Connection</span>
                </button>
              </div>

              <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getActiveFields().map((field) => (
                  <div key={field.key} className={field.hint ? 'md:col-span-2 lg:col-span-3' : ''}>
                    <label className="text-xs font-bold text-[#1E1E1E] block mb-1">
                      <span className="mr-1">{field.icon}</span>
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.type === 'password' ? (
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          name={field.key}
                          autoComplete="new-password"
                          value={formData[field.key] || ''}
                          placeholder={field.placeholder}
                          onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                          className="w-full bg-white border border-[#CBD5E1] rounded-lg px-3 py-2 pr-9 text-xs text-[#1E1E1E] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1C58F6]/20 focus:border-[#1C58F6] font-mono shadow-xs transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                          title={showPassword ? "Hide" : "Show"}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        name={field.key}
                        autoComplete="off"
                        value={formData[field.key] || ''}
                        placeholder={field.placeholder}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormData(prev => ({ ...prev, [field.key]: val }));
                          if (field.key === 'notebookPath' || field.key === 'folder') {
                            setFolderPathInput(val);
                          }
                        }}
                        className="w-full bg-white border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs text-[#1E1E1E] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1C58F6]/20 focus:border-[#1C58F6] font-mono shadow-xs transition-colors"
                      />
                    )}
                    {field.hint && (
                      <p className="text-[10px] text-slate-400 mt-1 italic">{field.hint}</p>
                    )}
                  </div>
                ))}
              </form>

              {/* Diagnostic Feedback Alert Banner */}
              {statusMessage && connectionStatus === 'failed' && (
                <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs flex items-start space-x-3 animate-in fade-in duration-200">
                  <XCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-[#7F1D1D]">Connection Guardrail Check Failed</p>
                    <p className="text-[#991B1B] leading-relaxed font-medium">{statusMessage}</p>
                  </div>
                </div>
              )}

              {statusMessage && connectionStatus === 'connected' && (
                <div className="p-4 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-xs flex items-start space-x-3 animate-in fade-in duration-200">
                  <CheckCircle2 className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-[#064E3B]">Connection Authenticated & Active</p>
                    <p className="text-[#047857] leading-relaxed font-medium">{statusMessage}</p>
                  </div>
                </div>
              )}

              {/* Buttons & Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleTestConnection}
                    disabled={connectionStatus === 'testing'}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 border border-slate-700 cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus === 'testing' ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>Test Connection</span>
                  </button>

                  <button
                    onClick={handleSaveConnection}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 shadow-md cursor-pointer transition-colors"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Save & Connect</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2 text-xs font-semibold">
                  <span className="text-slate-400">Status:</span>
                  {connectionStatus === 'connected' ? (
                    <span className="inline-flex items-center space-x-1.5 bg-emerald-950 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/40">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Connected (Active)</span>
                    </span>
                  ) : connectionStatus === 'failed' ? (
                    <span className="inline-flex items-center space-x-1.5 bg-rose-950 text-rose-400 px-3 py-1 rounded-full border border-rose-500/40">
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>Connection Failed</span>
                    </span>
                  ) : connectionStatus === 'testing' ? (
                    <span className="inline-flex items-center space-x-1.5 bg-amber-950 text-amber-400 px-3 py-1 rounded-full border border-amber-500/40">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Testing Link...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1.5 bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700">
                      <span>Not Connected</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION C — Folder Discovery & Interactive File Selector */}
      {selectedSource && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs font-extrabold">C</span>
                <span>Project Folder Discovery & File Selection</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Specify the folder or directory path to scan. Discover files and check the ones you want to preprocess.
              </p>
            </div>

            {preprocessingStatus === 'complete' && (
              <button
                onClick={handleResetAndRescanFolder}
                type="button"
                className="bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-500/30 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer shrink-0 transition-colors"
                title="Rescan another folder path"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rescan / Change Folder</span>
              </button>
            )}
          </div>

          {/* Folder Path Bar & Scan Button */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <FolderOpen className="w-4 h-4 text-sky-400" />
              </div>
              <input
                type="text"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
                placeholder={selectedSource === 'Informatica PowerCenter' ? 'e.g. GLOBAL_EDW_MKTG or C:/infa_xmls/' : 'e.g. /Shared/ETL/pyspark_jobs/ or C:/pyspark_repo/'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all shadow-inner"
              />
            </div>

            <button
              onClick={handleDiscoverFiles}
              disabled={isDiscovering}
              className="w-full sm:w-auto bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shadow-md cursor-pointer transition-colors shrink-0 disabled:opacity-50"
            >
              {isDiscovering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Scanning Folder...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Scan & Discover Files</span>
                </>
              )}
            </button>
          </div>

          {/* Discovery Status Banner */}
          {discoveryInfo?.isLive ? (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-center space-x-2 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-medium">{discoveryInfo.message || 'Live Workspace Synchronized: Retrieved notebooks directly via Databricks REST API.'}</span>
            </div>
          ) : discoveryInfo?.isError ? (
            <div className="p-3.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start space-x-2.5 animate-in fade-in duration-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-200">Databricks Discovery Failed</p>
                <p className="text-[11px] text-rose-300/90 mt-0.5 leading-relaxed">
                  {discoveryInfo.message}
                </p>
              </div>
            </div>
          ) : null}

          {/* Discovered Files Table */}
          {discoveredFiles.length > 0 ? (
            <div className="space-y-3 pt-2">
              {/* Controls Bar: Stats, Search, Select All */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-bold text-slate-200">
                    Found <span className="text-sky-400 font-mono">{discoveredFiles.length}</span> files ({selectedCount} selected)
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleSelectAll(true)}
                      className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 cursor-pointer underline"
                    >
                      Select All
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      onClick={() => handleSelectAll(false)}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-300 cursor-pointer underline"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="Filter files..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Interactive File Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3 w-10 text-center">
                        <button
                          onClick={() => handleSelectAll(selectedCount !== filteredFiles.length)}
                          className="text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          {selectedCount === filteredFiles.length && filteredFiles.length > 0 ? (
                            <CheckSquare className="w-4 h-4 text-sky-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3">File Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Relative Path</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">Lines</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/50">
                    {filteredFiles.map((file) => {
                      const isChecked = selectedFileIds.has(file.id);
                      return (
                        <tr
                          key={file.id}
                          className={`transition-colors ${isChecked ? 'bg-sky-950/20 hover:bg-sky-950/30' : 'hover:bg-slate-800/40 opacity-70'}`}
                        >
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleToggleFile(file.id)}
                              className="cursor-pointer text-slate-400 hover:text-sky-400 transition-colors"
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-sky-400" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-slate-200">
                            <div className="flex items-center space-x-2">
                              {file.extension === 'py' ? (
                                <Flame className="w-4 h-4 text-red-400 shrink-0" />
                              ) : file.extension === 'xml' ? (
                                <Server className="w-4 h-4 text-orange-400 shrink-0" />
                              ) : (
                                <FileCode className="w-4 h-4 text-sky-400 shrink-0" />
                              )}
                              <span className={isChecked ? 'text-slate-100 font-bold' : 'text-slate-400'}>
                                {file.filename}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {file.category || (file.extension ? file.extension.toUpperCase() : 'FILE')}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-400 max-w-[200px] truncate" title={file.path}>
                            {file.path}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-400">{file.fileSize}</td>
                          <td className="px-4 py-3 font-mono text-slate-400">{file.lineCount || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setPreviewFile(file)}
                              className="inline-flex items-center space-x-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/50 hover:bg-sky-900/50 px-2.5 py-1 rounded-lg border border-sky-500/30 cursor-pointer transition-colors"
                              title="Preview file contents"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-slate-950/60 border border-slate-800 rounded-xl text-center space-y-2">
              <FolderOpen className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-300">No files scanned yet</p>
              <p className="text-[11px] text-slate-500">
                Click &quot;Scan & Discover Files&quot; above to list all ETL scripts or mappings inside this path.
              </p>
            </div>
          )}
        </div>
      )}

      {/* SECTION D — Preprocessing Layer */}
      {selectedSource && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-extrabold">D</span>
              <span>Preprocessing & Token Optimization</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Strips runtime boilerplate, configs, and GUI noise from the selected files, preserving only transformation logic for dbt generation.
            </p>
          </div>

          {/* Preprocessing Not Started */}
          {preprocessingStatus === 'idle' && (
            <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-4">
                <Filter className="w-7 h-7 text-violet-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-200 mb-1">
                {selectedCount > 0 ? `Ready to Preprocess ${selectedCount} Selected File(s)` : 'Select Files Above to Preprocess'}
              </h3>
              <p className="text-xs text-slate-400 mb-5 max-w-md mx-auto leading-relaxed">
                {selectedSource === 'Informatica PowerCenter'
                  ? 'Parses mapping XMLs, extracts expressions and lookups, and strips XML layout/metadata noise (~97% token reduction).'
                  : 'Parses PySpark scripts via AST, extracts reads/writes, transformations, and strips logging and imports (~92% token reduction).'
                }
              </p>
              <button
                onClick={handleStartPreprocessing}
                disabled={connectionStatus !== 'connected' || selectedCount === 0}
                className={`inline-flex items-center space-x-2 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-lg ${connectionStatus === 'connected' && selectedCount > 0
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white cursor-pointer shadow-violet-500/20'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  }`}
              >
                <Zap className="w-4 h-4" />
                <span>Preprocess Selected ({selectedCount} Files)</span>
              </button>
              {connectionStatus !== 'connected' && (
                <p className="text-[10px] text-amber-400 mt-3 flex items-center justify-center space-x-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Connect to the source first (Section B) to enable preprocessing</span>
                </p>
              )}
            </div>
          )}

          {/* Preprocessing Running */}
          {preprocessingStatus === 'running' && (
            <div className="space-y-4">
              <div className="relative bg-slate-950 border border-slate-800 rounded-xl p-5">
                {/* Waiting Banner for Multi-Thousand Line Files */}
                <div className="p-3.5 bg-violet-950/40 border border-violet-500/30 rounded-xl text-xs text-violet-200 flex items-start space-x-3 mb-4 animate-in fade-in duration-200">
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-violet-100">Please wait while multi-thousand line XML / script files are being parsed...</p>
                    <p className="text-[11px] text-violet-300/90 mt-0.5 leading-relaxed">
                      Extracting transformation expressions, stripping GUI layout coordinates, and optimizing Jinja tokens for dbt compilation.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                    <span className="text-xs font-bold text-slate-200">Preprocessing {selectedCount} Files in Progress...</span>
                  </div>
                  <span className="text-xs font-mono text-violet-400">{progressPercent}%</span>
                </div>

                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {currentSteps.slice(0, preprocessingStep).map((step, i) => (
                    <div key={step.id} className="flex items-center space-x-2 text-xs">
                      {i < preprocessingStep - 1 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
                      )}
                      <span className={i < preprocessingStep - 1 ? 'text-slate-400' : 'text-slate-200 font-medium'}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Preprocessing Complete */}
          {preprocessingStatus === 'complete' && preprocessingResults && (
            <div className="space-y-5">
              <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm space-y-5">
                {/* Header Badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#ECEFFF]">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-[#ECEFFF] text-[#10338D] rounded-xl border border-[#D1DEFF]">
                      <Sparkles className="w-5 h-5 text-[#10338D]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#10338D]">Preprocessing Complete & Verified</h3>
                      <p className="text-xs text-[#475569] mt-0.5">
                        {selectedCount} files preprocessed — stripped cluster boilerplate and extracted pure business logic for dbt migration.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleResetAndRescanFolder}
                    type="button"
                    className="bg-[#ECEFFF] hover:bg-[#D1DEFF] text-[#10338D] border border-[#D1DEFF] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 cursor-pointer transition-colors shrink-0"
                    title="Change folder path and scan a different set of files"
                  >
                    <FolderOpen className="w-4 h-4 text-[#1C58F6]" />
                    <span>Scan Different Folder</span>
                  </button>
                </div>

                {/* Token Reduction Stats - Relanto Brand Proportions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-[#FFF5F2] border border-[#FFD0B8] rounded-xl p-3.5 text-center">
                    <p className="text-[10px] text-[#EB4925] uppercase tracking-wider font-bold mb-1">Raw Original Tokens</p>
                    <p className="text-xl font-bold text-[#FF3C00] font-mono">{preprocessingResults.originalTokens}</p>
                  </div>
                  <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-3.5 text-center">
                    <p className="text-[10px] text-[#166534] uppercase tracking-wider font-bold mb-1">Cleaned Tokens</p>
                    <p className="text-xl font-bold text-[#059669] font-mono">{preprocessingResults.reducedTokens}</p>
                  </div>
                  <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-3.5 text-center">
                    <p className="text-[10px] text-[#1E40AF] uppercase tracking-wider font-bold mb-1">Token Reduction</p>
                    <p className="text-xl font-bold text-[#10338D] font-mono">{preprocessingResults.reductionPercent}</p>
                  </div>
                </div>

                {/* --- FILE-BY-FILE BEFORE VS AFTER PREPROCESSED CODE COMPARISON --- */}
                {preprocessingResults.fileDetails && preprocessingResults.fileDetails.length > 0 && (
                  <div className="pt-5 border-t border-[#ECEFFF] space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-[#10338D] flex items-center space-x-2">
                          <Code2 className="w-4 h-4 text-[#1C58F6]" />
                          <span>Preprocessed Code Inspector & Transformation Lineage</span>
                        </h4>
                        <p className="text-[11px] text-[#64748B] mt-0.5">
                          Compare original raw script vs optimized business logic retained for dbt conversion.
                        </p>
                      </div>

                      {/* View Mode Toggle (Side-by-Side vs Stacked) */}
                      <div className="flex items-center space-x-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl p-1 shrink-0">
                        <button
                          onClick={() => setDiffViewMode('sideBySide')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${diffViewMode === 'sideBySide'
                              ? 'bg-[#10338D] text-white shadow-sm'
                              : 'text-[#64748B] hover:text-[#0F172A]'
                            }`}
                        >
                          Side-by-Side View
                        </button>
                        <button
                          onClick={() => setDiffViewMode('stacked')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${diffViewMode === 'stacked'
                              ? 'bg-[#10338D] text-white shadow-sm'
                              : 'text-[#64748B] hover:text-[#0F172A]'
                            }`}
                        >
                          Stacked View
                        </button>
                      </div>
                    </div>

                    {/* File Switcher Tabs - Relanto Brand Proportions */}
                    <div className="flex items-center space-x-2 overflow-x-auto pb-1.5 scrollbar-thin">
                      {preprocessingResults.fileDetails.map((f, idx) => {
                        const isSelected = activeDiffFileIndex === idx;
                        const redPercent = f.reduction_percent || '0%';
                        return (
                          <button
                            key={f.filename || idx}
                            onClick={() => setActiveDiffFileIndex(idx)}
                            className={`flex items-center space-x-2.5 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all border ${isSelected
                                ? 'bg-[#10338D] border-[#10338D] text-white shadow-md'
                                : 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC] hover:border-[#CBD5E1]'
                              }`}
                          >
                            <FileCode className={`w-3.5 h-3.5 ${isSelected ? 'text-[#B3F00D]' : 'text-[#64748B]'}`} />
                            <span className="font-mono text-xs">{f.filename}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${isSelected
                                ? 'bg-[#B3F00D] text-[#061848] border-transparent font-extrabold'
                                : 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]'
                              }`}>
                              -{redPercent}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Active File Details & Comparison View */}
                    {(() => {
                      const activeFile = preprocessingResults.fileDetails[activeDiffFileIndex] || preprocessingResults.fileDetails[0];
                      if (!activeFile) return null;

                      const meta = activeFile.metadata || {};
                      const reads = meta.reads || [];
                      const writes = meta.writes || [];
                      const transformations = meta.transformations || [];
                      const functions = meta.functions || [];
                      const udfs = meta.udfs || [];
                      const stripped = activeFile.stripped_items || [];

                      const rawCode = activeFile.raw_content || '';
                      const cleanCode = activeFile.cleaned_content || '';
                      const rawLines = rawCode.split('\n').length;
                      const cleanLines = cleanCode.split('\n').length;

                      return (
                        <div className="space-y-4 animate-in fade-in duration-200">
                          {/* Transformation & Lineage Breakdown Card */}
                          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-3.5 shadow-sm">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              {/* Sources / Inputs */}
                              <div className="bg-white border border-[#D1DEFF] rounded-xl p-3 space-y-2 shadow-2xs">
                                <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-[#1748C9]">
                                  <ArrowDownCircle className="w-3.5 h-3.5 text-[#1748C9]" />
                                  <span>Sources / Inputs</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {reads.length > 0 ? (
                                    reads.map((r, i) => (
                                      <span key={i} className="text-[11px] font-mono bg-[#EFF6FF] text-[#1E40AF] px-2.5 py-1 rounded-lg border border-[#BFDBFE] font-medium">
                                        {r.table || r.format || 'Source Data'}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-[#94A3B8] italic">No explicit sources</span>
                                  )}
                                </div>
                              </div>

                              {/* Target Sinks */}
                              <div className="bg-white border border-[#A7F3D0] rounded-xl p-3 space-y-2 shadow-2xs">
                                <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-[#059669]">
                                  <ArrowRight className="w-3.5 h-3.5 text-[#059669]" />
                                  <span>Target Tables</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {writes.length > 0 ? (
                                    writes.map((w, i) => (
                                      <span key={i} className="text-[11px] font-mono bg-[#ECFDF5] text-[#065F46] px-2.5 py-1 rounded-lg border border-[#A7F3D0] font-medium">
                                        {w.table || 'Target Delta Table'}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-[#94A3B8] italic">View / Staging Output</span>
                                  )}
                                </div>
                              </div>

                              {/* Core Transformations */}
                              <div className="bg-white border border-[#FED7AA] rounded-xl p-3 space-y-2 shadow-2xs">
                                <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FF3C00]">
                                  <Zap className="w-3.5 h-3.5 text-[#FF3C00]" />
                                  <span>Transformations Detected</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {transformations.length > 0 ? (
                                    transformations.map((t, i) => (
                                      <span key={i} className="text-[11px] font-mono bg-[#FFF7ED] text-[#C2410C] px-2.5 py-1 rounded-lg border border-[#FFD0B8] font-medium">
                                        .{t.type || t}()
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-[#94A3B8] italic">Direct pass-through</span>
                                  )}
                                </div>
                              </div>

                              {/* Functions & UDFs */}
                              <div className="bg-white border border-[#DDD6FE] rounded-xl p-3 space-y-2 shadow-2xs">
                                <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-[#7A78FF]">
                                  <Sparkles className="w-3.5 h-3.5 text-[#7A78FF]" />
                                  <span>Functions & UDFs</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {functions.length > 0 || udfs.length > 0 ? (
                                    [...functions, ...udfs].map((fn, i) => (
                                      <span key={i} className="text-[11px] font-mono bg-[#F5F3FF] text-[#6D28D9] px-2.5 py-1 rounded-lg border border-[#DDD6FE] font-medium">
                                        {typeof fn === 'string' ? fn : fn.name || 'func()'}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-[#94A3B8] italic">0 Custom UDFs</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* What was stripped */}
                            {stripped.length > 0 && (
                              <div className="pt-2.5 border-t border-[#E2E8F0] flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] shrink-0">
                                  🧹 Boilerplate Stripped:
                                </span>
                                {stripped.map((item, i) => (
                                  <span key={i} className="text-[11px] text-[#64748B] bg-white px-2.5 py-0.5 rounded-full border border-[#E2E8F0] line-through decoration-[#EB4925]/60 font-medium">
                                    {item}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Code Diff Comparison Panes */}
                          <div className={`grid gap-4 ${diffViewMode === 'sideBySide' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                            {/* Left Pane: BEFORE Preprocessing (Raw) */}
                            <div className="bg-[#0B132B] rounded-2xl border border-[#FFD0B8] shadow-sm overflow-hidden flex flex-col">
                              <div className="flex items-center justify-between px-4 py-3 bg-[#FFF5F2] border-b border-[#FFD0B8] text-xs">
                                <div className="flex items-center space-x-2">
                                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF3C00]"></span>
                                  <span className="font-bold text-[#EB4925] tracking-wide">BEFORE PREPROCESSING (Raw Source)</span>
                                </div>
                                <div className="flex items-center space-x-2 text-[11px] font-mono text-[#64748B]">
                                  <span className="bg-white px-2 py-0.5 rounded border border-[#FFD0B8] text-[#C22E00] font-semibold">{rawLines} lines</span>
                                  <span>•</span>
                                  <span className="bg-white px-2 py-0.5 rounded border border-[#FFD0B8] text-[#C22E00] font-semibold">~{activeFile.original_tokens || Math.round(rawCode.length / 4)} tokens</span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(rawCode);
                                      setCopiedDiffSide('raw');
                                      setTimeout(() => setCopiedDiffSide(null), 2000);
                                    }}
                                    className="ml-2 px-2.5 py-1 rounded-lg bg-white hover:bg-[#FFF5F2] text-[#EB4925] border border-[#FFD0B8] cursor-pointer flex items-center space-x-1.5 font-bold transition-all shadow-2xs"
                                  >
                                    {copiedDiffSide === 'raw' ? <Check className="w-3.5 h-3.5 text-[#059669]" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedDiffSide === 'raw' ? 'Copied' : 'Copy'}</span>
                                  </button>
                                </div>
                              </div>
                              <pre className="p-4 text-[12px] font-mono text-[#F1F5F9] overflow-x-auto max-h-96 leading-relaxed select-text bg-[#0B132B]">
                                <code>{rawCode || '# No raw content available'}</code>
                              </pre>
                            </div>

                            {/* Right Pane: AFTER Preprocessing (Cleaned) */}
                            <div className="bg-[#0B132B] rounded-2xl border border-[#D1DEFF] shadow-sm overflow-hidden flex flex-col">
                              <div className="flex items-center justify-between px-4 py-3 bg-[#EFF6FF] border-b border-[#BFDBFE] text-xs">
                                <div className="flex items-center space-x-2">
                                  <span className="w-2.5 h-2.5 rounded-full bg-[#10338D]"></span>
                                  <span className="font-bold text-[#10338D] tracking-wide">AFTER PREPROCESSING (Cleaned Business Logic)</span>
                                </div>
                                <div className="flex items-center space-x-2 text-[11px] font-mono text-[#64748B]">
                                  <span className="bg-[#DCFCE7] px-2 py-0.5 rounded border border-[#A7F3D0] text-[#15803D] font-bold">{cleanLines} lines</span>
                                  <span>•</span>
                                  <span className="bg-[#DCFCE7] px-2 py-0.5 rounded border border-[#A7F3D0] text-[#15803D] font-bold">~{activeFile.cleaned_tokens || Math.round(cleanCode.length / 4)} tokens</span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(cleanCode);
                                      setCopiedDiffSide('cleaned');
                                      setTimeout(() => setCopiedDiffSide(null), 2000);
                                    }}
                                    className="ml-2 px-2.5 py-1 rounded-lg bg-white hover:bg-[#EFF6FF] text-[#10338D] border border-[#BFDBFE] cursor-pointer flex items-center space-x-1.5 font-bold transition-all shadow-2xs"
                                  >
                                    {copiedDiffSide === 'cleaned' ? <Check className="w-3.5 h-3.5 text-[#059669]" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedDiffSide === 'cleaned' ? 'Copied' : 'Copy'}</span>
                                  </button>
                                </div>
                              </div>
                              <pre className="p-4 text-[12px] font-mono text-[#86EFAC] overflow-x-auto max-h-96 leading-relaxed select-text bg-[#0B132B]">
                                <code>{cleanCode || '# Cleaned business logic extracted'}</code>
                              </pre>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Preprocessing Success Confirmation */}
              <div className="flex items-center justify-between p-4 bg-white border border-[#D1DEFF] rounded-2xl shadow-sm">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-[#ECFDF5] text-[#059669] rounded-xl border border-[#A7F3D0]">
                    <CheckCircle2 className="w-5 h-5 text-[#059669]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#10338D]">Files preprocessed successfully</p>
                    <p className="text-[11px] text-[#64748B]">Source metadata and workflows are ready. Click below to proceed to Prompt Configuration.</p>
                  </div>
                </div>

                <div className="flex justify-end pl-4">
                  <button
                    onClick={() => {
                      if (onNext) onNext();
                    }}
                    className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-md cursor-pointer"
                  >
                    <span>Proceed to Step 2 (AI Skill Engine)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-bold text-slate-100 font-mono">{previewFile.filename}</span>
                <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">{previewFile.fileSize}</span>
                <span className="text-[10px] text-slate-400 font-mono">{previewFile.path}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCopyCode(previewFile.content || '')}
                  className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer flex items-center space-x-1 text-xs"
                  title="Copy content"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Modal Code Content */}
            <div className="flex-1 overflow-auto p-4 bg-slate-950">
              <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                {previewFile.content || '// Empty file content'}
              </pre>
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-between items-center bg-slate-900">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    handleToggleFile(previewFile.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer transition-colors ${selectedFileIds.has(previewFile.id)
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                >
                  {selectedFileIds.has(previewFile.id) ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Selected for Preprocessing</span>
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5" />
                      <span>Select This File</span>
                    </>
                  )}
                </button>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-xl border border-slate-700 cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small reusable stat card for preprocessing results
function StatCard({ label, value, icon }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center space-x-1.5 mb-1">
        <span className="text-violet-400">{icon}</span>
        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold text-slate-100 font-mono">{value}</p>
    </div>
  );
}
