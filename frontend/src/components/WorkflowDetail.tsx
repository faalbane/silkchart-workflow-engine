import { useState } from 'react';
import { api } from '../api';
import { usePolling } from '../hooks/usePolling';
import type { Workflow } from '../types';
import { StatusBadge } from './StatusBadge';
import { StepRow } from './StepRow';

export function WorkflowDetail({ id }: { id: string }) {
  const { data, error, loading, refetch, polling } = usePolling<Workflow>(
    () => api.get(id),
    1000,
    [id],
    {
      stopWhen: (w) => w.status === 'completed' || w.status === 'failed',
    },
  );
  const [resuming, setResuming] = useState(false);

  if (loading && !data) return <div className="padded">Loading workflow...</div>;
  if (error) return <div className="padded error">{error}</div>;
  if (!data) return null;

  const done = data.steps.filter((s) => s.status === 'completed').length;
  const duration = computeDuration(data);

  const handleResume = async () => {
    setResuming(true);
    try {
      await api.resume(id);
      refetch();
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="workflow-detail">
      <div className="workflow-detail-header">
        <div>
          <h2>{data.name}</h2>
          <div className="muted small">
            id: {data.id}
            {duration && <> · ran {duration}</>}
          </div>
        </div>
        <div className="workflow-detail-actions">
          <span className={`live-dot ${polling ? 'live' : 'stopped'}`} title={polling ? 'Polling' : 'Stopped polling (terminal)'} />
          <StatusBadge status={data.status} />
          {data.status === 'failed' && (
            <button className="btn btn-primary" onClick={handleResume} disabled={resuming}>
              {resuming ? 'Resuming...' : 'Retry failed step'}
            </button>
          )}
        </div>
      </div>

      <div className="progress">
        <div
          className="progress-bar"
          style={{ width: `${(done / data.steps.length) * 100}%` }}
        />
      </div>
      <div className="progress-label">
        {done} of {data.steps.length} completed
      </div>

      {data.failure && (
        <div className="fail-banner">
          <strong>Workflow failed</strong> at step <code>{data.failure.stepId}</code>:{' '}
          {data.failure.message} <span className="kind-tag">{data.failure.kind}</span>
        </div>
      )}

      <ul className="step-list">
        {data.steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            index={i}
            defaultOpen={s.status === 'running' || s.status === 'failed'}
          />
        ))}
      </ul>
    </div>
  );
}

function computeDuration(w: Workflow): string | null {
  const first = w.steps.find((s) => s.startedAt)?.startedAt;
  if (!first) return null;
  const end =
    w.status === 'completed' || w.status === 'failed'
      ? w.updatedAt
      : new Date().toISOString();
  const ms = new Date(end).getTime() - new Date(first).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
