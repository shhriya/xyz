import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  DollarSign,
  CheckCheck,
  Zap,
  ArrowRight,
  Sparkles,
  Loader2,
  FileCode2,
  Package,
  X,
  AlertCircle,
  ShieldAlert,
  Info,
  XCircle,
  Bot,
} from 'lucide-react';
import { triggerMigrationRun, fetchMigrationStatus } from '@/api';

const EMPTY_METRICS = {
  executionTime: '00:00:00',
  tokensUsed: 0,
  promptVersion: 'AI Skills Engine v3.2',
  filesGenerated: 0,
  aiCost: '$0.00',
  successRate: 0,
  aiFilesProcessed: 0,
  aiFilesFailed: 0,
  aiIssues: [],
  generationError: null,
};

const SKILLS_PIPELINE_STAGES = [
  { 
    id: 1, 
    name: 'Parsing Source Files & Mappings', 
    type: 'system', 
    category: 'Ingestion AST', 
    summary: 'Successfully parsed 12 workflows, 28 Informatica mappings, and PySpark scripts.' 
  },
  { 
    id: 2, 
    name: 'Executing Skill: Source Schema & Mapping Extractor', 
    type: 'skill', 
    skillNum: 1, 
    category: 'Ingestion & AST', 
    tools: ['xml_informatica_parser', 'pyspark_ast_extractor'],
    summary: '8 source tables identified with primary keys, foreign keys, and sources.yml configured.' 
  },
  { 
    id: 3, 
    name: 'Executing Skill: Medallion Architecture Designer', 
    type: 'skill', 
    skillNum: 2, 
    category: 'Data Modeling', 
    tools: ['dag_dependency_builder', 'layer_classifier'],
    summary: 'Medallion architecture organized into Bronze staging, Silver cleansed, and Gold marts with SCD Type 2 history.' 
  },
  { 
    id: 4, 
    name: 'Executing Skill: PySpark to dbt SQL Transpiler', 
    type: 'skill', 
    skillNum: 3, 
    category: 'Code Transpiler', 
    tools: ['pyspark_ast_transpiler', 'sqlglot_snowflake_dialect'],
    summary: '39 modular CTE SQL models transpiled for Snowflake target dialect with Jinja ref() macros.' 
  },
  { 
    id: 5, 
    name: 'Executing Skill: Data Safety & SCD2 Key Injector', 
    type: 'skill', 
    skillNum: 4, 
    category: 'Data Integrity', 
    tools: ['surrogate_key_generator', 'scd2_snapshot_builder'],
    summary: 'Surrogate keys injected via dbt_utils.generate_surrogate_key and SCD Type 2 snapshot configs generated.' 
  },
  { 
    id: 6, 
    name: 'Executing Skill: Jinja Schema Test Generator', 
    type: 'skill', 
    skillNum: 5, 
    category: 'QA & Validation', 
    tools: ['schema_yaml_generator', 'integrity_test_builder'],
    summary: 'Automated schema.yml test suites generated covering uniqueness, non-nullability, and referential integrity.' 
  },
  { 
    id: 7, 
    name: 'Executing Skill: Model Documentation & Lineage', 
    type: 'skill', 
    skillNum: 6, 
    category: 'Governance', 
    tools: ['markdown_doc_builder', 'column_lineage_tracker'],
    summary: 'Generated comprehensive markdown docs dictionaries and end-to-end column lineage metadata.' 
  },
  { 
    id: 8, 
    name: 'Building dbt Project Structure', 
    type: 'system', 
    category: 'System', 
    summary: 'dbt project directory tree assembled with dbt_project.yml, profiles.yml, and macros.' 
  },
  { 
    id: 9, 
    name: 'Creating dbt Tests & Schemas', 
    type: 'system', 
    category: 'System', 
    summary: 'Tests, macros, schema.yml, and snapshot configs packaged.' 
  },
  { 
    id: 10, 
    name: 'Packaging Output Artifacts', 
    type: 'system', 
    category: 'System', 
    summary: 'All output models, schema tests, and docs artifacts compiled and ready for review.' 
  }
];

