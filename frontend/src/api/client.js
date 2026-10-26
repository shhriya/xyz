// Shared API settings. VITE_API_BASE_URL lets the frontend call a backend on another origin;
// by default requests go to /api, which the Vite dev server proxies to the backend.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : (data?.message || `Server returned error (${res.status})`);
    return { status: 'error', message: detail, detail };
  }
  return data;
}
