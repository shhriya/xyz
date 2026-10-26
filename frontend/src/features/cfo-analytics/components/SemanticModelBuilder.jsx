import React, { useEffect, useState } from 'react';
import {
  Layers, Sparkles, Database, RefreshCw, CheckCircle2, AlertTriangle, Plus, Bot,
  ChevronDown, ChevronRight, ChevronLeft, Check, Info, Table2, Ruler, Clock, Link2,
  Trash2, BarChart3, X
} from 'lucide-react';
import {
  generateSemanticModel, approveSemanticModel,
  addSemanticModelViews, addManualSemanticView, updateSemanticView, deleteSemanticView,
  createCortexAgent, listSemanticModels
} from '@/api';
import DataScopePicker from './DataScopePicker';

/* This app remaps Tailwind's slate scale for a white theme, so colors are explicit hex. */
const INK = 'text-[#0F172A]';
const BODY = 'text-[#334155]';
const MUTED = 'text-[#64748B]';
const CARD = 'bg-white border border-[#E2E8F0] rounded-2xl';
const INPUT =
  'text-[12px] text-[#0F172A] bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 ' +
  'focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15 placeholder-[#94A3B8]';
const BTN_PRIMARY =
  'px-4 py-2.5 rounded-xl bg-[#10338D] hover:bg-[#0A225E] disabled:opacity-40 disabled:cursor-not-allowed ' +
  'text-white text-[13px] font-bold flex items-center gap-2 cursor-pointer transition-colors shadow-sm';
const BTN_GHOST =
  'px-4 py-2.5 rounded-xl bg-white border border-[#CBD5E1] hover:border-[#1C58F6] text-[#334155] ' +
  'text-[13px] font-bold flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-40';

const ROLE_STYLES = {
  fact: 'bg-[#1C58F6]/10 text-[#1C58F6] border-[#1C58F6]/30',
  dimension: 'bg-[#10338D]/10 text-[#10338D] border-[#10338D]/25',
  mart: 'bg-[#FF3C00]/10 text-[#FF3C00] border-[#FF3C00]/30'
};

const STATUS_STYLES = {
  created: 'bg-[#ECFDF5] text-[#065F46] border-[#34D399]/40',
  draft: 'bg-[#FFF7ED] text-[#9A3412] border-[#FB923C]/40',
  failed: 'bg-[#FFF1F2] text-[#9F1239] border-[#FDA4AF]'
};

const STEPS = [
  { n: 1, label: 'Select Schema' },
  { n: 2, label: 'Analytics Views' },
  { n: 3, label: 'Create Views' },
  { n: 4, label: 'Cortex Agent' },
  { n: 5, label: 'Dashboard' }
];