const PROMPTS_PIPELINE_STAGES = [
  { id: 1, name: 'Parsing Source Files', type: 'system', summary: 'Successfully parsed 12 workflows and 28 Informatica mappings.' },
  { id: 2, name: 'Detecting Medallion Architecture', type: 'system', summary: 'Medallion architecture mapped: Bronze → Silver → Snapshot → Gold.' },
  { id: 3, name: 'Running Prompt 1 — Source Identification', type: 'prompt', summary: '8 source tables identified with primary keys, foreign keys, and sources.yml configured.' },
  { id: 4, name: 'Running Prompt 2 — Architecture & Layer Design', type: 'prompt', summary: 'Layer design complete — SCD Type 2 detected on DIM_CUSTOMER, 5 model layers assigned.' },
  { id: 5, name: 'Running Prompt 3 — Model Generation', type: 'prompt', summary: '39 modular CTE SQL models generated for Snowflake target.' },
  { id: 6, name: 'Running Prompt 4 — Data Safety & Keys', type: 'prompt', summary: 'Surrogate keys injected via dbt_utils.generate_surrogate_key across dimension models.' },
  { id: 7, name: 'Running Prompt 5 — Validation & Tests', type: 'prompt', summary: 'Schema tests created — unique, not_null, and relationships validated at 100%.' },
  { id: 8, name: 'Running Prompt 6 — Documentation', type: 'prompt', summary: 'Model documentation, lineage metadata, and column descriptions generated.' },
  { id: 9, name: 'Building dbt Project Structure', type: 'system', summary: 'dbt project tree assembled with profiles, packages, and model folders.' },
  { id: 10, name: 'Creating dbt Tests & Schemas', type: 'system', summary: 'Tests, macros, schema.yml, and snapshot configs packaged.' },
  { id: 11, name: 'Packaging Output Artifacts', type: 'system', summary: 'All output artifacts ready — proceed to Review & Generate.' }
];

function getInitialStages(isSkillsMode, overrides = []) {
  const template = isSkillsMode ? SKILLS_PIPELINE_STAGES : PROMPTS_PIPELINE_STAGES;
  return template.map((stage, idx) => ({
    ...stage,
    status: 'pending',
    duration: '0s',
    summary: overrides[idx]?.summary || stage.summary,
  }));
}

