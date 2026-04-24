import { useState } from 'react';
import { api } from '../api';
import type { WorkflowBlueprint } from '../types';

type Preset = 'happy' | 'retry' | 'fatal' | 'calendar-retry' | 'crash-demo';

const PRESETS: Record<Preset, { label: string; blueprint: () => WorkflowBlueprint }> = {
  happy: {
    label: 'Standard interview flow',
    blueprint: () => ({
      name: 'Post-interview flow',
      steps: [
        { id: 'check-calendar', name: 'Check calendar', type: 'check-calendar' },
        {
          id: 'update-crm',
          name: 'Update CRM',
          type: 'update-crm',
          input: { candidateId: `cand_${Math.random().toString(36).slice(2, 8)}` },
        },
        { id: 'send-followup', name: 'Send follow-up email', type: 'send-followup' },
      ],
    }),
  },
  'calendar-retry': {
    label: 'With a transient calendar hiccup',
    blueprint: () => ({
      name: 'Post-interview flow (transient retry)',
      steps: [
        {
          id: 'check-calendar',
          name: 'Check calendar',
          type: 'check-calendar',
          input: { simulate: 'transient-once' },
        },
        {
          id: 'update-crm',
          name: 'Update CRM',
          type: 'update-crm',
          input: { candidateId: `cand_${Math.random().toString(36).slice(2, 8)}` },
        },
        { id: 'send-followup', name: 'Send follow-up email', type: 'send-followup' },
      ],
    }),
  },
  retry: {
    label: 'Flaky step (retries twice, then passes)',
    blueprint: () => ({
      name: 'Retry demo',
      steps: [
        {
          id: 'flaky',
          name: 'Flaky step',
          type: 'flaky',
          input: { mode: 'transient', failTimes: 2 },
          maxAttempts: 5,
        },
        { id: 'send-followup', name: 'Send follow-up email', type: 'send-followup' },
      ],
    }),
  },
  'crash-demo': {
    label: 'Crash demo (slow steps, Ctrl-C the backend mid-flight)',
    blueprint: () => ({
      name: 'Crash demo',
      steps: [
        {
          id: 'check-calendar',
          name: 'Check calendar',
          type: 'check-calendar',
          input: { delayMs: 3000 },
        },
        {
          id: 'update-crm',
          name: 'Update CRM',
          type: 'update-crm',
          input: { candidateId: `cand_${Math.random().toString(36).slice(2, 8)}`, delayMs: 8000 },
        },
        {
          id: 'send-followup',
          name: 'Send follow-up email',
          type: 'send-followup',
          input: { delayMs: 3000 },
        },
      ],
    }),
  },
  fatal: {
    label: 'Fatal failure (stops and reports)',
    blueprint: () => ({
      name: 'Fatal demo',
      steps: [
        { id: 'check-calendar', name: 'Check calendar', type: 'check-calendar' },
        {
          id: 'update-crm',
          name: 'Update CRM',
          type: 'update-crm',
          input: { candidateId: 'cand_fatal', simulate: 'fatal' },
        },
        { id: 'send-followup', name: 'Send follow-up email', type: 'send-followup' },
      ],
    }),
  },
};

export function StartWorkflowForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [preset, setPreset] = useState<Preset>('happy');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const wf = await api.create(PRESETS[preset].blueprint());
      onCreated(wf.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="start-form">
      <h3>Start a workflow</h3>
      <label className="field">
        <span>Preset</span>
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          {(Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]).map(
            ([key, def]) => (
              <option key={key} value={key}>
                {def.label}
              </option>
            ),
          )}
        </select>
      </label>
      <button className="btn btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? 'Starting...' : 'Start'}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
