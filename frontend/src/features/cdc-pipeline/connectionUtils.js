// Helpers shared by the CDC connection form and dashboard.

export function defaultsFor(connector) {
  const out = { type: connector.type };
  connector.fields.forEach((f) => {
    out[f.key] = f.default ?? '';
  });
  return out;
}

// A connection is complete when every required field is filled — secrets may instead be saved.
export function isComplete(cfg, connector) {
  if (!connector) return false;
  const saved = cfg.savedSecrets || [];
  return connector.fields.every((f) => !f.required || String(cfg[f.key] ?? '').trim() || (f.secret && saved.includes(f.key)));
}
