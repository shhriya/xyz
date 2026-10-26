// How a saved dashboard is found again when its project is reopened.
//
// This must stay byte-identical to schema_id_for() / _project_tag() in
// backend/app/modules/cfo_analytics/kpi_dashboard_service.py. It previously existed as two separate
// copies in this feature, which is exactly the kind of duplication that drifts apart silently —
// a mismatch here does not error, it just fails to find the dashboard.

/** FNV-1a 32-bit. Chosen because it is trivial to implement identically in Python and JS. */
export function projectTag(connectionId) {
  let h = 2166136261;
  const s = String(connectionId);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Identifies a dashboard and prefixes its Snowflake views.
 *
 * The project is part of the key because two projects may legitimately point at the same
 * database.schema. Keyed on database+schema alone they shared one stored dashboard and one set of
 * V_DASH_KPI_* views, so whichever regenerated last took ownership and dropped the other's.
 */
export function schemaIdFor(database, schema, connectionId = '') {
  const base = `${database}_${schema}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return connectionId ? `${base.slice(0, 71)}_${projectTag(connectionId)}` : base;
}
