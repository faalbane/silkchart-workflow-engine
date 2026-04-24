import type { StepStatus, WorkflowStatus } from '../types';

type Status = StepStatus | WorkflowStatus;

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}
