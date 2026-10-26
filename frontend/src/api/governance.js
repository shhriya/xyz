// AI governance: monitored sources, dashboards, chat, dbt bottlenecks
import { API_BASE, parseJsonResponse } from './client';

export async function fetchMonitoringSourceTypes() {
  try {
    return await parseJsonResponse(await fetch(`${API_BASE}/monitoring/source-types`));
  } catch (err) {
    return { status: 'error', source_types: [], message: err.message };
  }
}

export async function fetchMonitoringSources() {
  try {
    return await parseJsonResponse(await fetch(`${API_BASE}/monitoring/sources`));
  } catch (err) {
    return { status: 'error', sources: [], message: err.message };
  }
}

export async function getMonitoringSourceConfig(sourceType) {
  try {
    return await parseJsonResponse(await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceType)}/config`));
  } catch {
    return null;
  }
}

export async function testMonitoringConnection(sourceType, credentials = {}) {
  try {
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceType)}/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials })
    });
    return await parseJsonResponse(res);
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Connect & sync a source. The backend decides Setup (LLM KPI discovery) vs Refresh via the source registry
 * and streams NDJSON progress events: {type: 'step'|'mode'|'log'|'result'|'error'}.
 */
export async function syncMonitoringSource(sourceType, payload = {}, onEvent = () => {}) {
  try {
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceType)}/sync?stream=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok || !res.body) return await parseJsonResponse(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outcome = { status: 'error', message: 'Sync ended without a result.' };
    const handleLine = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'result') outcome = event.result;
      else if (event.type === 'error') outcome = { status: 'error', message: event.detail, detail: event.detail };
      else onEvent(event);
    };
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handleLine);
    }
    handleLine(buffer);
    return outcome;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/** Refresh button: plain data pull for an already set-up source. Never triggers an LLM call. */
export async function refreshMonitoringSource(sourceId) {
  try {
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceId)}/refresh`, { method: 'POST' });
    return await parseJsonResponse(res);
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function fetchMonitoringDashboard(sourceId) {
  try {
    return await parseJsonResponse(await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceId)}/dashboard`));
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function sendMonitoringChatMessage(sourceType, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceType)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(res);
    if (data.status === 'error') return { ...data, reply: `Error contacting AI Copilot: ${data.message}` };
    return data;
  } catch (err) {
    return { status: 'error', reply: `Error contacting AI Copilot: ${err.message}` };
  }
}

/**
 * dbt model build bottleneck detection (Level 2, plain thresholding, no AI call) and on-demand
 * AI query optimization (Level 3, only invoked when the user clicks "Optimize with AI").
 */
export async function fetchDbtBottlenecks(sourceId, thresholds = {}) {
  try {
    const query = new URLSearchParams();
    if (thresholds.absoluteThresholdSec != null) query.append('absoluteThresholdSec', thresholds.absoluteThresholdSec);
    if (thresholds.relativeMultiplier != null) query.append('relativeMultiplier', thresholds.relativeMultiplier);
    if (thresholds.minDurationSec != null) query.append('minDurationSec', thresholds.minDurationSec);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceId)}/bottlenecks${queryString}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.message || `Server returned error (${res.status})`);
      return { status: 'error', message: detail };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Time-filtered drill-down, summary KPIs and regression detection. All read-only, all plain SQL on
 * the backend (no LLM), so they are safe to re-fetch on every period change.
 * `period` is one of '7' | '15' | '30' | 'all'.
 */
async function getMonitoring(path, params = {}) {
  try {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') query.append(k, v);
    });
    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${API_BASE}/monitoring/${path}${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.message || `Server returned error (${res.status})`);
      return { status: 'error', message: detail };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export function fetchMonitoringSummary(sourceId, period = '30') {
  return getMonitoring(`${encodeURIComponent(sourceId)}/summary`, { period });
}

export function fetchMonitoringJobs(sourceId, period = '30') {
  return getMonitoring(`${encodeURIComponent(sourceId)}/jobs`, { period });
}

export function fetchMonitoringJobModels(sourceId, jobId, period = '30') {
  return getMonitoring(`${encodeURIComponent(sourceId)}/jobs/${encodeURIComponent(jobId)}/models`, { period });
}

/** `scope` is 'latest' (the model's most recent run) or 'all' (every run in the period). */
export function fetchMonitoringModelQueries(sourceId, modelName, period = '30', runId = null, scope = 'latest') {
  return getMonitoring(
    `${encodeURIComponent(sourceId)}/models/${encodeURIComponent(modelName)}/queries`,
    { period, runId, scope }
  );
}

export function fetchMonitoringRegressions(sourceId, { period = '30', level = 'model', ...thresholds } = {}) {
  return getMonitoring(`${encodeURIComponent(sourceId)}/regressions`, { period, level, ...thresholds });
}

export async function optimizeDbtBottleneckQuery(sourceId, payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/monitoring/${encodeURIComponent(sourceId)}/optimize-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.message || `Server returned error (${res.status})`);
      return { status: 'error', message: detail };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
