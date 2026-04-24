import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { WorkflowStore } from './workflow.store';
import { WorkflowEngine } from './workflow.engine';
import { StepRegistry } from './step.registry';
import type { StepState, Workflow, WorkflowBlueprint } from './types';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly store: WorkflowStore,
    private readonly engine: WorkflowEngine,
    private readonly registry: StepRegistry,
  ) {}

  async create(blueprint: WorkflowBlueprint): Promise<Workflow> {
    if (!blueprint || typeof blueprint !== 'object') {
      throw new BadRequestException('Body must be a workflow blueprint object');
    }
    if (typeof blueprint.name !== 'string' || !blueprint.name.trim()) {
      throw new BadRequestException('Workflow name is required');
    }
    if (!Array.isArray(blueprint.steps) || !blueprint.steps.length) {
      throw new BadRequestException('Workflow must have at least one step');
    }

    const seen = new Set<string>();
    for (const s of blueprint.steps) {
      if (!s || typeof s.id !== 'string' || !s.id) {
        throw new BadRequestException('Each step needs a non-empty id');
      }
      if (typeof s.name !== 'string' || !s.name) {
        throw new BadRequestException(`Step ${s.id} needs a name`);
      }
      if (typeof s.type !== 'string' || !s.type) {
        throw new BadRequestException(`Step ${s.id} needs a type`);
      }
      if (seen.has(s.id)) {
        throw new BadRequestException(`Duplicate step id: ${s.id}`);
      }
      seen.add(s.id);
      if (!this.registry.has(s.type)) {
        throw new BadRequestException(`Unknown step type: ${s.type}`);
      }
      if (s.maxAttempts !== undefined && (!Number.isInteger(s.maxAttempts) || s.maxAttempts < 1)) {
        throw new BadRequestException(`Step ${s.id} maxAttempts must be a positive integer`);
      }
    }

    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: uuid(),
      name: blueprint.name,
      status: 'pending',
      cursor: 0,
      context: {},
      createdAt: now,
      updatedAt: now,
      steps: blueprint.steps.map<StepState>((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: 'pending',
        attempts: 0,
        maxAttempts: s.maxAttempts ?? 3,
        input: s.input ?? null,
      })),
    };

    await this.store.save(workflow);
    this.engine.start(workflow.id);
    return workflow;
  }

  async get(id: string): Promise<Workflow> {
    const w = await this.store.load(id);
    if (!w) throw new NotFoundException(`Workflow ${id} not found`);
    return w;
  }

  async list(): Promise<Workflow[]> {
    return this.store.list();
  }

  /**
   * Manually resume a workflow. Useful when a fatal failure has been fixed
   * externally, or to re-kick a workflow that stopped because its process
   * died before the resumeAll on boot ran. Idempotent: a no-op if already
   * running or terminal.
   */
  async resume(id: string): Promise<Workflow> {
    const w = await this.get(id);
    if (w.status === 'completed') return w;
    if (w.status === 'failed') {
      // Reset the failing step so it can try again.
      const step = w.steps[w.cursor];
      if (step) {
        step.status = 'pending';
        step.attempts = 0;
        step.error = undefined;
      }
      w.status = 'pending';
      w.failure = undefined;
      await this.store.save(w);
    }
    this.engine.start(id);
    return this.get(id);
  }

  availableStepTypes(): string[] {
    return this.registry.list();
  }
}
