import type { StepHandler } from '../types';
import { delay } from './util';

/**
 * Simulates sending a follow-up email to the candidate.
 */
export const sendFollowupHandler: StepHandler = async ({ context, step }) => {
  const input = (step.input ?? {}) as { template?: string; delayMs?: number };
  await delay(input.delayMs ?? 300 + Math.random() * 400);
  const crm = context['update-crm'] as
    | { crmRecordId?: string; scheduledFor?: string | null }
    | undefined;

  return {
    emailId: `msg_${Date.now()}`,
    template: input.template ?? 'interview-followup-v1',
    scheduledFor: crm?.scheduledFor ?? null,
    crmRecordId: crm?.crmRecordId ?? null,
  };
};
