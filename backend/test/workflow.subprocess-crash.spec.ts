import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

import { WorkflowStore } from '../src/workflow/workflow.store';
import { StepRegistry } from '../src/workflow/step.registry';
import { WorkflowEngine } from '../src/workflow/workflow.engine';
import type { Workflow } from '../src/workflow/types';

/**
 * Strongest possible proof of the assignment's resume requirement: a real
 * Node subprocess is SIGKILL'd in the middle of step 2, and then a fresh
 * engine process resumes the workflow against the same data directory.
 *
 * This is categorically different from the in-process "abandon the promise"
 * simulation in workflow.resume.spec.ts. Here the OS kills the process with
 * no chance for any teardown code to run.
 */
describe('Resume after real subprocess SIGKILL', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('resumes a workflow after the process that started it is killed -9', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-crash-'));

    // Seed a workflow on disk with two steps: one quick, one that hangs.
    const store = new WorkflowStore(tmpDir);
    await store.init();

    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: uuid(),
      name: 'subprocess-crash',
      status: 'pending',
      cursor: 0,
      context: {},
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 'quick',
          name: 'Quick step',
          type: 'quick',
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          input: null,
        },
        {
          id: 'slow',
          name: 'Slow step',
          type: 'slow',
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          input: null,
        },
      ],
    };
    await store.save(workflow);

    const markerFile = path.join(tmpDir, 'ready.marker');
    const scriptPath = path.resolve(__dirname, 'scripts/crash-engine-script.ts');

    // Spawn the engine in a brand new Node process. We use ts-node's
    // transpile-only register hook so the TS source runs without a build
    // step, and the child is a real OS process with its own PID.
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', scriptPath, tmpDir, workflow.id, markerFile],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (c) => stderrChunks.push(Buffer.from(c)));

    const childExited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }));
      },
    );

    // Wait for the subprocess to write the marker, meaning it has persisted
    // step 1 as completed and is now inside the hanging step 2.
    await waitForFile(markerFile, 10_000);

    // Check the on-disk state from outside the subprocess. This is the
    // state that must survive the kill.
    const beforeKill = await store.load(workflow.id);
    expect(beforeKill).toBeTruthy();
    expect(beforeKill!.steps[0].status).toBe('completed');
    expect(beforeKill!.steps[0].output).toEqual({ done: true });
    expect(beforeKill!.steps[1].status).toBe('running');
    expect(beforeKill!.cursor).toBe(1);

    // Kill the process the hardest way possible. No teardown code runs.
    const killedPid = child.pid!;
    child.kill('SIGKILL');
    const exit = await childExited;

    // On macOS and Linux, a SIGKILL'd child reports signal='SIGKILL' on the
    // exit event. On some CI environments signal comes back null and only
    // the exit code is set (128 + 9 = 137 for SIGKILL). Accept either form
    // so the test stays robust; separately verify the PID is really gone.
    const killedBySignal = exit.signal === 'SIGKILL';
    const killedByCode = exit.code === null ? false : exit.code >= 128;
    if (!killedBySignal && !killedByCode) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      throw new Error(
        `Subprocess did not die from SIGKILL (code=${exit.code} signal=${exit.signal}). stderr:\n${stderr}`,
      );
    }

    // Confirm the PID is actually gone from the OS.
    await expectProcessGone(killedPid);

    // The on-disk state must still be the pre-kill state.
    const afterKill = await store.load(workflow.id);
    expect(afterKill).toEqual(beforeKill);

    // Now resume in a fresh engine with a non-hanging slow handler. This
    // stands in for what happens when the backend is restarted.
    const registry = new StepRegistry();
    registry.register('quick', async () => {
      throw new Error('quick handler must not be re-invoked after resume');
    });
    registry.register('slow', async () => ({ recovered: true }));

    const engine = new WorkflowEngine(store, registry, { retryBaseMs: 1 });
    const resumed = await engine.resumeAll();
    expect(resumed).toContain(workflow.id);
    await engine.drain();

    const final = await store.load(workflow.id);
    expect(final!.status).toBe('completed');
    expect(final!.cursor).toBe(2);
    expect(final!.steps[0].status).toBe('completed');
    expect(final!.steps[0].output).toEqual({ done: true });
    expect(final!.steps[1].status).toBe('completed');
    expect(final!.steps[1].output).toEqual({ recovered: true });
  }, 30_000);
});

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.access(file);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  throw new Error(`Marker file ${file} did not appear within ${timeoutMs}ms`);
}

async function expectProcessGone(pid: number): Promise<void> {
  // `kill -0` on a non-existent PID throws ESRCH. If it succeeds the process
  // is still there. Poll briefly because the kernel does not always reap
  // immediately after SIGKILL returns to the parent.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 20));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw err;
    }
  }
  throw new Error(`Process ${pid} is still alive after SIGKILL`);
}
