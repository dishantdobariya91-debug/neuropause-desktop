/**
 * Pilot lifecycle service — pure logic over an injected PilotRepository.
 *
 * Governance invariants enforced here, not in the UI:
 *  - enrollment requires a recorded consent (consent_required);
 *  - one enrollment per user (already_enrolled);
 *  - events never change lifecycle state;
 *  - every outcome state (CONTINUE / PAID_PENDING_HUMAN_DECISION / INSTITUTIONAL_PENDING /
 *    EXTENDED / STOPPED / COMPLETED) is reachable ONLY through applyHumanDecision, which
 *    requires a recorded human decision — there is no machine path to paid conversion.
 */
import { HUMAN_DECISION_STATES, PILOT_EVENT_TYPES, PilotError } from './types';
import type { HumanDecision, PilotEnrollment, PilotEvent, PilotEventType, PilotState } from './types';
import type { PilotRepository } from './repository';

export interface PilotServiceDeps {
  repo: PilotRepository;
}

const DAY_MS = 86_400_000;

export function pilotDay(e: PilotEnrollment, at = Date.now()): number {
  return Math.floor((at - new Date(e.startedAt).getTime()) / DAY_MS) + 1;
}

export async function recordConsent(deps: PilotServiceDeps, userId: string, version: string) {
  return deps.repo.recordConsent(userId, version);
}

export async function enroll(deps: PilotServiceDeps, userId: string): Promise<PilotEnrollment> {
  const consent = await deps.repo.latestConsent(userId);
  if (!consent) throw new PilotError('consent_required', 'Record consent before enrolling in the pilot.');
  const existing = await deps.repo.getEnrollment(userId);
  if (existing) throw new PilotError('already_enrolled', 'A pilot enrollment already exists for this account.');
  return deps.repo.createEnrollment(userId, consent.id);
}

export async function recordEvent(
  deps: PilotServiceDeps,
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<PilotEvent> {
  if (!(PILOT_EVENT_TYPES as readonly string[]).includes(eventType))
    throw new PilotError('invalid_event', `Unknown pilot event type: ${eventType}`);
  const e = await deps.repo.getEnrollment(userId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  return deps.repo.insertEvent(userId, e.id, eventType as PilotEventType, metadata);
}

export interface PilotStatus {
  enrollment: PilotEnrollment | null;
  consentVersion: string | null;
  day: number | null;
  day7Ready: boolean;
  eventCount: number;
}

export async function status(deps: PilotServiceDeps, userId: string): Promise<PilotStatus> {
  const consent = await deps.repo.latestConsent(userId);
  const e = await deps.repo.getEnrollment(userId);
  if (!e) return { enrollment: null, consentVersion: consent?.version ?? null, day: null, day7Ready: false, eventCount: 0 };
  const events = await deps.repo.listEvents(e.id);
  const day = pilotDay(e);
  return { enrollment: e, consentVersion: consent?.version ?? null, day, day7Ready: day >= 7, eventCount: events.length };
}

export interface Day7Report {
  day: number;
  activeDays: number;
  eventCounts: Record<string, number>;
  feedback: Array<Record<string, unknown>>;
  crashes: 'NOT_MEASURABLE';
  osUsage: 'NOT_MEASURABLE';
  state: PilotState;
}

export async function day7Report(deps: PilotServiceDeps, userId: string): Promise<Day7Report> {
  const e = await deps.repo.getEnrollment(userId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  const events = await deps.repo.listEvents(e.id);
  const eventCounts: Record<string, number> = {};
  const days = new Set<string>();
  const feedback: Array<Record<string, unknown>> = [];
  for (const ev of events) {
    eventCounts[ev.eventType] = (eventCounts[ev.eventType] ?? 0) + 1;
    days.add(ev.createdAt.slice(0, 10));
    if (ev.eventType === 'feedback_submitted') feedback.push(ev.metadata);
  }
  // Metrics the current system cannot produce are NOT_MEASURABLE, never zero.
  return { day: pilotDay(e), activeDays: days.size, eventCounts, feedback, crashes: 'NOT_MEASURABLE', osUsage: 'NOT_MEASURABLE', state: e.state };
}

export async function applyHumanDecision(
  deps: PilotServiceDeps,
  actorId: string,
  subjectUserId: string,
  targetState: string,
  decision: string,
  reason: string,
): Promise<{ decision: HumanDecision; enrollment: PilotEnrollment }> {
  if (!(HUMAN_DECISION_STATES as readonly string[]).includes(targetState))
    throw new PilotError('invalid_decision', `Not a human-decision outcome state: ${targetState}`);
  const e = await deps.repo.getEnrollment(subjectUserId);
  if (!e) throw new PilotError('not_enrolled', 'No pilot enrollment for this account.');
  const rec = await deps.repo.insertDecision({
    actorId,
    decisionType: 'commercial',
    subject: `pilot_enrollment:${e.id}`,
    decision: `${targetState}: ${decision}`,
    reason,
  });
  await deps.repo.setEnrollmentState(e.id, targetState as PilotState, rec.id);
  const updated = await deps.repo.getEnrollment(subjectUserId);
  return { decision: rec, enrollment: updated! };
}

/**
 * The ONLY machine-driven state transitions: PILOT_ACTIVE→DAY7_READY (day>=7)
 * and →DAY30_READY (day>=30). Outcome states are unreachable here by design.
 */
export async function advanceMachineStates(deps: PilotServiceDeps, userId: string): Promise<PilotEnrollment | null> {
  const e = await deps.repo.getEnrollment(userId);
  if (!e) return null;
  const day = pilotDay(e);
  if (e.state === 'PILOT_ACTIVE' && day >= 30) await deps.repo.setEnrollmentState(e.id, 'DAY30_READY', null);
  else if (e.state === 'PILOT_ACTIVE' && day >= 7) await deps.repo.setEnrollmentState(e.id, 'DAY7_READY', null);
  return deps.repo.getEnrollment(userId);
}
