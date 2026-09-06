import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import { advanceMachineStates, applyHumanDecision, day7Report, enroll, pilotDay, recordConsent, recordEvent, status } from './service';
import { HUMAN_DECISION_STATES, PilotError } from './types';

const U = 'user-1';

describe('pilot lifecycle service', () => {
  it('refuses enrollment without consent', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await expect(enroll(deps, U)).rejects.toMatchObject({ code: 'consent_required' });
  });

  it('consent -> enroll -> status day 1, and duplicate enrollment is refused', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'pilot-terms-v1');
    const e = await enroll(deps, U);
    expect(e.state).toBe('PILOT_ACTIVE');
    await expect(enroll(deps, U)).rejects.toMatchObject({ code: 'already_enrolled' });
    const s = await status(deps, U);
    expect(s.day).toBe(1);
    expect(s.day7Ready).toBe(false);
    expect(s.consentVersion).toBe('pilot-terms-v1');
  });

  it('records valid events, rejects unknown types, and events never change state', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'v1');
    await enroll(deps, U);
    await recordEvent(deps, U, 'session_started', {});
    await recordEvent(deps, U, 'feedback_submitted', { satisfaction: 4, text: 'good' });
    await expect(recordEvent(deps, U, 'become_paid', {})).rejects.toMatchObject({ code: 'invalid_event' });
    expect((await status(deps, U)).enrollment?.state).toBe('PILOT_ACTIVE');
    expect((await status(deps, U)).eventCount).toBe(2);
  });

  it('day-7 report aggregates events and marks unmeasurable metrics NOT_MEASURABLE (never zero)', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'v1');
    await enroll(deps, U);
    await recordEvent(deps, U, 'session_started', {});
    await recordEvent(deps, U, 'feedback_submitted', { satisfaction: 5 });
    const r = await day7Report(deps, U);
    expect(r.eventCounts.session_started).toBe(1);
    expect(r.feedback).toHaveLength(1);
    expect(r.crashes).toBe('NOT_MEASURABLE');
    expect(r.osUsage).toBe('NOT_MEASURABLE');
  });

  it('GOVERNANCE: machine advancement can only reach DAY7_READY/DAY30_READY, never an outcome state', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'v1');
    const e = await enroll(deps, U);
    // simulate day 8 by back-dating startedAt
    const rec = deps.repo as ReturnType<typeof createMemoryPilotRepository>;
    rec.enrollments.get(U)!.startedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(pilotDay(rec.enrollments.get(U)!)).toBeGreaterThanOrEqual(7);
    const after = await advanceMachineStates(deps, U);
    expect(after?.state).toBe('DAY7_READY');
    expect(HUMAN_DECISION_STATES).not.toContain(after?.state);
    expect(e.decisionId).toBeNull();
  });

  it('GOVERNANCE: every outcome state requires a recorded human decision; invalid targets rejected', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'v1');
    await enroll(deps, U);
    await expect(applyHumanDecision(deps, 'actor-1', U, 'PILOT_ACTIVE', 'x', 'y')).rejects.toMatchObject({
      code: 'invalid_decision',
    });
    const { decision, enrollment } = await applyHumanDecision(
      deps,
      'actor-1',
      U,
      'PAID_PENDING_HUMAN_DECISION',
      'introduce paid plan',
      'Day-7 evidence reviewed by founder',
    );
    expect(enrollment.state).toBe('PAID_PENDING_HUMAN_DECISION');
    expect(enrollment.decisionId).toBe(decision.id);
    const repo = deps.repo as ReturnType<typeof createMemoryPilotRepository>;
    expect(repo.decisions).toHaveLength(1);
    expect(repo.decisions[0]!.actorId).toBe('actor-1');
  });

  it('GOVERNANCE: DAY7_READY does not auto-convert — state persists until a human decision', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await recordConsent(deps, U, 'v1');
    await enroll(deps, U);
    const repo = deps.repo as ReturnType<typeof createMemoryPilotRepository>;
    repo.enrollments.get(U)!.startedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await advanceMachineStates(deps, U);
    await advanceMachineStates(deps, U); // repeated machine passes
    expect(repo.enrollments.get(U)!.state).toBe('DAY7_READY'); // still not paid/continue/stopped
  });

  it('rejects events and day7 for non-enrolled users', async () => {
    const deps = { repo: createMemoryPilotRepository() };
    await expect(recordEvent(deps, U, 'session_started', {})).rejects.toMatchObject({ code: 'not_enrolled' });
    await expect(day7Report(deps, U)).rejects.toBeInstanceOf(PilotError);
  });
});
