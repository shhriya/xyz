import React, { useState, useEffect } from 'react';
import {
  FileCode2,
  CheckCircle2,
  RotateCcw,
  Save,
  Zap,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sliders,
  Layers,
  ShieldCheck,
  CheckSquare,
  BookOpen,
  Grid,
  Play,
  Loader2,
  Wrench,
  Sparkles,
  Cpu,
  Code2,
  Check,
  Terminal,
  Copy,
  Search,
  Maximize2,
  Minimize2,
  Database,
} from 'lucide-react';
import {
  fetchSkillsConfig,
  saveSkillsConfig,
  testSingleSkillApi,
  savePrompts,
  validatePromptsApi,
  fetchPromptsConfig,
} from '@/api';
import { DEFAULT_PROMPTS, DEFAULT_PROMPTS_MAP } from './defaultPrompts';
import PromptOptimizerButton from '@/components/PromptOptimizerButton';

const DEFAULT_SKILLS = [
  {
    id: "source_extractor_skill",
    name: "Source Schema & Mapping Extractor",
    category: "Ingestion & AST",
    icon: "Layers",
    version: "v2.4",
    description: "Parses preprocessed Informatica XML, PySpark scripts, and SQL to extract table schemas, column types, and DAG dependencies.",
    enabled: true,
    tools: ["xml_informatica_parser", "pyspark_ast_extractor", "table_relationship_detector"],
    parameters: {
      multi_workflow_support: true,
      infer_foreign_keys: true,
      strip_runtime_boilerplate: true
    },
    promptDirective: "Identify all source tables, target entities, and column datatypes from uploaded files. Ensure dependencies across multiple workflows are mapped accurately."
  },
  {
    id: "medallion_architect_skill",
    name: "Medallion Architecture Designer",
    category: "Data Modeling",
    icon: "Grid",
    version: "v2.1",
    description: "Assigns data transformations to Bronze (raw staging views), Silver (cleansed models), and Gold (business fact/dim marts).",
    enabled: true,
    tools: ["dag_dependency_builder", "layer_classifier", "snowflake_schema_mapper"],
    parameters: {
      bronze_materialization: "view",
      silver_materialization: "table",
      gold_materialization: "view",
      generate_snapshots: true
    },
    promptDirective: "Organize models into a 3-tier Medallion architecture (Bronze -> Silver -> Gold) with SCD Type 2 history tracking for dimensional entities."
  },
  {
    id: "pyspark_to_dbt_skill",
    name: "PySpark to dbt SQL Transpiler",
    category: "Code Transpiler",
    icon: "Zap",
    version: "v3.2",
    description: "Converts PySpark DataFrame operations (.withColumn, .filter, .join, .groupBy, window functions) into modular dbt CTE SQL for Snowflake.",
    enabled: true,
    tools: ["pyspark_ast_transpiler", "sqlglot_snowflake_dialect", "cte_modularizer"],
    parameters: {
      cte_style: "explicit_readable",
      target_dialect: "snowflake",
      vectorize_joins: true,
      coalesce_nulls: true
    },
    promptDirective: "Transpile PySpark DataFrame operations into CTE-based dbt SQL models using Snowflake vectorized syntax and idiomatic dbt Jinja ref() tags."
  },
  {
    id: "data_safety_keys_skill",
    name: "Data Safety & SCD2 Key Injector",
    category: "Data Integrity",
    icon: "ShieldCheck",
    version: "v2.2",
    description: "Injects dbt_utils.generate_surrogate_key across dimension tables and constructs SCD Type 2 snapshot configurations with valid_from/valid_to dates.",
    enabled: true,
    tools: ["surrogate_key_generator", "scd2_snapshot_builder", "hash_diff_detector"],
    parameters: {
      surrogate_key_macro: "dbt_utils.generate_surrogate_key",
      scd2_strategy: "timestamp",
      track_hash_diff: true,
      timestamp_column: "sys_updated_ts"
    },
    promptDirective: "Inject MD5 surrogate keys into Silver and Gold models. Create automated SCD Type 2 snapshots for dimension entities."
  },
  {
    id: "jinja_test_validator_skill",
    name: "Jinja Schema Test Generator",
    category: "QA & Validation",
    icon: "CheckSquare",
    version: "v2.0",
    description: "Generates automated schema.yml test suites including unique primary keys, not_null columns, accepted_values, and relationship integrity checks.",
    enabled: true,
    tools: ["schema_yaml_generator", "jinja_syntax_checker", "integrity_test_builder"],
    parameters: {
      test_primary_keys: true,
      test_foreign_keys: true,
      test_not_null_critical: true,
      generate_source_yaml: true
    },
    promptDirective: "Generate a comprehensive models/schema.yml containing automated Jinja tests for uniqueness, non-nullability, and referential integrity."
  },
  {
    id: "docs_lineage_skill",
    name: "Model Documentation & Lineage",
    category: "Governance",
    icon: "BookOpen",
    version: "v1.9",
    description: "Generates markdown documentation dictionaries (docs/*.md) with business descriptions, source mappings, and column lineage metadata.",
    enabled: true,
    tools: ["markdown_doc_builder", "column_lineage_tracker"],
    parameters: {
      generate_overview_md: true,
      include_source_provenance: true,
      include_transformation_notes: true
    },
    promptDirective: "Create detailed markdown documentation describing the modernization metadata, transformations applied, and target schema layout."
  }
];

