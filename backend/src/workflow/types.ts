export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type ErrorKind = 'transient' | 'fatal';

export interface StepError {
  message: string;
  kind: ErrorKind;
  at: string;
}

export interface StepState {
  /** Stable id, unique within the workflow. */
  id: string;
  /** Human-readable label for the UI. */
  name: string;
  /** Key into the StepRegistry. */
  type: string;
  status: StepStatus;
  attempts: number;
  maxAttempts: number;
  input: unknown;
  /** Present once status === 'completed'. */
  output?: unknown;
  /** Most recent error, if any. */
  error?: StepError;
  startedAt?: string;
  completedAt?: string;
}

export interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  /** Index into `steps` of the next step to run. */
  cursor: number;
  steps: StepState[];
  /**
   * Outputs from completed steps, keyed by step id. Handlers may read this to
   * chain work across steps without re-running prior steps on resume.
   */
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Set when the workflow transitions to `failed`. */
  failure?: {
    stepId: string;
    message: string;
    kind: ErrorKind;
  };
}

export interface StepBlueprint {
  id: string;
  name: string;
  type: string;
  input?: unknown;
  maxAttempts?: number;
}

export interface WorkflowBlueprint {
  name: string;
  steps: StepBlueprint[];
}

export interface StepHandlerContext {
  /** Outputs from previously completed steps. */
  context: Record<string, unknown>;
  /** Current attempt number, 1-indexed. */
  attempt: number;
  /** Step definition (input, id, etc.). */
  step: Readonly<StepState>;
  /** Workflow metadata (id, name). */
  workflow: { id: string; name: string };
}

export type StepHandler = (ctx: StepHandlerContext) => Promise<unknown>;
