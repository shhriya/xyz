import React, { useState } from 'react';
import { Sparkles, RefreshCw, BarChart3, AlertTriangle, CheckCircle2, ArrowLeft } from 'lucide-react';
import { generateKpiDashboard } from '@/api';
import DataScopePicker from './DataScopePicker';

/* Option 2 — "Create views with AI". No Snowflake semantic view and no Cortex agent: the AI
   reads the chosen tables and writes the dashboard queries directly against them. */

const INK = 'text-[#0F172A]';
const BODY = 'text-[#334155]';
const MUTED = 'text-[#64748B]';
const CARD = 'bg-white border border-[#E2E8F0] rounded-2xl';
const BTN_PRIMARY =
  'px-4 py-2.5 rounded-xl bg-[#10338D] hover:bg-[#0A225E] disabled:opacity-40 disabled:cursor-not-allowed ' +
  'text-white text-[13px] font-bold flex items-center gap-2 cursor-pointer transition-colors shadow-sm';

export default function QuickDashboardSetup({
  selectedConnection, activeDatabase, activeSchema,
  onDatabaseChange, onSchemaChange, onModelChanged, onGoToDashboard, onBack,
}) {
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const build = async () => {
    setBusy(true); setError('');
    const res = await generateKpiDashboard({
      connectionId: selectedConnection?.id,
      credentials: selectedConnection,
      database: activeDatabase,
      schema: activeSchema,
      tables: selectedObjects.length ? selectedObjects : undefined,
      mode: 'direct',
    });
    if (res?.status === 'success') {
      onModelChanged?.();
      setDone(true);
    } else {
      setError(res?.message || "We couldn't build the dashboard.");
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className={`${CARD} p-6 space-y-4`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] border border-[#34D399]/40 text-[#065F46] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className={`text-[15px] font-bold ${INK}`}>Your dashboard is ready</h2>
            <p className={`text-[12px] ${BODY} mt-0.5 leading-relaxed`}>
              Built from the tables you picked in {activeDatabase}.{activeSchema}. It is saved, so it
              will be here next time you open this project. You can edit any KPI — including its SQL —
              from the dashboard itself.
            </p>
          </div>
        </div>
        <button onClick={onGoToDashboard} className={BTN_PRIMARY}>
          <BarChart3 className="w-4 h-4" /> <span>Open Dashboard</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`${CARD} p-6 space-y-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#ECEFFF] border border-[#1C58F6]/25 text-[#1C58F6] flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className={`text-[15px] font-bold ${INK}`}>Create views with AI</h2>
            <p className={`text-[12px] ${BODY} mt-0.5 leading-relaxed`}>
              Choose your data and the AI builds the dashboard directly from it — no Snowflake
              semantic view or agent needed.
            </p>
          </div>
        </div>
        {onBack && (
          <button onClick={onBack}
            className={`text-[11px] font-semibold ${MUTED} hover:text-[#1C58F6] flex items-center gap-1 cursor-pointer shrink-0`}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
      </div>

      <DataScopePicker
        selectedConnection={selectedConnection}
        activeDatabase={activeDatabase}
        activeSchema={activeSchema}
        onDatabaseChange={onDatabaseChange}
        onSchemaChange={onSchemaChange}
        selectedObjects={selectedObjects}
        onSelectedObjectsChange={setSelectedObjects}
      />

      {error && (
        <div className="flex items-start gap-2.5 border rounded-xl px-4 py-3 bg-[#FFF1F2] border-[#FDA4AF] text-[#9F1239]">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[12px] break-words">{error}</p>
        </div>
      )}

      <button onClick={build} disabled={!activeDatabase || !activeSchema || busy} className={BTN_PRIMARY}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
        <span>{busy ? 'Building your dashboard…' : 'Build dashboard'}</span>
      </button>
    </div>
  );
}
