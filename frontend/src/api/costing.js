// FinOps costing: Snowflake, dbt Cloud and managed Airflow
import { API_BASE } from './client';

export async function fetchSnowflakeCostingSummary(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchSnowflakeCostingSummary failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function testSnowflakeCostingConnection(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// Level 0 / Level 1 costing tabs — each lazily fetched per-tab instead of one giant /summary call.
export async function fetchSnowflakeOverview(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchSnowflakeOverview failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function fetchSnowflakePlatform(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/platform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchSnowflakePlatform failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function fetchSnowflakeCortexAI(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchSnowflakeCortexAI failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function fetchSnowflakeFilters(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchSnowflakeFilters failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function fetchCortexRequestDetail(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex/request-detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function fetchCortexRequestList(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex/request-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function fetchCortexRequests(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message || 'Failed to fetch Cortex requests.' };
  }
}

export async function fetchCortexSingleRequest(queryId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex/requests/${encodeURIComponent(queryId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message || 'Failed to fetch request detail.' };
  }
}

export async function fetchCortexUsersSummary(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/cfo/costing/cortex/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message || 'Failed to fetch Cortex users summary.' };
  }
}

export async function fetchDbtCostingSummary(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/dbt/costing/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchDbtCostingSummary failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function fetchDbtBuildUsage(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/dbt/costing/build-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchDbtBuildUsage failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function testDbtCostingConnection(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/dbt/costing/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function fetchAirflowCostingProviders() {
  try {
    const res = await fetch(`${API_BASE}/airflow/costing/providers`);
    return await res.json();
  } catch (err) {
    return { status: 'error', providers: [], message: err.message };
  }
}

export async function fetchAirflowCostingSummary(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/airflow/costing/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('fetchAirflowCostingSummary failed:', err);
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function testAirflowCostingConnection(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/airflow/costing/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
