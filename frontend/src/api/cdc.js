// CDC Pipeline: source DB -> Snowflake with AI-recommended load approaches and checkpoints.
// Stored passwords are never sent back to the browser; sending a blank password together with
// `pipelineId` tells the backend to use the saved one.
import { API_BASE } from './client';

async function _request(path, { method = 'POST', body } = {}) {
  try {
    const res = await fetch(`${API_BASE}/cdc/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) return { status: 'error', message: data?.detail || `Request failed (${res.status}).` };
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export function testCdcSource(source, pipelineId) {
  return _request('source/test', { body: { source, pipelineId } });
}

export function connectCdcSource(source, pipelineId) {
  return _request('source/connect', { body: { source, pipelineId } });
}

export function connectCdcTarget(target, pipelineId) {
  return _request('target/connect', { body: { target, pipelineId } });
}

export function analyzeCdcTables(source, pipelineId, tables = [], target = null) {
  return _request('analyze', { body: { source, pipelineId, tables, target } });
}

export function saveCdcConfig(config) {
  return _request('config', { body: config });
}

export function getCdcConfig(pipelineId) {
  return _request(`config${pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : ''}`, { method: 'GET' });
}

export function runCdcPipeline(pipelineId) {
  return _request('run', { body: { pipelineId } });
}

export function getCdcStatus(pipelineId) {
  return _request(`status?pipelineId=${encodeURIComponent(pipelineId)}`, { method: 'GET' });
}

export function getCdcHistory(pipelineId) {
  return _request(`history?pipelineId=${encodeURIComponent(pipelineId)}`, { method: 'GET' });
}

export function resetCdcCheckpoints(pipelineId, table) {
  return _request('checkpoints/reset', { body: { pipelineId, table } });
}

export function getCdcConnectors() {
  return _request('connectors', { method: 'GET' });
}
