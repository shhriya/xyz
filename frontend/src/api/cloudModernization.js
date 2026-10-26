// Data Modernization workspace (prompt-driven dbt generation)
import { API_BASE } from './client';

export async function testCloudModConnection(payload) {
  try {
    const res = await fetch(`${API_BASE}/migration/test_connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Connection failed');
    }
    return await res.json();
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

export async function generateDbtFromPrompt(payload) {
  try {
    const res = await fetch(`${API_BASE}/migration/prompt-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || 'Failed to generate dbt models from prompt.' };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function optimizePrompt(promptText) {
  try {
    const res = await fetch(`${API_BASE}/migration/optimize-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || 'Failed to optimize prompt.' };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function importDbtFromGit(payload) {
  try {
    const res = await fetch(`${API_BASE}/migration/import/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || 'Failed to import dbt project from git.' };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function importDbtFromLocalFolder(fileList) {
  try {
    const formData = new FormData();
    for (const file of fileList) {
      formData.append('files', file);
      formData.append('paths', file.webkitRelativePath || file.name);
    }
    const res = await fetch(`${API_BASE}/migration/import/local`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || 'Failed to import dbt project from local folder.' };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export async function cloudModExportToGit(repo, token, branch, commitMsg) {
  try {
    const res = await fetch(`${API_BASE}/migration/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo, token, branch: branch || 'main', commitMsg: commitMsg || 'Export dbt project from Data Modernization' }),
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function cloudModGetVscodeUri(path = '') {
  try {
    const res = await fetch(`${API_BASE}/migration/vscode-uri?path=${encodeURIComponent(path)}`);
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function cloudModSaveFile(path, content) {
  try {
    const res = await fetch(`${API_BASE}/migration/save-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function cloudModSyncProject(files) {
  try {
    const res = await fetch(`${API_BASE}/migration/sync-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function cloudModDeleteFile(path) {
  try {
    const res = await fetch(`${API_BASE}/migration/delete-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// ── Schema-Aware Generation: live Snowflake introspection + file upload ──────

async function _schemaPost(path, payload) {
  try {
    const res = await fetch(`${API_BASE}/migration/schema/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || `Failed to fetch ${path}.` };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}

export function schemaGetDatabases(connection) {
  return _schemaPost('databases', connection);
}

export function schemaGetSchemas(connection, database) {
  return _schemaPost('schemas', { ...connection, database });
}

export function schemaGetTables(connection, database, schemaName) {
  return _schemaPost('tables', { ...connection, database, schema: schemaName });
}

export function schemaGetColumns(connection, database, schemaName, tables) {
  return _schemaPost('columns', { ...connection, database, schema: schemaName, tables });
}

export function schemaUploadFile(fileType, content) {
  return _schemaPost('upload', { fileType, content });
}

// ── Side Chat ─────────────────────────────────────────────────────────────────
// One box for both "add this new requirement" and "this is a bug, fix it" — the backend sees the
// FULL current project and proposes only the files that need to change. Nothing is applied here:
// this only proposes; the caller shows a diff and applies a file only once the user approves it.

export async function sideChatPropose(prompt, files, targetDialect = 'snowflake') {
  try {
    const res = await fetch(`${API_BASE}/migration/side-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, files, targetDialect }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { status: 'error', message: data?.detail || 'Could not process that request.' };
    }
    return data;
  } catch (err) {
    return { status: 'error', message: err.message || 'Network error connecting to backend.' };
  }
}
