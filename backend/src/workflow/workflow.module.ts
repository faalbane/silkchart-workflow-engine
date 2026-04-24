import * as path from 'path';
import { Module, OnApplicationBootstrap, OnModuleInit, Logger } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEngine } from './workflow.engine';
import { WorkflowStore } from './workflow.store';
import { StepRegistry } from './step.registry';
import { checkCalendarHandler } from './handlers/check-calendar.handler';
import { updateCrmHandler } from './handlers/update-crm.handler';
import { sendFollowupHandler } from './handlers/send-followup.handler';
import { flakyHandler } from './handlers/flaky.handler';

const DATA_DIR =
  process.env.WORKFLOW_DATA_DIR ??
  path.resolve(__dirname, '..', '..', 'data', 'workflows');

@Module({
  controllers: [WorkflowController],
  providers: [
    {
      provide: WorkflowStore,
      useFactory: () => new WorkflowStore(DATA_DIR),
    },
    StepRegistry,
    {
      provide: WorkflowEngine,
      useFactory: (store: WorkflowStore, registry: StepRegistry) =>
        new WorkflowEngine(store, registry),
      inject: [WorkflowStore, StepRegistry],
    },
    WorkflowService,
  ],
})
export class WorkflowModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(WorkflowModule.name);

  constructor(
    private readonly store: WorkflowStore,
    private readonly registry: StepRegistry,
    private readonly engine: WorkflowEngine,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.store.init();
    this.registry.register('check-calendar', checkCalendarHandler);
    this.registry.register('update-crm', updateCrmHandler);
    this.registry.register('send-followup', sendFollowupHandler);
    this.registry.register('flaky', flakyHandler);
  }

  async onApplicationBootstrap(): Promise<void> {
    const resumed = await this.engine.resumeAll();
    if (resumed.length) {
      this.logger.log(`Resumed ${resumed.length} workflow(s) after boot`);
    }
  }
}
