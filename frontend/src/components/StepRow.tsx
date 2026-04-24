import { useState } from 'react';
import type { Step } from '../types';
import { StatusBadge } from './StatusBadge';

export function StepRow({
  step,
  index,
  defaultOpen = false,
}: {
  step: Step;
  index: number;
  defaultOpen?: boolean;
}) {
  // Track manual toggles separately from the status-derived default. That way
  // a step that flips from pending to running auto-expands without losing the
  // user's choice if they collapsed it on purpose.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? defaultOpen;

  return (
    <li className={`step step-${step.status}`}>
      <button className="step-head" onClick={() => setOverride(!open)}>
        <span className="step-index">{index + 1}</span>
        <span className="step-name">{step.name}</span>
        <span className="step-type">{step.type}</span>
        <span className="step-attempts">
          {step.attempts}/{step.maxAttempts}
        </span>
        <StatusBadge status={step.status} />
        <span className="step-chevron">{open ? '-' : '+'}</span>
      </button>

      {open && (
        <div className="step-body">
          {step.input !== null && step.input !== undefined && (
            <DetailBlock label="Input" value={step.input} />
          )}
          {step.output !== undefined && (
            <DetailBlock label="Output" value={step.output} />
          )}
          {step.error && (
            <div className="step-error">
              <strong>Error ({step.error.kind}):</strong> {step.error.message}
              <div className="muted">at {step.error.at}</div>
            </div>
          )}
          <div className="muted small">
            {step.startedAt && <>started {step.startedAt}</>}
            {step.completedAt && <> · completed {step.completedAt}</>}
          </div>
        </div>
      )}
    </li>
  );
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="detail-block">
      <div className="detail-label">{label}</div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
