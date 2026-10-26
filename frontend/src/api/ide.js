// In-browser editor for the generated dbt project
import { API_BASE } from './client';

export async function ideListFiles() {
  try {
    const res = await fetch(`${API_BASE}/ide/files`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function ideReadFile(path) {
  try {
    const res = await fetch(`${API_BASE}/ide/file?path=${encodeURIComponent(path)}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function ideWriteFile(path, content) {
  try {
    const res = await fetch(`${API_BASE}/ide/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content })
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Could not save file to disk.' };
  }
}

export async function ideDeleteFile(path) {
  try {
    const res = await fetch(`${API_BASE}/ide/file`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    return await res.json();
  } catch {
    return { status: 'error' };
  }
}

export async function ideRenameFile(oldPath, newPath) {
  try {
    const res = await fetch(`${API_BASE}/ide/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    return await res.json();
  } catch {
    return { status: 'error' };
  }
}

export async function ideMkdir(path) {
  try {
    const res = await fetch(`${API_BASE}/ide/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    return await res.json();
  } catch {
    return { status: 'error' };
  }
}

export async function ideGetVscodeUri(path) {
  try {
    const res = await fetch(`${API_BASE}/ide/vscode-uri?path=${encodeURIComponent(path)}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function ideRunCommand(command) {
  try {
    const res = await fetch(`${API_BASE}/ide/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    return await res.json();
  } catch {
    return { status: 'error', error: 'Backend not reachable.' };
  }
}