const PROMPT_LAYER_BADGES = {
  p1: { label: 'Bronze & Sources', color: 'bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]' },
  p2: { label: 'Medallion Architecture', color: 'bg-[#DBEAFE] text-[#1E40AF] border-[#93C5FD]' },
  p3: { label: 'CTE Models & SCD2', color: 'bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]' },
  p4: { label: 'Data Safety & Keys', color: 'bg-[#F3E8FF] text-[#6B21A8] border-[#D8B4FE]' },
  p5: { label: 'Validation & Tests', color: 'bg-[#CCFBF1] text-[#115E59] border-[#5EEAD4]' },
  p6: { label: 'Project Tree & Docs', color: 'bg-[#E0F2FE] text-[#075985] border-[#7DD3FC]' }
};

export default function Step3PromptConfig({ onNext, projectState, setProjectState }) {
  // Mode: "skills" (default) or "prompts"
  const [activeMode, setActiveMode] = useState('skills');
  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [selectedSkillId, setSelectedSkillId] = useState(DEFAULT_SKILLS[0].id);

  // Prompts Mode state (initialized with approved Generic Prompt v6.4 specs)
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS_MAP);
  const [expandedPromptId, setExpandedPromptId] = useState('p1');
  const [allExpanded, setAllExpanded] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [validationResult, setValidationResult] = useState(null);

  // Variables
  const [variables, setVariables] = useState({
    targetDatabase: 'SNOWFLAKE_PROD_DB',
    bronzeSchema: 'RAW_STAGING',
    silverSchema: 'EDW_SILVER',
    goldSchema: 'EDW_GOLD',
    snapshotSchema: 'EDW_SNAPSHOTS',
    dbtVersion: '1.8.0'
  });

  // Sandbox testing state
  const [isTestingSkill, setIsTestingSkill] = useState(false);
  const [sandboxOutput, setSandboxOutput] = useState(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // Load skills & prompts config from backend on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const [skillsRes, promptsRes] = await Promise.all([
          fetchSkillsConfig(),
          fetchPromptsConfig()
        ]);

        if (skillsRes && skillsRes.skills && Array.isArray(skillsRes.skills) && skillsRes.skills.length > 0) {
          setSkills(skillsRes.skills);
          setSelectedSkillId(skillsRes.skills[0].id);
          if (skillsRes.mode) setActiveMode(skillsRes.mode);
          if (skillsRes.variables) setVariables(prev => ({ ...prev, ...skillsRes.variables }));
        }

        if (promptsRes && promptsRes.config && promptsRes.config.manualPrompts) {
          const backendPrompts = promptsRes.config.manualPrompts;
          setPrompts(prev => ({
            ...DEFAULT_PROMPTS_MAP,
            ...backendPrompts
          }));
        }
      } catch (err) {
        console.warn('Failed to load full skills/prompts config', err);
      }
    }
    loadConfig();
  }, []);

  const selectedSkill = skills.find(s => s.id === selectedSkillId) || skills[0];

  const handleToggleSkill = (skillId) => {
    const updated = skills.map(s => s.id === skillId ? { ...s, enabled: !s.enabled } : s);
    setSkills(updated);
    saveSkillsConfig({ mode: activeMode, skills: updated, variables });
    if (setProjectState) {
      setProjectState(prev => ({ ...prev, skills: updated }));
    }
  };

  const handleUpdateParameter = (skillId, paramKey, value) => {
    const updated = skills.map(s => {
      if (s.id === skillId) {
        return {
          ...s,
          parameters: {
            ...s.parameters,
            [paramKey]: value
          }
        };
      }
      return s;
    });
    setSkills(updated);
  };

  const handleUpdateDirective = (skillId, text) => {
    const updated = skills.map(s => s.id === skillId ? { ...s, promptDirective: text } : s);
    setSkills(updated);
  };

  const handleRunSingleTest = async (skillId) => {
    setIsTestingSkill(true);
    setSandboxOutput(null);
    try {
      const res = await testSingleSkillApi(skillId, null, selectedSkill.parameters);
      setSandboxOutput(res);
    } catch {
      setSandboxOutput({ status: 'error', message: 'Test execution failed.' });
    }
    setIsTestingSkill(false);
  };

  const handleSaveAll = async () => {
    const res = await saveSkillsConfig({
      mode: activeMode,
      skills,
      variables
    });
    await savePrompts({
      mode: activeMode,
      prompts,
      variables
    });
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        skills,
        skillMode: activeMode,
        prompts,
        promptsValidated: true,
        promptsConfigured: true
      }));
    }
    setSaveSuccessMsg('AI Skills & Prompts configuration persisted successfully!');
    setTimeout(() => setSaveSuccessMsg(''), 3000);
    return res;
  };

  const handleValidatePrompts = async () => {
    const res = await validatePromptsApi(prompts, variables);
    setValidationResult(res);
    if (setProjectState) {
      setProjectState(prev => ({
        ...prev,
        prompts,
        promptsValidated: true,
        promptsConfigured: true
      }));
    }
  };

  const handleCopyPrompt = (promptId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedPromptId(promptId);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const handleResetSinglePrompt = (promptId) => {
    const defaultVal = DEFAULT_PROMPTS_MAP[promptId] || '';
    setPrompts(prev => ({
      ...prev,
      [promptId]: defaultVal
    }));
  };

  const handleResetAllPrompts = () => {
    setPrompts(DEFAULT_PROMPTS_MAP);
    setSkills(DEFAULT_SKILLS);
  };

  const toggleExpandAll = () => {
    setAllExpanded(!allExpanded);
  };

  const enabledCount = skills.filter(s => s.enabled).length;

  const getCategoryIcon = (cat) => {
    switch (cat) {
      case 'Ingestion & AST': return <Layers className="w-4 h-4 text-amber-500" />;
      case 'Data Modeling': return <Grid className="w-4 h-4 text-blue-500" />;
      case 'Code Transpiler': return <Zap className="w-4 h-4 text-emerald-500" />;
      case 'Data Integrity': return <ShieldCheck className="w-4 h-4 text-purple-500" />;
      case 'QA & Validation': return <CheckSquare className="w-4 h-4 text-teal-500" />;
      case 'Governance': return <BookOpen className="w-4 h-4 text-sky-500" />;
      default: return <Cpu className="w-4 h-4 text-indigo-500" />;
    }
  };

  // Filter prompts based on search term
  const filteredPrompts = DEFAULT_PROMPTS.filter(p => {
    if (!promptSearch.trim()) return true;
    const q = promptSearch.toLowerCase();
    const promptText = (prompts[p.id] || p.code || '').toLowerCase();
    return p.title.toLowerCase().includes(q) ||
           p.desc.toLowerCase().includes(q) ||
           (p.subtitle && p.subtitle.toLowerCase().includes(q)) ||
           promptText.includes(q);
  });

  return (
    <div className="space-y-6 pb-12 font-sans" style={{ color: '#1E293B' }}>
      {/* Header Banner */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center bg-[#ECEFFF] text-[#1C58F6] px-3 py-1 rounded-full text-xs font-semibold border border-[#D1DEFF] mb-2 gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Step 2 of 5 • AI Skill Engine & Generic Prompt Registry</span>
          </div>
          <h1 className="text-2xl font-black text-[#10338D] tracking-tight">AI Skill Engine & Transformation Rules</h1>
          <p className="text-xs text-[#475569] mt-1 max-w-2xl font-normal leading-relaxed">
            Configure autonomous transformation skills, inspect attached AST transpilers, and edit approved generic prompt templates (Generic Prompt v6.4 Spec).
          </p>
        </div>

        {/* Mode Switcher & Actions */}
        <div className="flex flex-col items-end gap-3 shrink-0">
          <div className="bg-[#F1F5F9] p-1 rounded-xl border border-[#CBD5E1] flex items-center shadow-inner">
            <button
              onClick={() => setActiveMode('skills')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeMode === 'skills'
                  ? 'bg-[#10338D] text-white shadow-sm ring-1 ring-[#10338D]/20'
                  : 'text-[#475569] hover:text-[#10338D]'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>AI Skills Engine</span>
            </button>
            <button
              onClick={() => setActiveMode('prompts')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeMode === 'prompts'
                  ? 'bg-[#10338D] text-white shadow-sm ring-1 ring-[#10338D]/20'
                  : 'text-[#475569] hover:text-[#10338D]'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5 text-sky-300" />
              <span>Raw Prompt Mode (v6)</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleResetAllPrompts}
              title="Reset all skills & prompts to default Generic v6 specifications"
              className="bg-white hover:bg-[#F8FAFC] text-[#334155] border border-[#CBD5E1] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
              style={{ color: '#334155', backgroundColor: '#FFFFFF' }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              onClick={handleSaveAll}
              className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* TOP METRICS KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider">Active Engine Mode</div>
          <div className="text-base font-black text-[#10338D] mt-1 flex items-center gap-1.5">
            {activeMode === 'skills' ? (
              <>
                <Zap className="w-4 h-4 text-amber-500" />
                <span>Autonomous Skills</span>
              </>
            ) : (
              <>
                <FileCode2 className="w-4 h-4 text-[#1C58F6]" />
                <span>Raw Generic Prompts</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider">Configured Skills</div>
          <div className="text-base font-black text-[#059669] mt-1">
            {enabledCount} of {skills.length} Enabled
          </div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider">Prompt Spec Standard</div>
          <div className="text-base font-black text-[#1C58F6] mt-1 truncate">
            Generic Prompt v6.4
          </div>
        </div>

        <div className="bg-white border border-[#D1DEFF] p-4 rounded-xl shadow-xs">
          <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider">AST Tools Loaded</div>
          <div className="text-base font-black text-[#7C3AED] mt-1">
            18 Deterministic Tools
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      {activeMode === 'skills' ? (
        /* --- AI SKILLS ENGINE LAYOUT --- */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Skill Modules List */}
          <div className="lg:col-span-7 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1">
              <h2 className="text-sm font-black text-[#10338D] uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#1C58F6]" />
                <span>TRANSFORMATION SKILLS REGISTRY ({skills.length})</span>
              </h2>
              <span className="text-[11px] text-[#64748B] font-medium">Click card to inspect parameters & AST tools</span>
            </div>

            <div className="space-y-3">
              {skills.map((skill) => {
                const isSelected = skill.id === selectedSkillId;
                return (
                  <div
                    key={skill.id}
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-[#F8FAFC] border-[#1C58F6] shadow-md ring-1 ring-[#1C58F6]/20'
                        : 'bg-white border-[#D1DEFF] hover:border-[#1C58F6]/50 hover:bg-[#F8FAFC]/50 hover:shadow-xs'
                    }`}
                    style={{ backgroundColor: isSelected ? '#F8FAFC' : '#FFFFFF' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div 
                          className="p-2.5 rounded-xl shrink-0 mt-0.5 border border-[#D1DEFF]"
                          style={{ backgroundColor: '#ECEFFF' }}
                        >
                          {getCategoryIcon(skill.category)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-black text-xs sm:text-sm text-[#10338D]">{skill.name}</h3>
                            <span 
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#CBD5E1]"
                              style={{ backgroundColor: '#F1F5F9', color: '#1E293B' }}
                            >
                              {skill.version}
                            </span>
                            <span 
                              className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#D1DEFF]"
                              style={{ backgroundColor: '#ECEFFF', color: '#1C58F6' }}
                            >
                              {skill.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#334155] leading-relaxed font-normal">
                            {skill.description}
                          </p>
                        </div>
                      </div>

                    </div>

                    {/* Tools badges with high contrast background and text */}
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[#E2E8F0] flex-wrap">
                      <span className="text-[10px] font-bold text-[#64748B] mr-1 uppercase">Tools:</span>
                      {skill.tools.map((t) => (
                        <span 
                          key={t} 
                          className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-[#CBD5E1] font-semibold"
                          style={{ backgroundColor: '#F1F5F9', color: '#0F172A' }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Skill Inspector & Sandbox Test */}
          <div 
            className="lg:col-span-5 rounded-2xl p-5 space-y-5 shadow-xl border border-[#1E293B] sticky top-4"
            style={{ backgroundColor: '#0B132B', color: '#FFFFFF' }}
          >
            <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#38BDF8] font-bold">SKILL INSPECTOR</span>
                <h3 className="font-bold text-sm text-[#FFFFFF] flex items-center gap-1.5 mt-0.5">
                  <Wrench className="w-4 h-4 text-[#38BDF8]" />
                  <span>{selectedSkill.name}</span>
                </h3>
              </div>
              <span 
                className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border"
                style={{
                  backgroundColor: selectedSkill.enabled ? '#064E3B' : '#1E293B',
                  color: selectedSkill.enabled ? '#34D399' : '#94A3B8',
                  borderColor: selectedSkill.enabled ? '#059669' : '#334155'
                }}
              >
                {selectedSkill.enabled ? 'ACTIVE' : 'DISABLED'}
              </span>
            </div>

            {/* Hyperparameters Config */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Deterministic Parameters</span>
              </h4>
              <div 
                className="rounded-xl p-3.5 space-y-2.5 border border-[#1E293B]"
                style={{ backgroundColor: '#020617' }}
              >
                {Object.entries(selectedSkill.parameters).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-[#94A3B8] font-mono text-[11px] font-medium">{key}</span>
                    {typeof val === 'boolean' ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateParameter(selectedSkill.id, key, !val)}
                        className="px-2.5 py-1 rounded text-[10px] font-mono font-bold cursor-pointer transition-colors border"
                        style={{
                          backgroundColor: val ? '#065F46' : '#1E293B',
                          color: val ? '#6EE7B7' : '#94A3B8',
                          borderColor: val ? '#059669' : '#334155'
                        }}
                      >
                        {val ? 'TRUE' : 'FALSE'}
                      </button>
                    ) : (
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => handleUpdateParameter(selectedSkill.id, key, e.target.value)}
                        className="border rounded text-[11px] font-mono text-right w-44 px-2 py-1 focus:outline-none focus:border-[#38BDF8]"
                        style={{ 
                          color: '#F8FAFC', 
                          backgroundColor: '#0B132B',
                          borderColor: '#334155'
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Attached Agent Tools */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#C084FC]" />
                <span>Attached Tools ({selectedSkill.tools.length})</span>
              </h4>
              <div className="grid grid-cols-1 gap-1.5">
                {selectedSkill.tools.map(tool => (
                  <div 
                    key={tool} 
                    className="flex items-center justify-between text-[11px] font-mono px-3 py-2 rounded-lg border border-[#1E293B]"
                    style={{ backgroundColor: '#020617', color: '#E2E8F0' }}
                  >
                    <span className="truncate text-[#E2E8F0] font-medium">{tool}</span>
                    <span className="text-[10px] text-[#34D399] font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Ready
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* System Directive Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-[#FBBF24]" />
                  <span>System Directive (Custom Prompt)</span>
                </h4>
              </div>
              <textarea
                value={selectedSkill.promptDirective}
                onChange={(e) => handleUpdateDirective(selectedSkill.id, e.target.value)}
                rows={3}
                className="w-full border rounded-xl p-3 text-[11px] font-mono leading-relaxed focus:outline-none focus:border-[#38BDF8]"
                style={{ 
                  color: '#38BDF8', 
                  backgroundColor: '#020617',
                  borderColor: '#1E293B'
                }}
              />
            </div>

            {/* Isolated Sandbox Test Runner */}
            <div className="space-y-2.5 pt-2 border-t border-[#1E293B]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#34D399]" />
                  <span>Sandbox Unit Test</span>
                </h4>
                <button
                  type="button"
                  onClick={() => handleRunSingleTest(selectedSkill.id)}
                  disabled={isTestingSkill}
                  className="text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all disabled:opacity-50"
                  style={{ backgroundColor: '#059669' }}
                >
                  {isTestingSkill ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-white" />
                      <span>Run Test</span>
                    </>
                  )}
                </button>
              </div>

              {sandboxOutput ? (
                <div 
                  className="p-3 rounded-xl border border-[#1E293B] space-y-2 text-xs"
                  style={{ backgroundColor: '#020617' }}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-[#34D399] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {sandboxOutput.validation || 'Test Passed'}
                    </span>
                    <span className="text-[#94A3B8] font-mono">{sandboxOutput.latencyMs}ms</span>
                  </div>
                  {sandboxOutput.outputPreview?.generatedSqlSnippet && (
                    <pre 
                      className="text-[10px] font-mono p-2.5 rounded border border-[#1E293B] overflow-x-auto"
                      style={{ color: '#6EE7B7', backgroundColor: '#0B132B' }}
                    >
                      {sandboxOutput.outputPreview.generatedSqlSnippet}
                    </pre>
                  )}
                </div>
              ) : (
                <div 
                  className="text-[10px] text-center py-2.5 rounded-xl border border-[#1E293B]"
                  style={{ color: '#94A3B8', backgroundColor: '#020617' }}
                >
                  Click <strong>Run Test</strong> to verify this skill in isolation against sample data.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* --- FULL GENERIC PROMPT V6 MODE LAYOUT --- */
        <div className="bg-white border border-[#D1DEFF] rounded-2xl p-6 shadow-sm space-y-6">
          {/* Subheader with prompt metadata, search, and bulk controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-black text-[#10338D] flex items-center gap-2">
                  <FileCode2 className="w-5 h-5 text-[#1C58F6]" />
                  <span>Approved Enterprise Generic Prompts (v6.4 Spec)</span>
                </h2>
                <span 
                  className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#86EFAC]"
                  style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
                >
                  Authoritative Specification
                </span>
                <span 
                  className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-[#93C5FD]"
                  style={{ backgroundColor: '#EFF6FF', color: '#1E40AF' }}
                >
                  6 Prompt Slots Active
                </span>
              </div>
              <p className="text-xs text-[#475569] font-normal max-w-3xl leading-relaxed">
                These 6 prompts govern source table detection, Medallion architecture, CTE transpilation, surrogate keys, dbt-expectations / audit helper validation, and documentation generation.
              </p>
            </div>

            {/* Search and Action Bar */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Filter prompts or keywords..."
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  className="pl-8 pr-3 py-2 text-xs border border-[#CBD5E1] rounded-xl w-56 focus:outline-none focus:border-[#1C58F6] focus:ring-1 focus:ring-[#1C58F6]/20 transition-all font-medium"
                  style={{ color: '#0F172A', backgroundColor: '#FFFFFF' }}
                />
              </div>

              <button
                type="button"
                onClick={toggleExpandAll}
                className="px-3.5 py-2 rounded-xl border border-[#CBD5E1] hover:bg-[#F8FAFC] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                style={{ color: '#1E293B', backgroundColor: '#FFFFFF' }}
              >
                {allExpanded ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5 text-[#1C58F6]" />
                    <span>Collapse All</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5 text-[#1C58F6]" />
                    <span>Expand All</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleValidatePrompts}
                className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Validate Prompts</span>
              </button>
            </div>
          </div>

          {/* Prompt Slots Accordion / Editor List */}
          <div className="space-y-4">
            {filteredPrompts.map((p) => {
              const promptValue = prompts[p.id] !== undefined ? prompts[p.id] : (p.code || '');
              const isExpanded = allExpanded || expandedPromptId === p.id;
              const charCount = promptValue.length;
              const lineCount = promptValue.split('\n').length;
              const wordCount = promptValue.trim() ? promptValue.trim().split(/\s+/).length : 0;
              const badge = PROMPT_LAYER_BADGES[p.id] || { label: 'Layer Config', color: 'bg-slate-100 text-slate-800 border-slate-300' };

              return (
                <div 
                  key={p.id} 
                  className="border rounded-2xl transition-all duration-200 overflow-hidden"
                  style={{
                    backgroundColor: isExpanded ? '#FFFFFF' : '#F8FAFC',
                    borderColor: isExpanded ? '#1C58F6' : '#CBD5E1',
                    boxShadow: isExpanded ? '0 4px 12px rgba(28, 88, 246, 0.08)' : 'none'
                  }}
                >
                  {/* Prompt Card Header */}
                  <div 
                    onClick={() => setExpandedPromptId(expandedPromptId === p.id ? null : p.id)}
                    className="p-4 sm:p-5 flex items-start justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#10338D] text-white shadow-xs">
                          {p.id.toUpperCase()}
                        </span>
                        <h3 className="font-bold text-xs sm:text-sm text-[#10338D]">
                          {p.title}
                        </h3>
                        <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-[#334155] leading-relaxed font-normal">
                        {p.desc}
                      </p>
                      {p.subtitle && (
                        <div className="text-[11px] font-semibold text-[#1C58F6] flex items-center gap-1.5 pt-0.5">
                          <Database className="w-3.5 h-3.5 text-[#1C58F6] shrink-0" />
                          <span>Scope: {p.subtitle}</span>
                        </div>
                      )}
                    </div>

                    {/* Header Controls & Stats */}
                    <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
                      <div 
                        className="hidden sm:flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-[#CBD5E1] font-semibold"
                        style={{ backgroundColor: '#F1F5F9', color: '#1E293B' }}
                      >
                        <span>{lineCount} lines</span>
                        <span className="text-[#94A3B8]">•</span>
                        <span>{wordCount} words</span>
                        <span className="text-[#94A3B8]">•</span>
                        <span>{charCount.toLocaleString()} chars</span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyPrompt(p.id, promptValue);
                        }}
                        title="Copy prompt text to clipboard"
                        className="p-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] transition-colors cursor-pointer shadow-2xs"
                        style={{ color: '#1E293B', backgroundColor: '#FFFFFF' }}
                      >
                        {copiedPromptId === p.id ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetSinglePrompt(p.id);
                        }}
                        title="Reset this prompt to default Generic Prompt v6.4"
                        className="p-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] transition-colors cursor-pointer shadow-2xs"
                        style={{ color: '#1E293B', backgroundColor: '#FFFFFF' }}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>

                      <div className="p-1 text-[#10338D]">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5 text-[#94A3B8]" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Prompt Editor Textarea */}
                  {isExpanded && (
                    <div className="px-4 pb-5 sm:px-5 sm:pb-6 pt-0 space-y-2.5 animate-in fade-in">
                      <div className="flex items-center justify-between text-[11px] px-1 flex-wrap gap-2">
                        <span className="font-bold text-[#10338D] flex items-center gap-1.5">
                          <Code2 className="w-4 h-4 text-[#1C58F6]" />
                          <span>Prompt Directive Template:</span>
                        </span>
                        <div className="flex items-center gap-2.5">
                          <span className="text-[11px] text-[#64748B] font-medium">
                            Authoritative Snowflake dbt conversion rules (Editable)
                          </span>
                          <PromptOptimizerButton
                            promptText={promptValue}
                            onApply={(optimized) => setPrompts({ ...prompts, [p.id]: optimized })}
                            align="right"
                          />
                        </div>
                      </div>

                      {/* Textarea with guaranteed 100% dark, high-contrast readable font */}
                      <div className="relative rounded-xl overflow-hidden border border-[#CBD5E1] shadow-xs focus-within:border-[#1C58F6] focus-within:ring-2 focus-within:ring-[#1C58F6]/25 transition-all">
                        <textarea
                          value={promptValue}
                          onChange={(e) => setPrompts({ ...prompts, [p.id]: e.target.value })}
                          rows={15}
                          placeholder={`Enter custom instructions for ${p.title}...`}
                          className="w-full p-4 text-[13px] font-mono leading-relaxed focus:outline-none resize-y min-h-[280px] selection:bg-blue-200 selection:text-black"
                          style={{
                            color: '#0F172A',
                            backgroundColor: '#FFFFFF',
                            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                            lineHeight: '1.6'
                          }}
                        />
                        <div 
                          className="border-t border-[#E2E8F0] px-4 py-2 flex items-center justify-between text-[11px] font-mono font-medium"
                          style={{ backgroundColor: '#F8FAFC', color: '#334155' }}
                        >
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                            Format: Plaintext / Markdown Directive
                          </span>
                          <span>{lineCount} lines • {wordCount} words • {charCount.toLocaleString()} characters</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {validationResult && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center gap-2.5 shadow-xs animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{validationResult.readyMessage || 'All 6 generic prompt templates validated against dbt Snowflake transformation standards.'}</span>
            </div>
          )}
        </div>
      )}

      {/* BOTTOM STICKY ACTION BAR */}
      <div className="bg-white border border-[#D1DEFF] rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-[#10338D]">Configuration Status</div>
          <div className="text-[11px] text-[#475569] mt-0.5 font-medium">
            {activeMode === 'skills'
              ? `✓ ${enabledCount}/${skills.length} AI Skills active and validated • Ready for target warehouse configuration.`
              : `✓ 6/6 Enterprise Generic Prompts (v6.4) loaded and active • Ready for target warehouse configuration.`}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await handleSaveAll();
              if (onNext) onNext();
            }}
            className="bg-[#10338D] hover:bg-[#1C58F6] text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-md cursor-pointer"
          >
            <span>Proceed to Step 3 (Target Settings)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
