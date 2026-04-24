import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

import { WorkflowStore } from '../src/workflow/workflow.store';
import { StepRegistry } from '../src/workflow/step.registry';
import { WorkflowEngine } from '../src/workflow/workflow.engine';
import { TransientError, FatalError } from '../src/workflow/errors';
import type { Workflow, StepBlueprint } from '../src/workflow/types';

/**
 * The assignment's core requirement: a workflow that was interrupted must
 * resume from the last completed step. These tests prove that property by
 * counting how many times each step actually runs.
 */

async function makeStore(): Promise<{ store: WorkflowStore; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-test-'));
  const store = new WorkflowStore(dir);
  await store.init();
  return { store, dir };
}

function seedWorkflow(store: WorkflowStore, steps: StepBlueprint[]): Promise<Workflow> {
  const now = new Date().toISOString();
  const workflow: Workflow = {
    id: uuid(),
    name: 'test-workflow',
    status: 'pending',
    cursor: 0,
    context: {},
    createdAt: now,
    updatedAt: now,
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      status: 'pending',
      attempts: 0,
      maxAttempts: s.maxAttempts ?? 3,
      input: s.input ?? null,
    })),
  };
  return store.save(workflow).then(() => workflow);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 10 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('WorkflowEngine resume semantics', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('resumes after a simulated crash without re-running completed steps', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    // Counters track how many times each step's handler has been invoked
    // across both engines. Completed steps must keep their counter at 1.
    const calls = { s1: 0, s2: 0, s3: 0, s4: 0 };

    // `hang` gates step 3 on the first run. Flipping it off before the second
    // engine starts lets the resumed run actually complete.
    let hang = true;

    const registry = new StepRegistry();
    registry.register('s1', async () => {
      calls.s1 += 1;
      return { did: 's1' };
    });
    registry.register('s2', async () => {
      calls.s2 += 1;
      return { did: 's2' };
    });
    registry.register('s3', async () => {
      calls.s3 += 1;
      if (hang) {
        // Simulate a process that never returns control from the handler.
        // The first engine's promise will be abandoned by this test.
        await new Promise(() => {
          /* deliberately unresolved */
        });
      }
      return { did: 's3' };
    });
    registry.register('s4', async () => {
      calls.s4 += 1;
      return { did: 's4' };
    });

    const workflow = await seedWorkflow(store, [
      { id: 's1', name: 'Step 1', type: 's1' },
      { id: 's2', name: 'Step 2', type: 's2' },
      { id: 's3', name: 'Step 3', type: 's3' },
      { id: 's4', name: 'Step 4', type: 's4' },
    ]);

    // First engine. We do not await the run; we abandon it mid-step.
    const engine1 = new WorkflowEngine(store, registry, { retryBaseMs: 1 });
    void engine1.start(workflow.id);

    // Wait until the engine has entered step 3 (the hanging one).
    await waitFor(() => calls.s3 === 1);

    expect(calls.s1).toBe(1);
    expect(calls.s2).toBe(1);
    expect(calls.s3).toBe(1);
    expect(calls.s4).toBe(0);

    // Verify the on-disk state matches what we expect: s1/s2 completed,
    // s3 running, cursor parked at s3.
    const midFlight = await store.load(workflow.id);
    expect(midFlight).toBeTruthy();
    expect(midFlight!.status).toBe('running');
    expect(midFlight!.cursor).toBe(2);
    expect(midFlight!.steps[0].status).toBe('completed');
    expect(midFlight!.steps[1].status).toBe('completed');
    expect(midFlight!.steps[2].status).toBe('running');
    expect(midFlight!.steps[2].attempts).toBe(1);
    expect(midFlight!.steps[3].status).toBe('pending');

    // "Crash" the first engine: we drop our reference to its run promise.
    // Node holds the unresolved promise forever, but the test proceeds.

    // Second engine starts against the same store with s3 no longer hanging.
    hang = false;
    const engine2 = new WorkflowEngine(store, registry, { retryBaseMs: 1 });
    const resumed = await engine2.resumeAll();
    expect(resumed).toContain(workflow.id);

    await engine2.drain();

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('completed');
    expect(final!.cursor).toBe(4);

    // The proof: completed steps were not re-executed.
    expect(calls.s1).toBe(1);
    expect(calls.s2).toBe(1);
    // Step 3 was mid-flight and was re-attempted once by the resumed engine.
    expect(calls.s3).toBe(2);
    expect(calls.s4).toBe(1);

    for (const step of final!.steps) {
      expect(step.status).toBe('completed');
      expect(step.output).toBeDefined();
    }
  });

  it('retries transient errors with bounded attempts', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    let attempts = 0;
    const registry = new StepRegistry();
    registry.register('flaky', async () => {
      attempts += 1;
      if (attempts < 3) throw new TransientError(`boom ${attempts}`);
      return { ok: true };
    });

    const workflow = await seedWorkflow(store, [
      { id: 'only', name: 'Only step', type: 'flaky', maxAttempts: 5 },
    ]);

    const engine = new WorkflowEngine(store, registry, {
      retryBaseMs: 1,
      sleep: () => Promise.resolve(),
    });
    await engine.start(workflow.id);

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('completed');
    expect(final!.steps[0].status).toBe('completed');
    expect(final!.steps[0].attempts).toBe(3);
    expect(attempts).toBe(3);
  });

  it('stops and reports fatal errors without further attempts', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    let attempts = 0;
    const registry = new StepRegistry();
    registry.register('doomed', async () => {
      attempts += 1;
      throw new FatalError('nope');
    });
    registry.register('unreached', async () => ({ unreached: true }));

    const workflow = await seedWorkflow(store, [
      { id: 'one', name: 'Doomed', type: 'doomed', maxAttempts: 5 },
      { id: 'two', name: 'Never runs', type: 'unreached' },
    ]);

    const engine = new WorkflowEngine(store, registry, {
      retryBaseMs: 1,
      sleep: () => Promise.resolve(),
    });
    await engine.start(workflow.id);

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('failed');
    expect(final!.failure?.kind).toBe('fatal');
    expect(final!.failure?.stepId).toBe('one');
    expect(final!.steps[0].status).toBe('failed');
    expect(final!.steps[0].attempts).toBe(1);
    expect(final!.steps[1].status).toBe('pending');
    expect(attempts).toBe(1);
  });

  it('gives up after maxAttempts transient failures', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    let attempts = 0;
    const registry = new StepRegistry();
    registry.register('always-fails', async () => {
      attempts += 1;
      throw new TransientError('always');
    });

    const workflow = await seedWorkflow(store, [
      { id: 'one', name: 'Always fails', type: 'always-fails', maxAttempts: 3 },
    ]);

    const engine = new WorkflowEngine(store, registry, {
      retryBaseMs: 1,
      sleep: () => Promise.resolve(),
    });
    await engine.start(workflow.id);

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('failed');
    expect(final!.failure?.kind).toBe('transient');
    expect(final!.steps[0].attempts).toBe(3);
    expect(attempts).toBe(3);
  });

  it('runs multiple workflows concurrently without corrupting each other', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    // The handler sleeps a random amount so the workflows interleave on the
    // event loop. If the store had a shared write state, concurrent saves
    // across workflows would stomp each other.
    const registry = new StepRegistry();
    registry.register('step', async ({ step, attempt }) => {
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
      const input = step.input as { wfTag: string; n: number };
      return { wfTag: input.wfTag, n: input.n, attempt };
    });

    const engine = new WorkflowEngine(store, registry, { retryBaseMs: 1 });

    const workflowCount = 8;
    const stepsPerWorkflow = 4;

    const ids = await Promise.all(
      Array.from({ length: workflowCount }).map(async (_, wfIdx) => {
        const steps: StepBlueprint[] = Array.from({ length: stepsPerWorkflow }).map(
          (__, stepIdx) => ({
            id: `s${stepIdx}`,
            name: `Workflow ${wfIdx} step ${stepIdx}`,
            type: 'step',
            input: { wfTag: `wf-${wfIdx}`, n: stepIdx },
          }),
        );
        const w = await seedWorkflow(store, steps);
        return w.id;
      }),
    );

    await Promise.all(ids.map((id) => engine.start(id)));

    for (const id of ids) {
      const final = await store.load(id);
      expect(final!.status).toBe('completed');
      expect(final!.steps).toHaveLength(stepsPerWorkflow);
      for (let i = 0; i < stepsPerWorkflow; i++) {
        expect(final!.steps[i].status).toBe('completed');
        const out = final!.steps[i].output as { n: number };
        expect(out.n).toBe(i);
      }
    }
  });

  it('preserves outputs across resume so downstream steps can chain on them', async () => {
    const { store, dir } = await makeStore();
    tmpDir = dir;

    const registry1 = new StepRegistry();
    registry1.register('produce', async () => ({ value: 42 }));
    registry1.register('hang', async () => {
      await new Promise(() => {
        /* hang forever */
      });
    });

    const workflow = await seedWorkflow(store, [
      { id: 'p', name: 'Produce', type: 'produce' },
      { id: 'h', name: 'Hang', type: 'hang' },
    ]);

    const engine1 = new WorkflowEngine(store, registry1, { retryBaseMs: 1 });
    void engine1.start(workflow.id);

    await waitFor(async () => {
      const w = await store.load(workflow.id);
      return w?.steps[0].status === 'completed';
    });

    const midFlight = await store.load(workflow.id);
    expect(midFlight!.context['p']).toEqual({ value: 42 });

    // Resume with a non-hanging handler that depends on the prior output.
    const registry2 = new StepRegistry();
    registry2.register('produce', async () => {
      throw new Error('should not be called');
    });
    registry2.register('hang', async ({ context }) => {
      const upstream = context['p'] as { value: number };
      return { doubled: upstream.value * 2 };
    });

    const engine2 = new WorkflowEngine(store, registry2, { retryBaseMs: 1 });
    await engine2.resumeAll();
    await engine2.drain();

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('completed');
    expect(final!.steps[1].output).toEqual({ doubled: 84 });
  });
});
