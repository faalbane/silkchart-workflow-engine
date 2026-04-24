import type { StepHandler } from '../types';
import { TransientError } from '../errors';
import { delay } from './util';

/**
 * Simulates checking a calendar for availability. Sleeps a little to mimic a
 * network call and occasionally fails with a transient error on the first
 * attempt so the retry path gets exercised in the demo.
 */
export const checkCalendarHandler: StepHandler = async ({ attempt, step }) => {
  const input = (step.input ?? {}) as {
    simulate?: 'ok' | 'transient-once';
    delayMs?: number;
  };
  await delay(input.delayMs ?? 400 + Math.random() * 400);

  if (input.simulate === 'transient-once' && attempt === 1) {
    throw new TransientError('Calendar API timeout');
  }

  const slots = [
    '2026-04-25T10:00:00Z',
    '2026-04-25T14:30:00Z',
    '2026-04-26T09:00:00Z',
  ];
  return {
    availableSlots: slots,
    pickedSlot: slots[0],
  };
};
