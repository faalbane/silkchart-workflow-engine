import type { StepHandler } from '../types';
import { TransientError, FatalError } from '../errors';
import { delay } from './util';

/**
 * Useful for demos and tests: fails `failTimes` times with a transient error
 * before succeeding, or fails with a fatal error if `mode === 'fatal'`.
 */
export const flakyHandler: StepHandler = async ({ attempt, step }) => {
  await delay(150 + Math.random() * 250);

  const input = (step.input ?? {}) as {
    mode?: 'transient' | 'fatal' | 'ok';
    failTimes?: number;
  };
  const mode = input.mode ?? 'ok';

  if (mode === 'fatal') {
    throw new FatalError('Simulated fatal failure');
  }
  if (mode === 'transient' && attempt <= (input.failTimes ?? 1)) {
    throw new TransientError(`Simulated transient failure on attempt ${attempt}`);
  }

  return { ok: true, attempt };
};
