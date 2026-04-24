/**
 * Entry point for the subprocess crash test. Parents spawn this script, wait
 * for the marker file to appear (which means step 1 has completed on disk),
 * then SIGKILL the child. The engine is then resumed in-process by the test,
 * proving that resume works against actual process death.
 *
 * argv: [data-dir, workflow-id, marker-file]
 */
import { promises as fs } from 'fs';
import { WorkflowStore } from '../../src/workflow/workflow.store';
import { StepRegistry } from '../../src/workflow/step.registry';
import { WorkflowEngine } from '../../src/workflow/workflow.engine';

async function main() {
  const [, , dir, workflowId, markerFile] = process.argv;
  if (!dir || !workflowId || !markerFile) {
    throw new Error('usage: crash-engine-script <dir> <workflow-id> <marker>');
  }

  const store = new WorkflowStore(dir);
  await store.init();

  const registry = new StepRegistry();
  registry.register('quick', async () => ({ done: true }));
  // Step 2 hangs until the parent sends SIGKILL. A long setTimeout keeps
  // Node's event loop alive; a bare unresolved Promise would let the loop
  // drain to empty and the process would exit cleanly before we could kill
  // it.
  registry.register('slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
  });

  const engine = new WorkflowEngine(store, registry, { retryBaseMs: 1 });

  // Poll the store until step 1 has persisted as completed, then drop the
  // marker. This is how the parent knows the subprocess is in the exact
  // state we want to crash from.
  const poll = setInterval(async () => {
    try {
      const w = await store.load(workflowId);
      if (w?.steps[0].status === 'completed' && w.steps[1].status === 'running') {
        await fs.writeFile(markerFile, 'ready');
        clearInterval(poll);
      }
    } catch {
      /* ignore until the file exists */
    }
  }, 20);

  // Start the workflow. This never resolves because step 2 hangs; the parent
  // will SIGKILL us shortly.
  await engine.start(workflowId);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
