# SilkChart take-home: durable workflow engine

A small NestJS + React app that runs multi-step workflows, persists state after every transition, and picks up where it left off if the process dies. Built to match the interview-agent scenario in the brief: check a calendar, update a CRM, send a follow-up, and have all of that survive a crash.

## What's in the repo

```
backend/   NestJS app. Engine + JSON store + HTTP API.
frontend/  Vite + React dashboard. Polls the API.
```

Both sides are plain TypeScript with no ORM, no Redis, no queue library. The assignment said a JSON file is fine, so the engine itself is the queue.

## Running it

Install once:

```bash
npm install --workspaces --include-workspace-root
```

Two terminals:

```bash
# terminal 1
cd backend && npm run start:dev     # http://localhost:4000/api

# terminal 2
cd frontend && npm run dev          # http://localhost:5173
```

Or build and run the backend in prod mode:

```bash
cd backend && npm run build && npm run start:prod
```

Workflow state lives in `backend/data/workflows/*.json`. Override with `WORKFLOW_DATA_DIR=/some/path`.

## Tests

```bash
cd backend && npm test
```

Eleven specs across three files.

### The one the brief asked for

Two specs cover the "resume after crash" requirement at different levels of realism.

**`workflow.resume.spec.ts` · `resumes after a simulated crash without re-running completed steps`** exercises the engine directly:

1. Boots an engine against a temp JSON store.
2. Runs a four-step workflow where step 3 hangs forever on its first invocation.
3. Waits until step 1 and 2 have persisted as completed and step 3 is mid-flight.
4. Abandons the engine's promise (the simulated crash).
5. Flips the hang off and starts a brand new engine against the same directory.
6. Calls `resumeAll()` and waits for completion.
7. Asserts step 1 and 2 each ran exactly once across both engines, step 3 ran once in the doomed engine and once in the resumed engine, and step 4 ran exactly once.

**`workflow.subprocess-crash.spec.ts` · `resumes a workflow after the process that started it is killed -9`** goes further: it spawns a real Node subprocess running the engine, waits for the subprocess to persist step 1 and enter step 2, then sends `SIGKILL`. No teardown code runs. A fresh in-process engine then resumes against the same data directory and finishes the workflow. The test verifies the PID is really gone from the OS before resuming.

That is the whole claim, demonstrated twice: completed steps are not re-executed, and a step that was running when the process died gets one fresh attempt after resume.

### The other specs

Four more engine specs in `workflow.resume.spec.ts`:

- transient retries stop at `maxAttempts` and mark the workflow failed
- transient retries succeed if a later attempt works
- fatal errors stop the workflow on the first throw and never touch later steps
- context (upstream step output) survives resume, so step N+1 can still read step N's result from disk
- multiple workflows run concurrently without corrupting each other's on-disk state

Four HTTP-level specs in `workflow.api.spec.ts` boot the whole Nest module against a temp directory and exercise the controller routes plus blueprint validation.

### Running a single spec

```bash
cd backend
npx jest workflow.resume            # 6 engine specs
npx jest workflow.subprocess-crash  # the SIGKILL test
npx jest workflow.api               # the HTTP tests
```

## Verification: how this satisfies the assignment

| Assignment requirement | Evidence |
| --- | --- |
| 1. Runs a sequence of async steps | `backend/src/workflow/workflow.engine.ts` walks `workflow.steps` and awaits each handler in order. Four handlers registered at boot (calendar, CRM, follow-up, flaky) in `backend/src/workflow/workflow.module.ts`. The engine is the task-execution system, one runner per workflow. |
| 2. Persists state after each step | `WorkflowStore.save()` writes a temp file, fsyncs, renames. Called by the engine before and after each step transition. Inspect `backend/data/workflows/<id>.json` while a workflow runs. |
| 3. Resumes from the last completed step if interrupted | `WorkflowEngine.resumeAll()` runs at `onApplicationBootstrap`. Proven at two levels: in-process abandonment (`workflow.resume.spec.ts`) and real `SIGKILL` (`workflow.subprocess-crash.spec.ts`). |
| 4. Handles transient (retry) vs fatal (stop and report) | `TransientError` and `FatalError` in `backend/src/workflow/errors.ts`. Engine logic in `executeStep`. Three dedicated specs cover retry success, retry exhaustion, and fatal stop. |
| 5. React UI to see task status | `frontend/` is a Vite + React app. Live polling while workflows run, auto-stops polling on terminal status, per-step input/output/error inspection, retry button on failed workflows. |

Deliverables:

- **Implementation**: `backend/` and `frontend/`.
- **README with data model, rationale, future work**: this file.
- **Test that proves resume after a simulated crash**: the two specs above.

## Data model

One JSON file per workflow, written atomically (temp file, fsync, rename). The shape:

