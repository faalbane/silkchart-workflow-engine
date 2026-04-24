import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import type { WorkflowBlueprint } from './types';

@Controller('workflows')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('step-types')
  stepTypes() {
    return { types: this.service.availableStepTypes() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: WorkflowBlueprint) {
    return this.service.create(body);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.service.resume(id);
  }
}
