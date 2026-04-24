export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface StepError {
  message: string;
  kind: 'transient' | 'fatal';
  at: string;
}

export interface Step {
  id: string;
  name: string;
  type: string;
  status: StepStatus;
  attempts: number;
  maxAttempts: number;
  input: unknown;
  output?: unknown;
  error?: StepError;
  startedAt?: string;
  completedAt?: string;
}

export interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  cursor: number;
  steps: Step[];
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  failure?: { stepId: string; message: string; kind: 'transient' | 'fatal' };
}

export interface WorkflowBlueprint {
  name: string;
  steps: {
    id: string;
    name: string;
    type: string;
    input?: unknown;
    maxAttempts?: number;
  }[];
}
