import type { StepHandler } from '../types';
import { FatalError } from '../errors';
import { delay } from './util';

/**
 * Simulates writing an interview summary to a CRM. Reads the calendar slot
 * chosen by the upstream step (demonstrating that context flows between
 * steps without being re-derived on resume).
 */
export const updateCrmHandler: StepHandler = async ({ context, step }) => {
  const input = (step.input ?? {}) as {
    candidateId?: string;
    simulate?: 'ok' | 'fatal';
    delayMs?: number;
  };
  await delay(input.delayMs ?? 500 + Math.random() * 500);
  if (!input.candidateId) {
    throw new FatalError('candidateId is required');
  }
  if (input.simulate === 'fatal') {
    throw new FatalError('CRM rejected the update (422)');
  }

  const calendarOutput = context['check-calendar'] as
    | { pickedSlot?: string }
    | undefined;

  return {
    crmRecordId: `crm_${input.candidateId}_${Date.now()}`,
    scheduledFor: calendarOutput?.pickedSlot ?? null,
  };
};
