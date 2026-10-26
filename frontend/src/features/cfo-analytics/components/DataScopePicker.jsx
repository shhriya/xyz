import React, { useEffect, useState } from 'react';
import { fetchLiveDatabases, fetchLiveSchemas, fetchLiveTables } from '@/api';

/* Database + schema + tables/views selection. Shared by both setup paths so the two options
   behave identically — picking a handful of objects out of hundreds works the same either way. */

const INK = 'text-[#0F172A]';
const BODY = 'text-[#334155]';
const MUTED = 'text-[#64748B]';
const INPUT =
  'text-[12px] text-[#0F172A] bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 ' +
  'focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15 placeholder-[#94A3B8]';

export default function DataScopePicker({
  selectedConnection, activeDatabase, activeSchema,
  onDatabaseChange, onSchemaChange, selectedObjects, onSelectedObjectsChange,
}) {
  const [databases, setDatabases] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [objects, setObjects] = useState([]);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('ALL');
  const [loadingObjects, setLoadingObjects] = useState(false);

  useEffect(() => {
    async function loadDatabases() {
      if (!selectedConnection?.account) return;
      const res = await fetchLiveDatabases({ ...selectedConnection, scope: 'analytics' });
      setDatabases(res?.databases || []);
    }
    loadDatabases();
  }, [selectedConnection]);

  useEffect(() => {
    async function loadSchemas() {
      if (!selectedConnection?.account || !activeDatabase) { setSchemas([]); return; }
      const res = await fetchLiveSchemas({ ...selectedConnection, scope: 'analytics' }, activeDatabase);
      setSchemas(res?.schemas || []);
    }
    loadSchemas();
  }, [activeDatabase, selectedConnection]);

  // Tables AND views, so a handful can be picked out of hundreds.
  useEffect(() => {
    async function loadObjects() {
      onSelectedObjectsChange([]);
      setSearch('');
      if (!selectedConnection?.account || !activeDatabase || !activeSchema) { setObjects([]); return; }
      setLoadingObjects(true);
      const res = await fetchLiveTables({ ...selectedConnection, scope: 'analytics' }, activeDatabase, activeSchema);
      setObjects(res?.tables || []);
      setLoadingObjects(false);
    }
    loadObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatabase, activeSchema, selectedConnection]);

  const visible = objects.filter((o) =>
    (kind === 'ALL' || o.kind === kind) &&
    (!search || String(o.name).toLowerCase().includes(search.toLowerCase()))
  );

  const toggle = (name) => onSelectedObjectsChange(
    selectedObjects.includes(name) ? selectedObjects.filter((n) => n !== name) : [...selectedObjects, name]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>Database</label>
          <select value={activeDatabase || ''}
            onChange={(e) => { onDatabaseChange(e.target.value); onSchemaChange(''); }}
            className={`block mt-1 ${INPUT} font-mono min-w-[220px] py-2 cursor-pointer`}>
            <option value="">Select database…</option>
            {databases.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className={`text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>Schema</label>
          <select value={activeSchema || ''} onChange={(e) => onSchemaChange(e.target.value)}
            className={`block mt-1 ${INPUT} font-mono min-w-[220px] py-2 cursor-pointer`}>
            <option value="">Select schema…</option>
            {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {activeDatabase && activeSchema && (
        <div className="border border-[#E2E8F0] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className={`text-[12px] font-bold ${INK}`}>Tables &amp; views</p>
              <p className={`text-[11px] ${MUTED}`}>
                {selectedObjects.length > 0
                  ? `${selectedObjects.length} selected`
                  : `Nothing selected — all ${objects.length} will be used`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {['ALL', 'TABLE', 'VIEW'].map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer ${
                    kind === k ? 'bg-[#10338D] text-white' : `bg-white border border-[#CBD5E1] ${BODY}`}`}>
                  {k === 'ALL' ? 'All' : k === 'TABLE' ? 'Tables' : 'Views'}
                </button>
              ))}
            </div>
          </div>

          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables and views..." className={`w-full ${INPUT}`} />

          {loadingObjects ? (
            <p className={`text-[12px] ${MUTED} py-4 text-center`}>Loading tables and views...</p>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto border border-[#F1F5F9] rounded-lg divide-y divide-[#F1F5F9]">
                {visible.map((o) => (
                  <label key={`${o.kind}:${o.name}`}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F8FAFC] cursor-pointer">
                    <input type="checkbox" checked={selectedObjects.includes(o.name)}
                      onChange={() => toggle(o.name)} className="cursor-pointer shrink-0" />
                    <span className={`text-[12px] font-mono ${INK} truncate flex-1`} title={o.name}>{o.name}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                      o.kind === 'VIEW'
                        ? 'bg-[#ECEFFF] text-[#10338D] border-[#1C58F6]/30'
                        : `bg-[#F8FAFC] ${MUTED} border-[#E2E8F0]`}`}>
                      {o.kind === 'VIEW' ? 'view' : 'table'}
                    </span>
                  </label>
                ))}
                {visible.length === 0 && (
                  <p className={`text-[12px] ${MUTED} py-4 text-center`}>No matching tables or views.</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => onSelectedObjectsChange(
                    Array.from(new Set([...selectedObjects, ...visible.map((o) => o.name)])))}
                  disabled={visible.length === 0}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} cursor-pointer disabled:opacity-40`}>
                  Select all shown ({visible.length})
                </button>
                <button onClick={() => onSelectedObjectsChange([])}
                  disabled={selectedObjects.length === 0}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white border border-[#CBD5E1] hover:border-[#1C58F6] ${BODY} cursor-pointer disabled:opacity-40`}>
                  Clear
                </button>
                {objects.length > 40 && selectedObjects.length === 0 && (
                  <span className="text-[11px] text-[#9A3412] bg-[#FFF7ED] border border-[#FB923C]/40 rounded px-2 py-1">
                    This schema has {objects.length} objects. Only the first 40 are used unless you pick specific ones.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
