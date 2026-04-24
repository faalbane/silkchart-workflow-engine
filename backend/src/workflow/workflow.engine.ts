import { Injectable, Logger } from '@nestjs/common';
import { StepRegistry } from './step.registry';
import { WorkflowStore } from './workflow.store';
import { classifyError, errorMessage } from './errors';
import type { StepState, Workflow } from './types';

export interface EngineOptions {
  /** Base delay for the first retry, in ms. Doubles per attempt. */
  retryBaseMs?: number;
  /** Cap on a single retry sleep. */
  retryMaxMs?: number;
  /** Test hook: sleep impl. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Drives workflows from step to step. The engine is deliberately minimal:
 *   - One runner per workflow, enforced by `running` map.
 *   - State transitions are written to the store before and after each step.
 *   - On boot, any workflow marked `pending` or `running` is picked up again.
 *
 * The engine is the "task queue" in this codebase. Each workflow is a task.
 * Steps inside a workflow run sequentially and the cursor on disk is the only
 * source of truth for what runs next.
 */
@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);
  private readonly running = new Map<string, Promise<void>>();
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly store: WorkflowStore,
    private readonly registry: StepRegistry,
    opts: EngineOptions = {},
  ) {
    this.retryBaseMs = opts.retryBaseMs ?? 200;
    this.retryMaxMs = opts.retryMaxMs ?? 5_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Start running a workflow in the background. Returns the promise for the
   * run so tests can await completion; production code fires and forgets.
   */
  start(id: string): Promise<void> {
    const existing = this.running.get(id);
    if (existing) return existing;

    const p = this.run(id).finally(() => {
      if (this.running.get(id) === p) this.running.delete(id);
    });
    this.running.set(id, p);
    return p;
  }

  /** True if the engine is currently executing this workflow. */
  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Resume any workflow that was mid-flight in the previous process. Called
   * once at application boot. Workflows in `pending` or `running` status are
   * eligible; `completed` and `failed` are terminal.
   */
  async resumeAll(): Promise<string[]> {
    const all = await this.store.list();
    const eligible = all.filter((w) => w.status === 'pending' || w.status === 'running');
    for (const w of eligible) {
      this.logger.log(`Resuming workflow ${w.id} (${w.name}) at step ${w.cursor}`);
      this.start(w.id);
    }
    return eligible.map((w) => w.id);
  }

  /** Wait for all in-flight runs to settle. Useful for tests and shutdown. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  private async run(id: string): Promise<void> {
    const workflow = await this.store.load(id);
    if (!workflow) {
      this.logger.warn(`Attempted to run unknown workflow ${id}`);
      return;
    }
    if (workflow.status === 'completed' || workflow.status === 'failed') {
      return;
    }

    if (workflow.status !== 'running') {
      workflow.status = 'running';
      await this.store.save(workflow);
    }

    while (workflow.cursor < workflow.steps.length) {
      const step = workflow.steps[workflow.cursor];

      if (step.status === 'completed') {
        workflow.cursor += 1;
        await this.store.save(workflow);
        continue;
      }

      const finished = await this.executeStep(workflow, step);
      if (!finished) {
        // Fatal failure: the workflow has been marked failed and persisted.
        return;
      }
      workflow.cursor += 1;
      await this.store.save(workflow);
    }

    workflow.status = 'completed';
    await this.store.save(workflow);
    this.logger.log(`Workflow ${workflow.id} completed`);
  }

  /**
   * Run a single step with retry. Returns true if the step finished
   * successfully, false if the workflow should stop (fatal error).
   */
  private async executeStep(workflow: Workflow, step: StepState): Promise<boolean> {
    const handler = this.registry.get(step.type);

    while (step.attempts < step.maxAttempts) {
      step.attempts += 1;
      step.status = 'running';
      if (!step.startedAt) step.startedAt = new Date().toISOString();
      step.error = undefined;
      await this.store.save(workflow);

      try {
        const output = await handler({
          context: workflow.context,
          attempt: step.attempts,
          step,
          workflow: { id: workflow.id, name: workflow.name },
        });

        step.status = 'completed';
        step.output = output;
        step.completedAt = new Date().toISOString();
        workflow.context[step.id] = output;
        await this.store.save(workflow);
        return true;
      } catch (err) {
        const kind = classifyError(err);
        step.error = {
          message: errorMessage(err),
          kind,
          at: new Date().toISOString(),
        };

        if (kind === 'fatal' || step.attempts >= step.maxAttempts) {
          step.status = 'failed';
          workflow.status = 'failed';
          workflow.failure = {
            stepId: step.id,
            message: step.error.message,
            kind,
          };
          await this.store.save(workflow);
          this.logger.error(
            `Workflow ${workflow.id} failed at step ${step.id}: ${step.error.message}`,
          );
          return false;
        }

        step.status = 'pending';
        await this.store.save(workflow);

        const backoff = Math.min(
          this.retryMaxMs,
          this.retryBaseMs * 2 ** (step.attempts - 1),
        );
        const errName = err instanceof Error ? err.name : 'Error';
        this.logger.warn(
          `Step ${step.id} attempt ${step.attempts}/${step.maxAttempts} failed ` +
            `(${errName}): ${step.error.message}. Retrying in ${backoff}ms.`,
        );
        await this.sleep(backoff);
      }
    }

    return false;
  }
}
