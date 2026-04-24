import { Injectable } from '@nestjs/common';
import type { StepHandler } from './types';

/**
 * Holds the set of step handlers that workflows can reference by `type`. We
 * look up handlers dynamically so the engine can be tested without spinning
 * up the full Nest application.
 */
@Injectable()
export class StepRegistry {
  private readonly handlers = new Map<string, StepHandler>();

  register(type: string, handler: StepHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Step handler already registered for type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  get(type: string): StepHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No step handler registered for type: ${type}`);
    }
    return handler;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  list(): string[] {
    return [...this.handlers.keys()];
  }
}
