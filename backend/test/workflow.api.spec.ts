import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { WorkflowModule } from '../src/workflow/workflow.module';
import { WorkflowEngine } from '../src/workflow/workflow.engine';

/**
 * End-to-end test of the HTTP layer. Boots the full Nest module against a
 * temporary data directory, hits the API, and waits for the workflow to
 * finish through the engine. Catches wiring regressions that the engine-only
 * tests would miss (controller routes, module init, handler registration).
 */
describe('Workflow HTTP API', () => {
  let app: INestApplication;
  let tmpDir: string;
  let engine: WorkflowEngine;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-api-'));
    process.env.WORKFLOW_DATA_DIR = tmpDir;

    const moduleRef = await Test.createTestingModule({
      imports: [WorkflowModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    engine = app.get(WorkflowEngine);
  });

  afterAll(async () => {
    await engine.drain();
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.WORKFLOW_DATA_DIR;
  });

  it('lists registered step types', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workflows/step-types')
      .expect(200);

    expect(res.body.types).toEqual(
      expect.arrayContaining(['check-calendar', 'update-crm', 'send-followup', 'flaky']),
    );
  });

  it('rejects malformed blueprints', async () => {
    await request(app.getHttpServer())
      .post('/api/workflows')
      .send({ name: '', steps: [] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/workflows')
      .send({ name: 'x', steps: [{ id: 'a', name: 'A', type: 'does-not-exist' }] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/workflows')
      .send({
        name: 'dup',
        steps: [
          { id: 'a', name: 'A', type: 'flaky' },
          { id: 'a', name: 'A2', type: 'flaky' },
        ],
      })
      .expect(400);
  });

  it('runs a workflow end to end through the API', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/workflows')
      .send({
        name: 'API smoke',
        steps: [
          {
            id: 'happy',
            name: 'Happy step',
            type: 'flaky',
            input: { mode: 'ok' },
            maxAttempts: 1,
          },
        ],
      })
      .expect(201);

    const id = create.body.id;
    expect(id).toBeTruthy();

    await engine.drain();

    const res = await request(app.getHttpServer())
      .get(`/api/workflows/${id}`)
      .expect(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.steps[0].status).toBe('completed');

    const list = await request(app.getHttpServer())
      .get('/api/workflows')
      .expect(200);
    expect(list.body.find((w: { id: string }) => w.id === id)).toBeTruthy();
  });

  it('stops on fatal failure and resumes when asked', async () => {
    // Start a fatal workflow.
    const create = await request(app.getHttpServer())
      .post('/api/workflows')
      .send({
        name: 'API fatal',
        steps: [
          {
            id: 'bad',
            name: 'Bad step',
            type: 'flaky',
            input: { mode: 'fatal' },
            maxAttempts: 2,
          },
        ],
      })
      .expect(201);

    const id = create.body.id;
    await engine.drain();

    const failed = await request(app.getHttpServer())
      .get(`/api/workflows/${id}`)
      .expect(200);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.failure?.kind).toBe('fatal');

    // The resume endpoint kicks the engine again. The handler is still
    // configured to throw fatal, so the workflow fails again, but the resume
    // call itself must succeed.
    const resumed = await request(app.getHttpServer())
      .post(`/api/workflows/${id}/resume`)
      .expect(201);
    expect(resumed.body.status).toMatch(/pending|running|failed/);

    await engine.drain();
  });
});
