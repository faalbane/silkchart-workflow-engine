import type { Workflow, WorkflowBlueprint } from './types';

const BASE = '/api/workflows';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Request failed (${res.status}): ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  list: () => request<Workflow[]>(BASE),
  get: (id: string) => request<Workflow>(`${BASE}/${id}`),
  create: (body: WorkflowBlueprint) =>
    request<Workflow>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  resume: (id: string) => request<Workflow>(`${BASE}/${id}/resume`, { method: 'POST' }),
  stepTypes: () => request<{ types: string[] }>(`${BASE}/step-types`),
};