```ts
interface Workflow {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  cursor: number;            // index into steps of the next step to run
  steps: StepState[];
  context: Record<string, unknown>; // outputs keyed by step id
  createdAt: string;
  updatedAt: string;
  failure?: { stepId: string; message: string; kind: 'transient' | 'fatal' };
}

interface StepState {
  id: string;                // stable, unique per workflow
  name: string;
  type: string;              // key into StepRegistry
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  input: unknown;
  output?: unknown;          // set when status === 'completed'
  error?: { message: string; kind: 'transient' | 'fatal'; at: string };
  startedAt?: string;
  completedAt?: string;
}
```

### Why it looks like this

**Steps are an ordered array and `cursor` is the resume pointer.** The disk representation of "where are we" is a single integer. When the engine boots it reads the file, jumps to `steps[cursor]`, and keeps going. Past steps stay on disk with their full state so the UI and downstream steps can still read them.

**Each step carries its own `attempts`, `status`, and `output`.** That is what makes retries and resume safe together. A completed step is never retried because its status is `completed` before the cursor advances. A step that was running when the process died still has `attempts >= 1` on disk, so when the new engine picks it up, the attempt counter does not reset to zero. If the failure cause persists, we will still run out of attempts at the same cap.

**`context` is a separate top-level map keyed by step id.** Downstream steps should not have to walk the steps array to find the output of an earlier step. This also keeps the persisted shape friendly for the UI, which otherwise would need the same lookup.

**Writes are atomic at the file level.** `writeFile -> fsync -> rename` on POSIX gives an all-or-nothing swap. A crash during a save leaves the previous committed state in place. A crash between steps leaves the previous step committed. There is no torn-file case.

**One file per workflow.** Workflows are independent, and the file name is the id. No lock contention between workflows, no single giant file to rewrite on every tick. The directory scan on boot is cheap until you are running thousands concurrently, at which point you want a real store anyway.

### Error taxonomy

Handlers throw one of two things:

- `TransientError` means "try again." The engine retries with exponential backoff capped at `maxAttempts`.
- `FatalError` means "stop now." The engine marks the step failed, the workflow failed, records the error on disk, and does not advance.

Anything else a handler throws is classified as transient by default. That is the conservative choice: if a handler's author has not labelled the failure, the engine does not give up on the first attempt. Handlers that know their failures are unrecoverable should throw `FatalError` explicitly.

A failed workflow can be resumed manually by hitting `POST /api/workflows/:id/resume`. That clears the error on the current step, resets its attempts, flips the workflow back to `pending`, and kicks the engine. The UI exposes this as a button on failed workflows.

## API

```
GET    /api/workflows                list all
GET    /api/workflows/step-types     registered handler keys
GET    /api/workflows/:id            one workflow
POST   /api/workflows                { name, steps: StepBlueprint[] }
POST   /api/workflows/:id/resume     manual resume of a failed workflow
```

## Things I would do with more time

- Move the store behind a `WorkflowStore` interface so the JSON file backend is one implementation and a Postgres or SQLite backend slots in without touching the engine. The engine already does not know where the state lives.
- Replace the polling dashboard with server-sent events or WebSocket pushes. Polling is fine for a demo and easy to get right on resume; SSE is friendlier at scale.
- Add per-step timeouts. Today a hanging handler hangs forever and only a restart unblocks it. A timeout that throws `TransientError` would let retries kick in without human intervention.
- Make `maxAttempts` part of a policy object, not a scalar. Different step types want different backoff shapes (aggressive for network calls, single attempt for anything that has already sent an email).
- Run multiple workflows concurrently, with a global concurrency cap. The engine runs workflows in parallel today but has no bounded pool.
- Add an idempotency key to step inputs so handlers with side effects (the CRM write, the email send) can deduplicate on retries. Right now the contract is "handlers must be safe to retry." That is true for the mocked handlers; for a real CRM it should be enforced at the protocol level.
- Authentication and multi-tenant scoping, which the assignment does not ask for but a production system needs before the first demo.
- A richer UI for building a workflow blueprint rather than the preset picker. The API already accepts arbitrary blueprints.

## A short tour of the code

`backend/src/workflow/workflow.engine.ts` is the only file with meaningful logic. It is roughly 150 lines and does three things:

1. Walks the steps array and saves state before and after each transition.
2. Runs a per-step retry loop that honours `maxAttempts`, uses exponential backoff, and distinguishes transient from fatal errors.
3. On boot, calls `store.list()` and resumes anything that is not terminal.

Everything else is plumbing: the store does atomic writes, the registry maps `type` strings to handler functions, the NestJS module wires them together and registers the four mocked handlers at boot.

The frontend is deliberately thin: one polling hook, one list view, one detail view, one form with a few preset blueprints. It talks to the API over the Vite dev proxy so there is nothing to configure.
