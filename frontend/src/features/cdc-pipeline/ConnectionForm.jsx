import React from 'react';
import { defaultsFor } from './connectionUtils';

// One form for every database, source or target. The fields come from the backend connector
// registry (GET /api/cdc/connectors), so adding a database there adds it here with no UI change.

const INPUT = 'w-full bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:border-[#1C58F6] focus:ring-2 focus:ring-[#1C58F6]/15';

export default function ConnectionForm({ connectors, value, onChange, disabled }) {
  const connector = connectors.find((c) => c.type === value.type);
  const saved = value.savedSecrets || [];

  const changeType = (type) => {
    const next = connectors.find((c) => c.type === type);
    onChange(defaultsFor(next));
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] font-semibold text-[#475569] block mb-1">Database type</span>
        <select className={INPUT} value={value.type} disabled={disabled} onChange={(e) => changeType(e.target.value)}>
          {connectors.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
        </select>
      </label>
      {connector && (
        <div className="grid grid-cols-2 gap-3">
          {connector.fields.map((f) => {
            const hint = f.secret && saved.includes(f.key) ? 'Saved — leave blank to keep it' : f.hint;
            const common = {
              className: INPUT,
              value: value[f.key] ?? '',
              disabled,
              placeholder: f.placeholder || (f.default != null && f.default !== '' ? String(f.default) : ''),
              onChange: (e) => onChange({ ...value, [f.key]: e.target.value }),
            };
            return (
              <label key={f.key} className={`block ${f.type === 'textarea' ? 'col-span-2' : ''}`}>
                <span className="text-[11px] font-semibold text-[#475569] block mb-1">
                  {f.label}{!f.required && <span className="font-normal text-[#94A3B8]"> (optional)</span>}
                </span>
                {f.type === 'textarea' ? (
                  <textarea rows={3} {...common} className={`${INPUT} font-mono text-[11px] resize-none`} />
                ) : (
                  <input type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    autoComplete={f.type === 'password' ? 'new-password' : undefined} {...common} />
                )}
                {hint && <span className="text-[10.5px] text-[#94A3B8] block mt-0.5">{hint}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
