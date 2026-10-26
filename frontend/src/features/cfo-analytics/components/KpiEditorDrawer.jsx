import React, { useState } from 'react';
import { X, Sparkles, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { proposeKpi, addKpi } from '@/api';
import { KpiPreview } from './ProjectDashboard';

// "Add KPI" / "Change with AI": the user describes what they want in plain words, the AI builds
// the KPI from this project's data, and they see it with real numbers before it's added.
// Nothing is saved until "Add to dashboard" — and the backend re-checks it then anyway.

const EXAMPLES = ['Revenue by month', 'Top 10 products by sales', 'Average order value', 'Orders by status'];
const SECTION_NAMES = { OVERVIEW: 'Overview', TRENDS: 'Trends', BREAKDOWN: 'Breakdown', DETAIL: 'Details' };

export default function KpiEditorDrawer({ schemaId, conn, editing, onClose, onSaved }) {
  const [request, setRequest] = useState('');
  const [stage, setStage] = useState('ask'); // ask | working | preview | saving
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const create = async () => {
    if (!request.trim()) return;
    setStage('working');
    setError('');
    const res = await proposeKpi(schemaId, conn, request, editing?.kpi_name);
    if (res.status === 'success') {
      setPreview({ ...res.kpi, data: res.data });
      setStage('preview');
    } else {
      setError(res.message || "We couldn't create that KPI.");
      setStage('ask');
    }
  };

  const save = async () => {
    setStage('saving');
    const { data: _data, ...kpi } = preview;
    const res = await addKpi(schemaId, conn, kpi);
    if (res.status === 'success') onSaved(res.dashboard);
    else {
      setError(res.message || "We couldn't save that KPI.");
      setStage('preview');
    }
  };

  const busy = stage === 'working' || stage === 'saving';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[#0F172A]/30" onClick={busy ? undefined : onClose} />
      <aside className="relative w-full max-w-xl h-full bg-[#F8FAFC] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <header className="px-6 py-5 bg-white border-b border-[#E2E8F0] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-bold text-[#0F172A]">{editing ? `Change “${editing.label}”` : 'Add a KPI'}</h3>
            <p className="text-[12.5px] text-[#64748B] mt-0.5">
              {editing ? 'Describe how it should change.' : 'Describe what you want to see — the AI builds it from your project’s data.'}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg hover:bg-[#F1F5F9] text-[#64748B] cursor-pointer disabled:opacity-40">
            <X className="w-4.5 h-4.5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="space-y-2">
            <textarea
              rows={3}
              value={request}
              disabled={busy}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); create(); } }}
              placeholder={editing ? 'e.g. Show this by month instead' : 'e.g. Average order value by region for the last 6 months'}
              className="w-full bg-white border border-[#CBD5E1] rounded-xl px-3.5 py-3 text-[13.5px] text-[#0F172A] resize-none focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15"
            />
            {!editing && stage === 'ask' && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => setRequest(ex)}
                    className="text-[11.5px] px-2.5 py-1 rounded-full bg-white border border-[#E2E8F0] text-[#475569] hover:border-[#1C58F6] hover:text-[#1C58F6] cursor-pointer">
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-[#FFFBEB] border border-[#FCD34D]/60 text-[#92400E] text-[12.5px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {stage === 'working' && (
            <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-10 text-center">
              <RefreshCw className="w-6 h-6 text-[#1C58F6] mx-auto animate-spin" />
              <p className="text-[13px] font-semibold text-[#0F172A] mt-3">Creating your KPI…</p>
              <p className="text-[12px] text-[#64748B] mt-1">Finding the right data and checking the numbers.</p>
            </div>
          )}

          {preview && (stage === 'preview' || stage === 'saving') && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Preview · goes in {SECTION_NAMES[preview.section] || preview.section}
              </p>
              <KpiPreview kpi={preview} />
            </div>
          )}
        </div>

        <footer className="px-6 py-4 bg-white border-t border-[#E2E8F0] flex justify-end gap-2">
          {stage === 'preview' || stage === 'saving' ? (
            <>
              <button onClick={() => { setStage('ask'); setPreview(null); }} disabled={busy}
                className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-[#334155] text-[13px] font-semibold hover:border-[#1C58F6] cursor-pointer disabled:opacity-40">
                Try again
              </button>
              <button onClick={save} disabled={busy}
                className="px-4 py-2 rounded-xl bg-[#10338D] hover:bg-[#1C58F6] text-white text-[13px] font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50">
                {stage === 'saving' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editing ? 'Save changes' : 'Add to dashboard'}
              </button>
            </>
          ) : (
            <button onClick={create} disabled={busy || !request.trim()}
              className="px-4 py-2 rounded-xl bg-[#10338D] hover:bg-[#1C58F6] text-white text-[13px] font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50">
              <Sparkles className="w-4 h-4" /> {editing ? 'Update with AI' : 'Create KPI'}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

const FIELD = 'w-full bg-white border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15';

// Title / description / unit / section — and bar <-> donut, the only chart switch that doesn't
// need different data (anything else goes through "Change with AI").
export function KpiDetailsDialog({ kpi, schemaId, conn, onClose, onSave, onSaved }) {
  const [form, setForm] = useState({
    label: kpi.label || '', description: kpi.description || '', unit: kpi.unit || '',
    section: kpi.section || 'OVERVIEW', chart_type: kpi.chart_type,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // "Show SQL": technical users verify the number and can correct the query. The backend
  // re-validates anything saved here, so a bad statement is rejected rather than stored.
  const originalSql = kpi.sql_definition || '';
  const [showSql, setShowSql] = useState(false);
  const [sql, setSql] = useState(originalSql);
  const sqlChanged = sql.trim() !== originalSql.trim();
  const canEditSql = Boolean(schemaId && conn);

  const submit = async () => {
    setSaving(true);
    setError('');

    // A SQL change has to go through add (which re-validates and rebuilds the view);
    // the metadata-only endpoint cannot change the query.
    if (sqlChanged && canEditSql) {
      const { data: _data, ...rest } = kpi;
      const res = await addKpi(schemaId, conn, {
        ...rest, ...form, sql_definition: sql.trim(), manually_edited: true,
      });
      if (res.status === 'success') {
        onSaved?.(res.dashboard);
        onClose();
        return;
      }
      setError(res.message || "That SQL couldn't be saved.");
      setSaving(false);
      return;
    }

    const err = await onSave(form);
    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F172A]/30" onClick={saving ? undefined : onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150">
        <h3 className="text-[16px] font-bold text-[#0F172A]">Edit KPI</h3>
        <label className="block space-y-1">
          <span className="text-[12px] font-semibold text-[#475569]">Title</span>
          <input className={FIELD} value={form.label} onChange={set('label')} />
        </label>
        <label className="block space-y-1">
          <span className="text-[12px] font-semibold text-[#475569]">Description</span>
          <textarea rows={2} className={`${FIELD} resize-none`} value={form.description} onChange={set('description')} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[12px] font-semibold text-[#475569]">Section</span>
            <select className={FIELD} value={form.section} onChange={set('section')}>
              {Object.entries(SECTION_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] font-semibold text-[#475569]">Unit</span>
            <input className={FIELD} value={form.unit} onChange={set('unit')} placeholder="e.g. $, %, days" />
          </label>
        </div>
        {(kpi.chart_type === 'bar' || kpi.chart_type === 'donut') && (
          <label className="block space-y-1">
            <span className="text-[12px] font-semibold text-[#475569]">Chart</span>
            <select className={FIELD} value={form.chart_type} onChange={set('chart_type')}>
              <option value="bar">Bar chart</option>
              <option value="donut">Share of total</option>
            </select>
          </label>
        )}
        {originalSql && (
          <div className="border-t border-[#E2E8F0] pt-3">
            <button
              type="button"
              onClick={() => setShowSql((v) => !v)}
              className="text-[12px] font-semibold text-[#10338D] hover:text-[#1C58F6] cursor-pointer flex items-center gap-1"
            >
              {showSql ? 'Hide SQL' : 'Show SQL'}
              {kpi.manually_edited && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-[#FB923C]/40 bg-[#FFF7ED] text-[#9A3412]">
                  edited
                </span>
              )}
            </button>

            {showSql && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-[#64748B]">
                  This is the query behind the number. {canEditSql
                    ? 'Edit it to correct the figure — it is checked against your data before saving.'
                    : 'Read-only here.'}
                </p>
                <textarea
                  rows={8}
                  value={sql}
                  readOnly={!canEditSql}
                  onChange={(e) => setSql(e.target.value)}
                  spellCheck={false}
                  className={`w-full text-[11px] font-mono leading-relaxed rounded-lg border px-2.5 py-2 ${
                    canEditSql
                      ? 'bg-white border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:border-[#1C58F6]'
                      : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#334155]'}`}
                />
                {sqlChanged && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-[#9A3412] bg-[#FFF7ED] border border-[#FB923C]/40 rounded px-2 py-1">
                      SQL changed — saving replaces the query behind this KPI.
                    </span>
                    <button type="button" onClick={() => setSql(originalSql)}
                      className="text-[11px] font-semibold text-[#10338D] hover:underline cursor-pointer">
                      Reset
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-[#9F1239] whitespace-pre-wrap">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-[#334155] text-[13px] font-semibold cursor-pointer disabled:opacity-40">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#10338D] hover:bg-[#1C58F6] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