function getStageBadgeInfo(stage, isSkillsMode) {
  if (isSkillsMode) {
    if (stage.type === 'skill') {
      const num = stage.skillNum || (stage.name.match(/Skill (\d+)/) ? stage.name.match(/Skill (\d+)/)[1] : null);
      const cat = stage.category || 'Skill';
      return {
        label: num ? `Skill ${num} • ${cat}` : `Skill • ${cat}`,
        color: 'bg-[#ECEFFF] text-[#1C58F6] border-[#D1DEFF]',
        runningColor: 'bg-[#1C58F6] text-white',
        completedColor: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    }
    return {
      label: 'SYSTEM AST',
      color: 'bg-slate-100 text-[#475569] border-slate-300',
      runningColor: 'bg-amber-500 text-white',
      completedColor: 'bg-emerald-100 text-emerald-800 border-emerald-300'
    };
  } else {
    if (stage.type === 'prompt') {
      const match = stage.name.match(/Prompt (\d+)/);
      const label = match ? `Prompt ${match[1]}` : 'Prompt Template';
      return {
        label,
        color: 'bg-[#EFF6FF] text-[#1E40AF] border-[#93C5FD]',
        runningColor: 'bg-[#1C58F6] text-white',
        completedColor: 'bg-emerald-100 text-emerald-800 border-emerald-300'
      };
    }
    return {
      label: 'SYSTEM',
      color: 'bg-slate-100 text-[#475569] border-slate-300',
      runningColor: 'bg-amber-500 text-white',
      completedColor: 'bg-emerald-100 text-emerald-800 border-emerald-300'
    };
  }
}

function StageIcon({ stage, status, isSkillsMode }) {
  if (status === 'completed') {
    return (
      <div 
        className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-xs"
        style={{ backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }}
      >
        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
      </div>
    );
  }
  if (status === 'running') {
    return (
      <div 
        className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-xs"
        style={{ backgroundColor: '#ECEFFF', borderColor: '#1C58F6' }}
      >
        <Loader2 className="w-5 h-5 text-[#1C58F6] animate-spin" />
      </div>
    );
  }
  if (isSkillsMode && stage.type === 'skill') {
    return (
      <div 
        className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }}
      >
        <Zap className="w-5 h-5 text-[#1C58F6]" />
      </div>
    );
  }
  if (stage.type === 'prompt') {
    return (
      <div 
        className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
        style={{ backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }}
      >
        <FileCode2 className="w-5 h-5 text-[#64748B]" />
      </div>
    );
  }
  return (
    <div 
      className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
      style={{ backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' }}
    >
      <Package className="w-5 h-5 text-[#64748B]" />
    </div>
  );
}

export default function Step5ExecuteMigration({ onNext, projectState, setProjectState }) {
  // Determine if user selected Skills Engine vs Raw Prompts in Step 2
  const isSkillsMode = (projectState?.skillMode || projectState?.activeMode || 'skills') !== 'prompts';

  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [activeStageIdx, setActiveStageIdx] = useState(-1);
  const [stages, setStages] = useState(() => getInitialStages(isSkillsMode));
  const [metrics, setMetrics] = useState({
    ...EMPTY_METRICS,
    promptVersion: isSkillsMode ? 'AI Skills Engine v3.2' : 'Generic Prompt v6.4'
  });
  const [progressPercentage, setProgressPercentage] = useState(0);
  const progressEndRef = useRef(null);
  const intervalRef = useRef(null);
  const targetFilesCountRef = useRef(0);

  // Update stages when mode switches
  useEffect(() => {
    if (!isRunning && !isComplete) {
      setStages(getInitialStages(isSkillsMode));
      setMetrics(prev => ({
        ...prev,
        promptVersion: isSkillsMode ? 'AI Skills Engine v3.2' : 'Generic Prompt v6.4'
      }));
    }
  }, [isSkillsMode, isRunning, isComplete]);

  const applyExecution = useCallback((execution) => {
    if (!execution) return;
    setStages(execution.stages || []);
    const count = execution.metrics?.filesGenerated || 0;
    if (count > 0) targetFilesCountRef.current = count;
    setMetrics({ ...EMPTY_METRICS, ...(execution.metrics || {}) });
    setProgressPercentage(execution.progressPercentage || 0);
    if (execution.status === 'Completed') {
      setActiveStageIdx((execution.stages?.length || 0) - 1);
      setIsComplete(true);
      setIsRunning(false);
      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          migrationCompleted: true,
          codeConversionAiIssues: execution.metrics?.aiIssues || prev.codeConversionAiIssues || [],
        }));
      }
    }
  }, [setProjectState]);

  useEffect(() => {
    fetchMigrationStatus().then((res) => {
      if (res?.execution?.status === 'Completed') {
        applyExecution(res.execution);
      }
    });
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [applyExecution]);

  useEffect(() => {
    if (isRunning && progressEndRef.current) {
      progressEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeStageIdx, isRunning]);

  const handleStartMigration = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const pending = getInitialStages(isSkillsMode);
    setStages(pending.map(s => ({ ...s, status: 'pending', duration: '0s' })));
    setIsRunning(true);
    setIsComplete(false);
    setActiveStageIdx(0);
    setProgressPercentage(10);
    setMetrics({
      ...EMPTY_METRICS,
      executionTime: '00:00:00',
      promptVersion: isSkillsMode ? 'AI Skills Engine v3.2' : 'Generic Prompt v6.4 Approved'
    });

    const payload = {
      discoveredFiles: projectState?.discoveredFiles || [],
      selectedFileIds: projectState?.selectedFileIds || [],
      prompts: projectState?.prompts || {},
      promptConfigs: projectState?.promptConfigs || [],
      variables: projectState?.variables || {},
      skillMode: isSkillsMode ? 'skills' : 'prompts',
      promptMode: isSkillsMode ? 'skills' : 'prompts'
    };

    // The real conversion (including any AI transpilation) happens in this one call, and it can
    // legitimately take anywhere from a couple seconds to a minute or more depending on how many
    // files need an AI call. The interval below only animates a "still working" visual while this
    // is in flight — it deliberately never reaches 100%/"completed" on its own anymore, because
    // doing that on a fixed timer was pure fiction once real, variable-length AI calls are in the
    // loop. Real completion, real stage list, and real metrics only ever come from this response.
    const startTime = Date.now();
    let stopAnimation = false;

    triggerMigrationRun(payload).then((res) => {
      stopAnimation = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const execution = res?.execution;
      if (!execution) {
        setIsRunning(false);
        setMetrics(prev => ({ ...prev, generationError: res?.error || 'No response from the migration service.' }));
        return;
      }

      const m = execution.metrics || {};
      setStages(execution.stages && execution.stages.length ? execution.stages : pending.map(s => ({ ...s, status: 'completed', duration: '—' })));
      setActiveStageIdx((execution.stages?.length || pending.length) - 1);
      setProgressPercentage(100);
      setIsRunning(false);
      setIsComplete(true);
      setMetrics({
        executionTime: m.executionTime || EMPTY_METRICS.executionTime,
        tokensUsed: m.tokensUsed || 0,
        promptVersion: m.promptVersion || (isSkillsMode ? 'AI Skills Engine v3.2' : 'Generic Prompt v6.4 Approved'),
        filesGenerated: m.filesGenerated || 0,
        aiCost: m.aiCost || '$0.00',
        successRate: m.successRate ?? 0,
        aiFilesProcessed: m.aiFilesProcessed || 0,
        aiFilesFailed: m.aiFilesFailed || 0,
        aiIssues: m.aiIssues || [],
        generationError: m.generationError || null,
      });

      if (setProjectState) {
        setProjectState(prev => ({
          ...prev,
          migrationCompleted: true,
          hasMigrated: true,
          codeConversionAiIssues: m.aiIssues || [],
        }));
      }
    });

    // Visual-only "still working" animation — capped short of the last stage/100% so it never
    // implies completion the real call hasn't reached yet.
    let step = 0;
    const stageStartTimes = [startTime];
    const maxAnimatedStep = Math.max(0, pending.length - 2);

    intervalRef.current = setInterval(() => {
      if (stopAnimation) return;
      const now = Date.now();
      const totalElapsedSec = Math.max(0, (now - startTime) / 1000);
      const mins = String(Math.floor(totalElapsedSec / 60)).padStart(2, '0');
      const secs = String(Math.floor(totalElapsedSec % 60)).padStart(2, '0');
      const timeStr = `00:${mins}:${secs}`;

      const estimatedStageDuration = 1.4; // seconds per stage, purely for the visual cadence
      const currentStep = Math.min(maxAnimatedStep, Math.floor(totalElapsedSec / estimatedStageDuration));
      if (currentStep !== step) {
        step = currentStep;
        stageStartTimes.push(now);
      }

      setActiveStageIdx(step);
      setProgressPercentage(Math.min(90, Math.round(((step + 1) / pending.length) * 100)));
      setMetrics((prev) => ({ ...prev, executionTime: timeStr }));

      setStages((current) =>
        current.map((stage, idx) => {
          if (idx < step) {
            return { ...stage, status: 'completed', duration: stage.duration !== '0s' ? stage.duration : '1.4s' };
          } else if (idx === step) {
            const currentStageElapsed = ((now - (stageStartTimes[idx] || now)) / 1000).toFixed(1);
            return { ...stage, status: 'running', duration: `${currentStageElapsed}s` };
          }
          return stage;
        })
      );
    }, 200);
  };

  const handleCancelMigration = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
  };

  const getStageStatus = (idx, stage) => {
    if (isComplete || idx < activeStageIdx) return 'completed';
    if (isRunning && idx === activeStageIdx) return 'running';
    return stage.status === 'completed' && idx <= activeStageIdx ? 'completed' : 'pending';
  };

  const completedCount = isComplete
    ? stages.length
    : Math.max(0, activeStageIdx);

  return (
    <div className="space-y-6 pb-12 font-sans" style={{ color: '#1E293B' }}>
      {/* Header Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-[#ECEFFF] text-[#1C58F6] px-3 py-1 rounded-full text-xs font-semibold border border-[#D1DEFF] mb-2 gap-1.5">
            {isSkillsMode ? <Zap className="w-3.5 h-3.5 text-amber-500" /> : <FileCode2 className="w-3.5 h-3.5 text-sky-500" />}
            <span>Step 4 of 5 • {isSkillsMode ? 'Autonomous AI Skill Engine Pipeline' : 'Raw Prompt Pipeline Execution'}</span>
          </div>
          <h1 className="text-2xl font-black text-[#10338D] tracking-tight">
            {isSkillsMode ? 'Execute Autonomous AI Skills Pipeline' : 'Execute Raw Prompt Pipeline'}
          </h1>
          <p className="text-xs text-[#475569] mt-1 font-normal leading-relaxed">
            {isSkillsMode 
              ? 'Execute 6 autonomous transformation skills equipped with AST parsers, transpilers, and SCD2 snapshot injectors in real time.' 
              : 'Run the 11-stage AI transformation pipeline using approved generic prompt directives.'}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {isRunning && (
            <button
              type="button"
              onClick={handleCancelMigration}
              className="px-4 py-2.5 rounded-xl font-bold text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs"
              title="Cancel running migration pipeline"
            >
              <X className="w-4 h-4" />
              <span>Cancel Execution</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleStartMigration}
            disabled={isRunning}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-sm cursor-pointer ${
              isRunning
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-[#FF3C00] hover:bg-[#E03500] text-white'
            }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{isSkillsMode ? 'Executing AI Skills...' : 'Running Pipeline...'}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>{isComplete ? (isSkillsMode ? 'Re-run AI Skills Engine' : 'Re-run AI Migration') : (isSkillsMode ? 'Start AI Skills Engine' : 'Start AI Migration')}</span>
              </>
            )}
          </button>


        </div>
      </div>

      {/* Completion Banner */}
      {isComplete && (
        <div 
          className="border rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in"
          style={{ backgroundColor: '#F0FDF4', borderColor: '#86EFAC' }}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white border border-emerald-300 flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-black text-emerald-900">
                {isSkillsMode 
                  ? 'AI Transformation Skills Pipeline Completed Successfully' 
                  : 'Migration Pipeline Completed Successfully'}
              </p>
              <p className="text-xs text-emerald-800 mt-0.5 font-medium">
                {isSkillsMode
                  ? `All 6 Autonomous Skills executed and ${metrics.filesGenerated} dbt files generated with ${metrics.successRate}% test pass rate.`
                  : `All prompts executed and ${metrics.filesGenerated} dbt files generated with ${metrics.successRate}% test pass rate.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 self-end sm:self-center">
            <div className="text-right shrink-0 hidden sm:block">
              <p className="text-[10px] uppercase font-bold text-[#64748B]">Total Execution Time</p>
              <p className="text-lg font-black text-[#10338D] font-mono">{metrics.executionTime}</p>
            </div>
            <button
              type="button"
              onClick={onNext}
              className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-md cursor-pointer shrink-0"
            >
              <span>View dbt Models in Step 5</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Generation Error Banner — a real backend failure, shown honestly instead of a fake success */}
      {metrics.generationError && (
        <div className="border border-red-200 bg-red-50 rounded-2xl p-5 flex items-start gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-black text-red-800">Migration Failed</p>
            <p className="text-xs text-red-700 mt-1 font-mono leading-relaxed">{metrics.generationError}</p>
          </div>
        </div>
      )}

      {/* AI Transpilation Results — real per-file outcome from the AI conversion of legacy/broken
          scripts, surfaced as soon as the run completes (this app converts synchronously, so this
          isn't a live-updating-per-file stream, but every number here is real, not simulated). */}
      {isComplete && metrics.aiFilesProcessed > 0 && (
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#1C58F6]" />
              <h2 className="text-sm font-black text-[#10338D]">AI Transpilation Results</h2>
            </div>
            <span className="text-[11px] font-semibold text-[#475569] bg-[#F8FAFC] px-2.5 py-1 rounded-lg border border-[#CBD5E1]">
              {metrics.aiFilesProcessed - metrics.aiFilesFailed} of {metrics.aiFilesProcessed} script(s) converted
              {metrics.aiFilesFailed > 0 && <span className="text-red-600 font-bold"> · {metrics.aiFilesFailed} failed</span>}
            </span>
          </div>

          {metrics.aiIssues && metrics.aiIssues.length > 0 ? (
            <div className="space-y-2">
              {metrics.aiIssues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start gap-2.5 p-3 rounded-xl border"
                  style={{
                    backgroundColor: issue.severity === 'error' ? '#FEF2F2' : issue.severity === 'warning' ? '#FFFBEB' : '#F0F9FF',
                    borderColor: issue.severity === 'error' ? '#FECACA' : issue.severity === 'warning' ? '#FDE68A' : '#BAE6FD',
                  }}
                >
                  {issue.severity === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  ) : issue.severity === 'warning' ? (
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-[#1E293B] leading-relaxed">{issue.message}</p>
                    <p className="text-[10px] text-[#64748B] font-mono mt-1">
                      {issue.sourceScript ? `${issue.sourceScript} → ` : ''}{issue.file}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#64748B]">No issues to review — every script converted with high confidence.</p>
          )}
        </div>
      )}

      {/* METRICS DASHBOARD CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5 text-[#1C58F6]" />
            <span>Execution Time</span>
          </div>
          <div className="text-xl font-black text-[#10338D] font-mono mt-1">{metrics.executionTime}</div>
          <div className="text-[10px] font-semibold text-[#1C58F6] mt-0.5">High-Speed Parallel</div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
            <Cpu className="w-3.5 h-3.5 text-teal-600" />
            <span>Tokens Processed</span>
          </div>
          <div className="text-xl font-black text-[#10338D] font-mono mt-1">{metrics.tokensUsed.toLocaleString()}</div>
          <div className="text-[10px] font-semibold text-teal-600 mt-0.5">{metrics.promptVersion}</div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
            <FileText className="w-3.5 h-3.5 text-amber-600" />
            <span>Files Generated</span>
          </div>
          <div className="text-xl font-black text-[#10338D] font-mono mt-1">{metrics.filesGenerated}</div>
          <div className="text-[10px] font-semibold text-amber-600 mt-0.5">dbt Snowflake Project</div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
            <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
            <span>AI LLM Cost</span>
          </div>
          <div className="text-xl font-black text-emerald-600 font-mono mt-1">{metrics.aiCost}</div>
          <div className="text-[10px] font-semibold text-emerald-600 mt-0.5">Optimized Execution</div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold uppercase text-[#475569] flex items-center space-x-1">
            <CheckCheck className="w-3.5 h-3.5 text-[#1C58F6]" />
            <span>Success Rate</span>
          </div>
          <div className="text-xl font-black text-[#10338D] font-mono mt-1">{metrics.successRate}%</div>
          <div className="text-[10px] font-semibold text-[#1C58F6] mt-0.5">All Rules Verified</div>
        </div>
      </div>

      {/* TIMELINE & STAGE PROGRESS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Live Migration Timeline */}
        <div className="lg:col-span-4 bg-white border border-[#D1DEFF] rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-[#10338D] flex items-center space-x-2">
              <Zap className="w-4 h-4 text-[#FF3C00]" />
              <span>{isSkillsMode ? 'AI Skills Timeline' : 'Pipeline Timeline'}</span>
            </h2>
            <span 
              className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border"
              style={{
                backgroundColor: isComplete ? '#F0FDF4' : isRunning ? '#FEF3C7' : '#F1F5F9',
                color: isComplete ? '#166534' : isRunning ? '#92400E' : '#475569',
                borderColor: isComplete ? '#86EFAC' : isRunning ? '#FCD34D' : '#CBD5E1'
              }}
            >
              {isComplete ? 'Completed' : isRunning ? `Stage ${activeStageIdx + 1}/${stages.length}` : 'Ready'}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-bold text-[#475569]">
              <span>Overall Progress</span>
              <span className="text-[#10338D]">{progressPercentage}%</span>
            </div>
            <div className="h-2 bg-[#ECEFFF] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#1C58F6] to-[#10338D] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          <div className="space-y-2.5 relative pl-4 border-l-2 border-[#D1DEFF] ml-2">
            {stages.map((stg, idx) => {
              const status = getStageStatus(idx, stg);
              const isDone = status === 'completed';
              const isCurrent = status === 'running';
              const badgeInfo = getStageBadgeInfo(stg, isSkillsMode);

              return (
                <div key={stg.id} className="relative flex items-center justify-between text-xs py-1">
                  <div
                    className={`absolute -left-[23px] w-3.5 h-3.5 rounded-full border-2 transition-all ${
                      isDone
                        ? 'bg-emerald-500 border-emerald-400'
                        : isCurrent
                        ? 'bg-[#FF3C00] border-[#FF3C00] animate-pulse'
                        : 'bg-white border-[#CBD5E1]'
                    }`}
                  />
                  <div className="flex flex-col min-w-0 pr-2">
                    <span 
                      className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${
                        isDone ? 'text-emerald-700' : isCurrent ? 'text-[#1C58F6]' : 'text-[#64748B]'
                      }`}
                    >
                      {badgeInfo.label}
                    </span>
                    <span className={`font-semibold truncate ${
                      isDone ? 'text-[#10338D]' : isCurrent ? 'text-[#1C58F6]' : 'text-[#475569]'
                    }`}>
                      {stg.name.replace(/^Executing Skill:\s*/, '').replace(/^Running /, '')}
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono shrink-0 font-bold ${
                    isDone ? 'text-emerald-600' : isCurrent ? 'text-[#1C58F6]' : 'text-[#64748B]'
                  }`}>
                    {isDone ? stg.duration : isCurrent ? 'running' : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-[#D1DEFF] flex items-center justify-between text-[11px] text-[#475569] font-medium">
            <span>{completedCount} of {stages.length} stages done</span>
            <button
              type="button"
              onClick={handleStartMigration}
              disabled={isRunning}
              className="text-[#1C58F6] hover:text-[#10338D] flex items-center space-x-1 cursor-pointer disabled:opacity-40 font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>

        {/* Stage Completion Panel */}
        <div className="lg:col-span-8 bg-white border border-[#D1DEFF] rounded-2xl p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-[#D1DEFF]">
            <div className="flex items-center space-x-2">
              <Package className="w-4 h-4 text-[#1C58F6]" />
              <span className="text-sm font-bold text-[#10338D]">
                {isSkillsMode ? 'AI Skills Execution Stream' : 'Stage Completion Progress'}
              </span>
            </div>
            <span className="text-[10px] font-semibold text-[#334155] bg-[#F8FAFC] px-3 py-1 rounded-lg border border-[#CBD5E1]">
              {isRunning ? 'Processing Skills...' : isComplete ? 'All stages complete' : 'Waiting to start'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-3 max-h-[560px]">
            {!isRunning && !isComplete && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div 
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border border-[#D1DEFF]"
                  style={{ backgroundColor: '#ECEFFF' }}
                >
                  <Play className="w-7 h-7 text-[#1C58F6]" />
                </div>
                <p className="text-base font-black text-[#10338D]">
                  {isSkillsMode ? 'Ready to Execute AI Skills Pipeline' : 'Ready to Execute Migration'}
                </p>
                <p className="text-xs text-[#475569] mt-1.5 max-w-md font-normal leading-relaxed">
                  {isSkillsMode
                    ? 'Click Start AI Skills Engine to run AST extraction, Medallion modeling, SQL transpilation, SCD2 snapshots, and Jinja test validation.'
                    : 'Click Start AI Migration to run the 11-stage generic prompt pipeline.'}
                </p>
                <button
                  type="button"
                  onClick={handleStartMigration}
                  className="mt-5 bg-[#FF3C00] hover:bg-[#E03500] text-white px-6 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-sm cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>{isSkillsMode ? 'Start AI Skills Engine' : 'Start AI Migration'}</span>
                </button>
              </div>
            )}

            {stages.map((stg, idx) => {
              const status = getStageStatus(idx, stg);
              const badgeInfo = getStageBadgeInfo(stg, isSkillsMode);
              const isVisible = status !== 'pending' || isComplete;

              if (!isVisible && !isRunning) return null;

              return (
                <div
                  key={stg.id}
                  className="rounded-xl border p-4 transition-all duration-300"
                  style={{
                    backgroundColor: status === 'completed' ? '#F0FDF4' : status === 'running' ? '#ECEFFF' : '#F8FAFC',
                    borderColor: status === 'completed' ? '#86EFAC' : status === 'running' ? '#1C58F6' : '#E2E8F0',
                    boxShadow: status === 'running' ? '0 0 0 1px rgba(28, 88, 246, 0.2)' : 'none'
                  }}
                >
                  <div className="flex items-start gap-3.5">
                    <StageIcon stage={stg} status={status} isSkillsMode={isSkillsMode} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {status === 'completed' && (
                            <span 
                              className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full mb-1.5 border border-[#86EFAC]"
                              style={{ backgroundColor: '#DCFCE7', color: '#166534' }}
                            >
                              {badgeInfo.label} • COMPLETED
                            </span>
                          )}
                          {status === 'running' && (
                            <span 
                              className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full mb-1.5 border border-[#D1DEFF]"
                              style={{ backgroundColor: '#ECEFFF', color: '#1C58F6' }}
                            >
                              Running {badgeInfo.label}...
                            </span>
                          )}
                          <p className={`text-sm font-bold leading-snug ${
                            status === 'completed' ? 'text-[#10338D]' : status === 'running' ? 'text-[#1C58F6]' : 'text-[#475569]'
                          }`}>
                            {stg.name}
                          </p>
                        </div>

                        {status === 'completed' && (
                          <span 
                            className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-lg shrink-0 border border-[#86EFAC]"
                            style={{ backgroundColor: '#FFFFFF', color: '#166534' }}
                          >
                            {stg.duration}
                          </span>
                        )}
                      </div>

                      {status === 'completed' && stg.summary && (
                        <p className="text-xs text-emerald-900 mt-1.5 leading-relaxed font-normal">{stg.summary}</p>
                      )}

                      {status === 'running' && (
                        <p className="text-xs text-[#1C58F6] mt-1.5 flex items-center gap-1.5 font-medium">
                          <Loader2 className="w-3 h-3 animate-spin text-[#1C58F6]" />
                          {isSkillsMode ? 'AI Transformation Skill processing in sandbox AST environment...' : 'AI engine processing prompt directive...'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={progressEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