function Stepper({ current, isAvailable, onGo }) {
  return (
    <div className={`${CARD} px-5 py-4`}>
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        {STEPS.map((s, i) => {
          const done = current > s.n;
          const active = current === s.n;
          const enabled = isAvailable(s.n);
          return (
            <React.Fragment key={s.n}>
              <button
                onClick={() => enabled && onGo(s.n)}
                disabled={!enabled}
                className={`flex items-center gap-2 shrink-0 rounded-lg px-1.5 py-1 -mx-1 transition-colors ${enabled ? 'cursor-pointer hover:bg-[#F1F5F9]' : 'cursor-not-allowed'
                  }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border ${done ? 'bg-[#10338D] border-[#10338D] text-white'
                  : active ? 'bg-white border-[#1C58F6] text-[#1C58F6] ring-4 ring-[#1C58F6]/15'
                    : 'bg-white border-[#CBD5E1] text-[#94A3B8]'
                  }`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : s.n}
                </span>
                <span className={`text-[12px] whitespace-nowrap ${active ? `font-bold ${INK}` : done ? `font-semibold ${BODY}` : `font-medium ${MUTED}`
                  }`}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 min-w-[16px] ${current > s.n ? 'bg-[#10338D]' : 'bg-[#E2E8F0]'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Callout({ title, detail, tone = 'info' }) {
  const tones = {
    info: 'bg-[#ECEFFF] border-[#1C58F6]/30 text-[#10338D]',
    warn: 'bg-[#FFF7ED] border-[#FB923C]/40 text-[#9A3412]',
    done: 'bg-[#ECFDF5] border-[#34D399]/40 text-[#065F46]',
    error: 'bg-[#FFF1F2] border-[#FDA4AF] text-[#9F1239]'
  };
  const Icon = tone === 'warn' || tone === 'error' ? AlertTriangle : tone === 'done' ? CheckCircle2 : Info;
  return (
    <div className={`flex items-start gap-2.5 border rounded-xl px-4 py-3 ${tones[tone]}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-bold leading-snug">{title}</p>
        {detail && <p className="text-[12px] opacity-90 mt-0.5 leading-relaxed break-words">{detail}</p>}
      </div>
    </div>
  );
}

function StepHeader({ icon: Icon, step, title, detail }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-[#ECEFFF] border border-[#1C58F6]/25 text-[#1C58F6] flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h2 className={`text-[15px] font-bold ${INK}`}>Step {step} · {title}</h2>
        <p className={`text-[12px] ${BODY} mt-0.5 leading-relaxed`}>{detail}</p>
      </div>
    </div>
  );
}

function FieldRow({ field, kind, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 border-b border-[#F1F5F9] last:border-0">
      <input value={field.name} onChange={(e) => onChange({ ...field, name: e.target.value })}
        className={`${INPUT} w-40 font-mono font-semibold`} title="Business name" />
      <span className={`text-[11px] ${MUTED}`}>from</span>
      <input value={field.expr} onChange={(e) => onChange({ ...field, expr: e.target.value })}
        className={`${INPUT} w-40 font-mono`} title="Source column" />
      {kind === 'measure' && (
        <select value={field.default_aggregation}
          onChange={(e) => onChange({ ...field, default_aggregation: e.target.value })}
          className={`${INPUT} font-mono cursor-pointer`}>
          {['sum', 'avg', 'count', 'count_distinct', 'min', 'max'].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
    </div>
  );
}

function SectionLabel({ icon: Icon, children, count }) {
  return (
    <div className="flex items-center gap-1.5 mt-3 mb-1">
      <Icon className="w-3.5 h-3.5 text-[#94A3B8]" />
      <span className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>
        {children} <span className="text-[#CBD5E1]">·</span> {count}
      </span>
    </div>
  );
}

function TableBlock({ table, onChange }) {
  const patch = (kind, idx, next) => {
    const arr = [...table[kind]];
    arr[idx] = next;
    onChange({ ...table, [kind]: arr });
  };
  return (
    <div className="border border-[#E2E8F0] rounded-lg p-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${ROLE_STYLES[table.role]}`}>
          {table.role}
        </span>
        <span className={`text-[12px] font-mono font-bold ${INK}`}>{table.name}</span>
      </div>
      {table.time_dimensions?.length > 0 && (
        <>
          <SectionLabel icon={Clock} count={table.time_dimensions.length}>Time</SectionLabel>
          {table.time_dimensions.map((f, i) => (
            <FieldRow key={i} field={f} kind="time" onChange={(n) => patch('time_dimensions', i, n)} />
          ))}
        </>
      )}
      {table.measures?.length > 0 && (
        <>
          <SectionLabel icon={Ruler} count={table.measures.length}>Measures</SectionLabel>
          {table.measures.map((f, i) => (
            <FieldRow key={i} field={f} kind="measure" onChange={(n) => patch('measures', i, n)} />
          ))}
        </>
      )}
      {table.dimensions?.length > 0 && (
        <>
          <SectionLabel icon={Table2} count={table.dimensions.length}>Dimensions</SectionLabel>
          {table.dimensions.map((f, i) => (
            <FieldRow key={i} field={f} kind="dimension" onChange={(n) => patch('dimensions', i, n)} />
          ))}
        </>
      )}
      {table.relationships?.length > 0 && (
        <>
          <SectionLabel icon={Link2} count={table.relationships.length}>Joins</SectionLabel>
          {table.relationships.map((r, i) => (
            <div key={i} className={`text-[11px] font-mono ${BODY} py-1`}>
              → {r.to_table} on {r.join_column} <span className={MUTED}>({r.cardinality})</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ViewCard({ view, onChange, onSave, onDelete, saving }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-[#F8FAFC]">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer text-left">
          {open ? <ChevronDown className="w-4 h-4 text-[#64748B] shrink-0" />
            : <ChevronRight className="w-4 h-4 text-[#64748B] shrink-0" />}
          <span className={`text-[13px] font-mono font-bold ${INK} truncate`}>{view.view_name}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border shrink-0 ${STATUS_STYLES[view.status] || STATUS_STYLES.draft}`}>
            {view.status}
          </span>
          {view.source === 'manual' && (
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-[#CBD5E1] ${MUTED} shrink-0`}>manual</span>
          )}
          <span className={`text-[11px] ${MUTED} hidden md:inline whitespace-nowrap`}>
            {(view.tables || []).length} tables
          </span>
        </button>
        <button onClick={() => onDelete(view.view_name)}
          className="text-[#94A3B8] hover:text-[#FF3C00] p-1 rounded hover:bg-[#FEF2F2] cursor-pointer shrink-0"
          title="Remove this view">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-white space-y-3">
          <input
            value={view.description || ''}
            onChange={(e) => onChange({ ...view, description: e.target.value })}
            placeholder="What questions does this view answer?"
            className={`${INPUT} w-full`}
          />
          {view.fq_name && (
            <p className={`text-[11px] font-mono ${MUTED}`}>Created as {view.fq_name}</p>
          )}
          {view.error && <Callout tone="error" title="This view failed to create" detail={view.error} />}
          <div className="space-y-2">
            {(view.tables || []).map((t, i) => (
              <TableBlock key={t.name} table={t} onChange={(next) => {
                const tables = [...view.tables];
                tables[i] = next;
                onChange({ ...view, tables });
              }} />
            ))}
          </div>
          <button onClick={() => onSave(view)} disabled={saving} className={`${BTN_GHOST} py-2 text-[12px]`}>
            Save changes to this view
          </button>
        </div>
      )}
    </div>
  );
}

function AddViewForm({ availableTables, onAdd, onCancel, busy }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState([]);

  const toggle = (t) => setSelected((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  return (
    <div className="border border-[#1C58F6]/30 bg-[#ECEFFF]/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className={`text-[13px] font-bold ${INK}`}>Add a view manually</h4>
        <button onClick={onCancel} className="text-[#64748B] hover:text-[#0F172A] cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="SV_MY_VIEW" className={`${INPUT} font-mono min-w-[200px]`} />
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What this view answers" className={`${INPUT} flex-1 min-w-[240px]`} />
      </div>
      <div>
        <p className={`text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-1.5`}>Tables in this view</p>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {availableTables.map((t) => (
            <button key={t} onClick={() => toggle(t)}
              className={`text-[11px] font-mono px-2 py-1 rounded-lg border cursor-pointer transition-colors ${selected.includes(t)
                ? 'bg-[#10338D] text-white border-[#10338D]'
                : `bg-white border-[#CBD5E1] ${BODY} hover:border-[#1C58F6]`
                }`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => onAdd({ name, description, tables: selected })}
        disabled={busy || !name || selected.length === 0} className={`${BTN_PRIMARY} py-2 text-[12px]`}>
        {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Add View
      </button>
    </div>
  );
}

export default function SemanticModelBuilder({
  selectedConnection, activeDatabase, activeSchema,
  onDatabaseChange, onSchemaChange, onModelChanged, onGoToDashboard
}) {
  const [step, setStep] = useState(1);
  const [model, setModel] = useState(null);
  const [existingModels, setExistingModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [agentName, setAgentName] = useState('ANALYTICS_AGENT');
  const [addInstruction, setAddInstruction] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState('');
  const [agentError, setAgentError] = useState('');
  // Explicit object selection. Empty = use everything in the schema (capped server-side).
  const [selectedObjects, setSelectedObjects] = useState([]);

  useEffect(() => {
    async function loadMeta() {
      if (!selectedConnection?.account) return;
      const models = await listSemanticModels(selectedConnection.id || selectedConnection.account);
      setExistingModels(models?.models || []);
    }
    loadMeta();
  }, [selectedConnection]);

  const views = model?.views || [];
  const createdViews = views.filter((v) => v.status === 'created');
  const isActive = model?.status === 'active' && createdViews.length > 0;
  const hasAgent = Boolean(model?.agent?.fq_name);
  const creds = { connectionId: selectedConnection?.id, credentials: selectedConnection };

  const isAvailable = (n) => {
    if (n === 1) return true;
    if (n === 2 || n === 3) return Boolean(model);
    if (n === 4) return isActive;
    // The quick path produces a dashboard without a semantic model or agent.
    if (n === 5) return isActive;
    return false;
  };

  const run = async (fn, onOk) => {
    setBusy(true); setError('');
    const res = await fn();
    if (res?.status === 'success') { setModel(res.model); onOk?.(res); }
    else setError(res?.message || 'Something went wrong.');
    setBusy(false);
    return res;
  };

  const handleGenerate = () => run(
    () => generateSemanticModel({
      ...creds,
      database: activeDatabase,
      schema: activeSchema,
      // Omitted when nothing is picked, so the server keeps its whole-schema default.
      tables: selectedObjects.length ? selectedObjects : undefined
    }),
    () => setStep(2)
  );

  const handleCreateViews = () => run(
    () => approveSemanticModel(model.id, creds),
    () => { onModelChanged?.(); setStep(4); }
  );

  const handleAiAddViews = () => run(
    () => addSemanticModelViews(model.id, { ...creds, instruction: addInstruction || undefined }),
    () => setAddInstruction('')
  );

  const handleManualAdd = ({ name, description, tables }) => run(
    () => addManualSemanticView(model.id, { ...creds, viewName: name, description, tables }),
    () => setShowAddForm(false)
  );

  const handleSaveView = (view) => run(
    () => updateSemanticView(model.id, view.view_name, {
      tables: view.tables, description: view.description
    })
  );

  const handleDeleteView = (viewName) => run(() => deleteSemanticView(model.id, viewName));

  const handleCreateAgent = async () => {
    setBusy(true); setAgentError('');
    const res = await createCortexAgent(model.id, { ...creds, agentName });
    if (res?.status === 'success') { setModel(res.model); onModelChanged?.(); setStep(5); }
    else setAgentError(res?.message || 'Failed to create Cortex agent.');
    setBusy(false);
  };

  const patchView = (idx, next) => {
    const arr = [...model.views];
    arr[idx] = next;
    setModel({ ...model, views: arr });
  };

  /* ------------------------------- panels -------------------------------- */

  const step1 = () => (
    <div className="space-y-5">
      <StepHeader icon={Layers} step={1} title="Choose your data"
        detail="Pick the tables and views to build analytics views from. The AI reads them and decides how to group them." />

      <DataScopePicker
        selectedConnection={selectedConnection}
        activeDatabase={activeDatabase}
        activeSchema={activeSchema}
        onDatabaseChange={onDatabaseChange}
        onSchemaChange={onSchemaChange}
        selectedObjects={selectedObjects}
        onSelectedObjectsChange={setSelectedObjects}
      />

      <button onClick={handleGenerate} disabled={!activeDatabase || !activeSchema || busy} className={BTN_PRIMARY}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        <span>Infer Analytics Views</span>
      </button>

      {existingModels.length > 0 && (
        <div className="pt-4 border-t border-[#F1F5F9]">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-2`}>Previously generated</p>
          <div className="flex flex-wrap gap-2">
            {existingModels.map((m) => (
              <button key={m.id} onClick={() => { setModel(m); setError(''); setStep(2); }}
                className={`text-[12px] font-mono px-2.5 py-1.5 rounded-lg border bg-white hover:border-[#1C58F6] ${BODY} flex items-center gap-2 cursor-pointer ${model?.id === m.id ? 'border-[#1C58F6] ring-2 ring-[#1C58F6]/15' : 'border-[#E2E8F0]'
                  }`}>
                <Database className="w-3.5 h-3.5 text-[#94A3B8]" />
                {m.database}.{m.schema}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_STYLES[m.status === 'active' ? 'created' : 'draft']}`}>
                  {(m.views || []).length} views
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const step2 = () => (
    <div className="space-y-5">
      <StepHeader icon={Table2} step={2} title="Analytics views the AI created"
        detail="Each view is one subject area. Expand to review and edit fields, remove a view, or add your own." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-mono ${MUTED}`}>
            {model.database}.{model.schema} · {views.length} views
          </span>
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} className={`${BTN_GHOST} py-2 text-[12px]`}>
          <Plus className="w-3.5 h-3.5" /> Add View Manually
        </button>
      </div>

      {showAddForm && (
        <AddViewForm availableTables={model.available_tables || []} busy={busy}
          onAdd={handleManualAdd} onCancel={() => setShowAddForm(false)} />
      )}

      <div className="space-y-2">
        {views.map((v, i) => (
          <ViewCard key={v.view_name} view={v} saving={busy}
            onChange={(next) => patchView(i, next)}
            onSave={handleSaveView} onDelete={handleDeleteView} />
        ))}
        {views.length === 0 && <Callout tone="warn" title="No views in this model yet" detail="Add one manually, or regenerate from Step 1." />}
      </div>

      <div className="pt-3 border-t border-[#F1F5F9] flex flex-wrap items-center gap-2">
        <input value={addInstruction} onChange={(e) => setAddInstruction(e.target.value)}
          placeholder="Ask AI for more views, e.g. “add a view for the returns mart”"
          className={`flex-1 min-w-[260px] ${INPUT} py-2`} />
        <button onClick={handleAiAddViews} disabled={busy} className={`${BTN_GHOST} py-2 text-[12px] shrink-0`}>
          <Sparkles className="w-3.5 h-3.5" /> Ask AI for More Views
        </button>
      </div>
    </div>
  );

  const step3 = () => (
    <div className="space-y-5">
      <StepHeader icon={CheckCircle2} step={3} title="Create the views in Snowflake"
        detail="Runs CREATE OR REPLACE VIEW for each view below. Views are created independently, so one failure won't block the rest." />

      <div className="space-y-2">
        {views.map((v) => (
          <div key={v.view_name} className="flex flex-wrap items-center gap-2 border border-[#E2E8F0] rounded-xl px-4 py-3">
            <span className={`text-[12px] font-mono font-bold ${INK}`}>{v.view_name}</span>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${STATUS_STYLES[v.status] || STATUS_STYLES.draft}`}>
              {v.status}
            </span>
            <span className={`text-[11px] ${MUTED}`}>{(v.tables || []).map((t) => t.name).join(', ')}</span>
            {v.fq_name && <span className={`text-[11px] font-mono ${MUTED} ml-auto`}>{v.fq_name}</span>}
          </div>
        ))}
      </div>

      <button onClick={handleCreateViews} disabled={busy || views.length === 0} className={BTN_PRIMARY}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        <span>{isActive ? 'Re-create Views' : 'Approve & Create Views'}</span>
      </button>
    </div>
  );

  const step4 = () => (
    <div className="space-y-5">
      <StepHeader icon={Bot} step={4} title="Create the Cortex Analyst agent"
        detail="Creates the agent with one Analyst tool per analytics view, plus a dedicated role granted exactly those views. The chat then answers only through this agent." />

      <div>
        <p className={`text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-1.5`}>Views granted to the agent</p>
        <div className="flex flex-wrap gap-2">
          {createdViews.map((v) => (
            <span key={v.view_name} className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border border-[#34D399]/40 bg-[#ECFDF5] text-[#065F46]`}>
              {v.view_name}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>Agent name</label>
          <input value={agentName} onChange={(e) => setAgentName(e.target.value.toUpperCase())}
            className={`block mt-1 ${INPUT} font-mono py-2 min-w-[260px]`} />
        </div>
        <button onClick={handleCreateAgent} disabled={busy || !agentName} className={BTN_PRIMARY}>
          {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
          <span>Create Agent</span>
        </button>
      </div>

      {agentError && <Callout tone="error" title="Could not create the agent" detail={agentError} />}

      {hasAgent && !agentError && (
        <>
          <Callout tone="done" title="Agent created — the Analyst Agent chat now answers only through this"
            detail="No fallback SQL path is used while an agent is configured." />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Agent', value: model.agent.fq_name },
              { label: 'Role', value: model.agent.role },
              { label: 'Views granted', value: `${(model.agent.views || []).length} analytics views` }
            ].map((x) => (
              <div key={x.label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3 min-w-0">
                <p className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>{x.label}</p>
                <p className={`text-[12px] font-mono font-semibold ${INK} mt-0.5 break-all`}>{x.value || '—'}</p>
              </div>
            ))}
          </div>
          {model.agent.role_provision?.failed_count > 0 && (
            <Callout tone="warn"
              title={`${model.agent.role_provision.failed_count} grant statement(s) were refused`}
              detail={model.agent.role_provision.statements.filter((s) => s.status === 'failed')
                .map((s) => `${s.step}: ${s.error}`).join(' · ')} />
          )}
        </>
      )}
    </div>
  );

  const step5 = () => (
    <div className="space-y-5">
      <StepHeader icon={BarChart3} step={5} title="Your dashboard is ready"
        detail="KPIs are generated from these same analytics views, so the dashboard and the chat always agree. It is saved, so it will be here next time you open this project." />
      {hasAgent && <Callout tone="done" title="Cortex agent is live" detail={model.agent.fq_name} />}
      <button onClick={onGoToDashboard} className={BTN_PRIMARY}>
        <BarChart3 className="w-4 h-4" /> <span>Open Dashboard</span>
      </button>
    </div>
  );

  const panels = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 };
  const canBack = step > 1 && isAvailable(step - 1);
  const canNext = step < 5 && isAvailable(step + 1);

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <Stepper current={step} isAvailable={isAvailable} onGo={setStep} />
      <div className={`${CARD} p-6`}>
        {step > 1 && !model
          ? <Callout tone="info" title="No model loaded" detail="Go back to Step 1 and generate or pick an analytics view first." />
          : panels[step]()}

        {error && <div className="mt-5"><Callout tone="error" title="Something went wrong" detail={error} /></div>}

        <div className="flex items-center justify-between gap-3 mt-6 pt-5 border-t border-[#F1F5F9]">
          <button onClick={() => setStep(step - 1)} disabled={!canBack} className={`${BTN_GHOST} py-2 text-[12px]`}>
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
          <span className={`text-[11px] font-semibold ${MUTED}`}>Step {step} of {STEPS.length}</span>
          <button onClick={() => setStep(step + 1)} disabled={!canNext} className={`${BTN_GHOST} py-2 text-[12px]`}>
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
