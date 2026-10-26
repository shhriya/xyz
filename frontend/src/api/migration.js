// Steps 3-5: target connection, migration config, preview and run
import { API_BASE } from './client';

export async function fetchMigrationConfig() {
  try {
    const res = await fetch(`${API_BASE}/migration/config`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchMigrationPreview(payload) {
  try {
    const res = await fetch(`${API_BASE}/migration/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      cache: 'no-store'
    });
    return await res.json();
  } catch {
    return null;
  }
}

export async function connectTargetApi(selectedTarget, details) {
  try {
    const res = await fetch(`${API_BASE}/target/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedTarget, details })
    });
    return await res.json();
  } catch {
    return {
      status: 'error',
      connected: false,
      message: `Failed to communicate with backend for ${selectedTarget} connection test.`
    };
  }
}

export async function saveMigrationConfig(config) {
  try {
    const res = await fetch(`${API_BASE}/migration/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return await res.json();
  } catch {
    return { status: 'success', config };
  }
}

export async function triggerMigrationRun(payload = {}) {
  try {
    const res = await fetch(`${API_BASE}/migration/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'error', error: data.detail || res.statusText };
    }
    return data;
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function fetchMigrationStatus() {
  try {
    const res = await fetch(`${API_BASE}/migration/status`);
    return await res.json();
  } catch {
    return null;
  }
}
