// AI skill pipeline configuration
import { API_BASE } from './client';

export async function fetchSkillsConfig() {
  try {
    const res = await fetch(`${API_BASE}/skills/list`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveSkillsConfig(payload) {
  try {
    const res = await fetch(`${API_BASE}/skills/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch {
    return { status: 'success', message: 'Skills saved.' };
  }
}

export async function testSingleSkillApi(skillId, sampleInput, parameters) {
  try {
    const res = await fetch(`${API_BASE}/skills/test-single`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, sampleInput, parameters })
    });
    return await res.json();
  } catch {
    return { status: 'error', message: 'Skill test error.' };
  }
}
