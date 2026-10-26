// CFO analytics: Snowflake connections, dashboards, AI analyst, semantic models, KPI dashboards
import { API_BASE } from './client';

export async function fetchSavedConnections() {
  try {
    const res = await fetch(`${API_BASE}/cfo/connections`);
    return await res.json();
  } catch (err) {
    console.warn('Fetch connections error', err);
    return { status: 'error', connections: [] };
  }
}

export async function saveSnowflakeConnection(details) {
  try {
    const res = await fetch(`${API_BASE}/cfo/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to save connection.' };
  }
}

export async function updateSavedConnectionSchema(details) {
  try {
    const res = await fetch(`${API_BASE}/cfo/connections/update-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to update connection schema.' };
  }
}

export async function deleteSavedConnection(connectionId) {
  try {
    const res = await fetch(`${API_BASE}/cfo/connections/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE'
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to delete connection.' };
  }
}

export async function testSnowflakeConnectionApi(details) {
  try {
    const res = await fetch(`${API_BASE}/cfo/connections/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details)
    });
    return await res.json();
  } catch {
    return { status: 'error', connected: false, message: 'Test connection error.' };
  }
}

export async function fetchCfoDashboard(params = {}) {
  try {
    if (params.credentials && (params.credentials.account || params.credentials.password || params.credentials.authMethod)) {
      const res = await fetch(`${API_BASE}/cfo/dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: params.credentials,
          database: params.database,
          schema: params.schema,
          domain: params.domain
        })
      });
      return await res.json();
    }

    const query = new URLSearchParams();
    if (params.connectionId) query.append('connectionId', params.connectionId);
    if (params.domain) query.append('domain', params.domain);
    if (params.database) query.append('database', params.database);
    if (params.schema) query.append('schema', params.schema);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/cfo/dashboard${queryString}`);
    return await res.json();
  } catch (err) {
    console.warn('CFO Dashboard fetch error', err);
    return null;
  }
}

export async function fetchEnterpriseDashboard(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/enterprise-dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.warn('Enterprise Dashboard fetch error', err);
    return { status: 'error', message: 'Failed to fetch enterprise telemetry' };
  }
}

export async function queryCfoAiAnalyst(question, domain = null, context = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/ai-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, domain, context })
    });
    return await res.json();
  } catch {
    return {
      status: 'error',
      answer: 'Failed to communicate with AI Analyst backend service.'
    };
  }
}

export async function fetchLiveDatabases(credentials = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/snowflake/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    return await res.json();
  } catch {
    return { status: 'error', databases: [] };
  }
}

export async function fetchLiveSchemas(credentials = {}, database = '') {
  try {
    const res = await fetch(`${API_BASE}/cfo/snowflake/schemas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, database })
    });
    return await res.json();
  } catch {
    return { status: 'error', schemas: [] };
  }
}

export async function fetchLiveTables(credentials = {}, database = '', schema = '') {
  try {
    const res = await fetch(`${API_BASE}/cfo/snowflake/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, database, schema })
    });
    return await res.json();
  } catch {
    return { status: 'error', tables: [] };
  }
}

// ---------------------------------------------------------------------------
// Semantic View Generator (Phase A) & Cortex Agent Auto-Creation (Phase B)
// ---------------------------------------------------------------------------

export async function generateSemanticModel(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to generate semantic model.' };
  }
}

export async function getSemanticDraft(modelId) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/draft/${modelId}`);
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to fetch semantic model draft.' };
  }
}

export async function listSemanticModels(connectionId) {
  try {
    const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
    const res = await fetch(`${API_BASE}/cfo/semantic/models${query}`);
    return await res.json();
  } catch {
    return { status: 'error', models: [] };
  }
}

export async function updateSemanticDraft(modelId, patch) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/draft/${modelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to update semantic model draft.' };
  }
}

export async function approveSemanticModel(modelId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/draft/${modelId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to approve/materialize semantic model.' };
  }
}

export async function addSemanticModelViews(modelId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/${modelId}/add-views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to add views to semantic model.' };
  }
}

export async function addManualSemanticView(modelId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/${modelId}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to add view.' };
  }
}

export async function updateSemanticView(modelId, viewName, patch = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/${modelId}/views/${encodeURIComponent(viewName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to update view.' };
  }
}

export async function deleteSemanticView(modelId, viewName) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/${modelId}/views/${encodeURIComponent(viewName)}`, {
      method: 'DELETE'
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to delete view.' };
  }
}

export async function createCortexAgent(modelId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/semantic/${modelId}/create-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to create Cortex agent.' };
  }
}

// ---------------------------------------------------------------------------
// KPI-driven shared dashboard (Phase D)
// ---------------------------------------------------------------------------

export async function generateKpiDashboard(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/dashboard/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to generate KPI dashboard.' };
  }
}

export async function getKpiDashboard(schemaId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/dashboard/kpis/${schemaId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Failed to fetch KPI dashboard.' };
  }
}

// The one-call business-user path: connect -> understand data -> prepare dashboard, all server
// side. Same backend logic as the Advanced wizard's individual steps, just sequenced for you.
export async function quickstartDashboard(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/dashboard/quickstart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Could not connect to prepare your dashboard.' };
  }
}

// ---------------------------------------------------------------------------
// AI Governance multi-source monitoring
// ---------------------------------------------------------------------------

// ── Business-user KPI editing on the shared dashboard ─────────────────────────────────────
// `conn` is the saved connection ({ connectionId, credentials }) — the backend needs it to ask
// the AI and to validate/create the KPI's view in Snowflake.
async function _kpiEdit(schemaId, action, body, method = 'POST') {
  try {
    const res = await fetch(`${API_BASE}/cfo/dashboard/kpis/${schemaId}/${action}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Could not reach the server. Please try again.' };
  }
}

export const proposeKpi = (schemaId, conn, request, kpiName) => _kpiEdit(schemaId, 'propose', { ...conn, request, kpiName });
export const addKpi = (schemaId, conn, kpi) => _kpiEdit(schemaId, 'add', { ...conn, kpi });
export const updateKpi = (schemaId, kpiName, changes) => _kpiEdit(schemaId, 'update', { kpiName, changes });
export const deleteKpi = (schemaId, kpiName) => _kpiEdit(schemaId, 'delete', { kpiName });
export const reorderKpis = (schemaId, order) => _kpiEdit(schemaId, 'reorder', { order });
export const getKpiVersions = (schemaId) => _kpiEdit(schemaId, 'versions', null, 'GET');
export const restoreKpiVersion = (schemaId, conn, index) => _kpiEdit(schemaId, 'restore', { ...conn, index });
