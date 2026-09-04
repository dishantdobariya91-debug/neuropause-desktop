/**
 * S122 — Operational Reliability Intelligence (pure, deterministic).
 *
 * A READ-ONLY projection over the EXISTING tenant-scoped `DurableCommandJournal` records — the same
 * committed-command / outbox evidence the operator already reads via `QueryOperationalHistory` and
 * `QueryDeliveryOperations`. It computes the platform's *delivery-reliability posture*: per-status and
 * per-command-type counts, the definitional success / delivery-failure ratios, retry pressure, and the
 * recurring outbox error signatures — turning raw outbox rows into operator-actionable reliability
 * intelligence.
 *
 * WHAT THIS HARVESTS (concept, not architecture): the reliability-engineering / SLO concept from the
 * unwired `packages/reliability` spine (S106/S107 Rule 3 — never drag in a second infra spine). The
 * OPTIONAL request-based error budget reuses the ALREADY-HARVESTED pure calculator
 * `operationsPlatform/errorBudget.ts` (`computeErrorBudget`, itself harvested from
 * `packages/reliability/src/slo.ts`) — giving that previously-unwired harvest its first real caller.
 *
 * DISCIPLINE:
 *   • PURE + TOTAL: no store, no clock, no I/O, no mutation. Every input maps to a defined output.
 *   • DEFINITIONAL, never invented policy: the counts and ratios are arithmetic facts about the rows.
 *     A healthy/at-risk/breached VERDICT requires an explicit SLO `objective` supplied by the caller;
 *     with no objective it is simply not computed (no fabricated target — see DECISION-MEMO-S122).
 *   • TENANT-SAFE by construction: the caller passes rows ALREADY scoped to the server-resolved tenant
 *     (`journal.records(tenantId)`); this module neither resolves nor trusts any tenant claim.
 *   • CREDENTIAL-FREE: only ids / types / statuses / counts / trimmed error strings are surfaced —
 *     never a command payload/result, never a secret (the domain commands carry none regardless).
 */
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import { computeErrorBudget, AT_RISK_BURN, type ErrorBudgetStatus } from './errorBudget';

/** Cap on how many distinct error signatures we surface — bounded, never "return everything". */
export const MAX_ERROR_SIGNATURES = 10;

/** Trim an error string to a bounded, log-safe signature (mirrors operationalRead.trimError). */
export function errorSignature(e: string): string {
  return String(e).slice(0, 200);
}

export interface CommandTypeReliability {
  commandType: string;
  total: number;
  delivered: number;
  pending: number;
  processing: number;
  retryable: number;
  /** total outbox delivery attempts across this command type. */
  attempts: number;
  /** records that took more than one attempt. */
  retried: number;
  /** records that have EVER recorded a delivery error (includes ones later delivered). */
  everErrored: number;
}

export interface ErrorSignatureRollup {
  signature: string;
  count: number;
}

/**
 * The request-based error budget, present ONLY when the caller supplies a real SLO `objective`.
 * "Request-based" = the window is the total number of governed deliveries and the consumed budget is
 * the number currently failing (RETRYABLE) — a standard SRE request-based SLO. Delegates the math to
 * the harvested `computeErrorBudget`; fields are re-projected into count units (never ms) for honesty.
 */
export interface ReliabilityBudget {
  /** success objective in [0,1] supplied by the caller. */
  objective: number;
  /** total governed deliveries in the window (denominator). */
  totalRequests: number;
  /** tolerated failures = round((1−objective)·total). */
  budgetFailures: number;
  /** observed failures currently consuming the budget (RETRYABLE). */
  consumedFailures: number;
  /** budget left = max(0, budget − consumed). */
  remainingFailures: number;
  /** consumed / budget (>1 ⇒ over budget). */
  burnRate: number;
  status: ErrorBudgetStatus;
}

export interface ReliabilitySummary {
  totals: {
    commands: number;
    delivered: number;
    pending: number;
    processing: number;
    retryable: number;
    /** sum of outbox attempts across all commands. */
    attempts: number;
    /** commands that took more than one attempt. */
    retried: number;
    /** commands that have ever recorded a delivery error. */
    everErrored: number;
  };
  /** delivered / commands, in [0,1]; 0 when there are no commands. Definitional fact, not a verdict. */
  successRatio: number;
  /** retryable / commands, in [0,1]; 0 when there are no commands. Definitional fact, not a verdict. */
  deliveryFailureRatio: number;
  /** per-command-type rollup, sorted by most-at-risk (retryable desc, then total desc). */
  byCommandType: CommandTypeReliability[];
  /** recurring outbox error signatures, most-frequent first, bounded to MAX_ERROR_SIGNATURES. */
  topErrors: ErrorSignatureRollup[];
  /** present only when an SLO objective was supplied — otherwise absent (no invented target). */
  budget?: ReliabilityBudget;
}

export interface ReliabilityOptions {
  /** optional SLO success objective in [0,1]; if omitted, no verdict/budget is computed. */
  objective?: number;
  /** optional at-risk burn threshold; defaults to the harvested AT_RISK_BURN display default. */
  atRiskBurn?: number;
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/**
 * Summarize the delivery-reliability posture of a set of ALREADY-tenant-scoped committed commands.
 * Pure and total. Passing `options.objective` additionally computes a request-based error budget via
 * the harvested `computeErrorBudget`.
 */
export function summarizeReliability(
  records: readonly CommittedCommand[],
  options: ReliabilityOptions = {},
): ReliabilitySummary {
  const totals = { commands: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0 };
  const byType = new Map<string, CommandTypeReliability>();
  const errorCounts = new Map<string, number>();

  for (const rec of records) {
    const status = rec.outbox.status;
    const attempts = Number.isFinite(rec.outbox.attempts) ? rec.outbox.attempts : 0;
    const hasError = typeof rec.outbox.lastError === 'string' && rec.outbox.lastError.length > 0;

    totals.commands += 1;
    totals.attempts += attempts;
    if (attempts > 1) totals.retried += 1;
    if (hasError) totals.everErrored += 1;
    if (status === 'DELIVERED') totals.delivered += 1;
    else if (status === 'PENDING') totals.pending += 1;
    else if (status === 'PROCESSING') totals.processing += 1;
    else if (status === 'RETRYABLE') totals.retryable += 1;

    const t = byType.get(rec.commandType) ?? {
      commandType: rec.commandType, total: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0,
    };
    t.total += 1;
    t.attempts += attempts;
    if (attempts > 1) t.retried += 1;
    if (hasError) t.everErrored += 1;
    if (status === 'DELIVERED') t.delivered += 1;
    else if (status === 'PENDING') t.pending += 1;
    else if (status === 'PROCESSING') t.processing += 1;
    else if (status === 'RETRYABLE') t.retryable += 1;
    byType.set(rec.commandType, t);

    if (hasError) {
      const sig = errorSignature(rec.outbox.lastError as string);
      errorCounts.set(sig, (errorCounts.get(sig) ?? 0) + 1);
    }
  }

  const byCommandType = [...byType.values()].sort(
    (a, b) => b.retryable - a.retryable || b.total - a.total || a.commandType.localeCompare(b.commandType),
  );

  const topErrors = [...errorCounts.entries()]
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
    .slice(0, MAX_ERROR_SIGNATURES);

  const summary: ReliabilitySummary = {
    totals,
    successRatio: ratio(totals.delivered, totals.commands),
    deliveryFailureRatio: ratio(totals.retryable, totals.commands),
    byCommandType,
    topErrors,
  };

  // OPTIONAL request-based error budget — only when a real objective is supplied (no invented policy).
  if (options.objective !== undefined && Number.isFinite(options.objective)) {
    // Delegate to the harvested calculator (unit-agnostic math); re-project ms fields into counts.
    const eb = computeErrorBudget({
      target: options.objective,
      windowMs: totals.commands,
      observedDowntimeMs: totals.retryable,
      ...(options.atRiskBurn !== undefined ? { atRiskBurn: options.atRiskBurn } : {}),
    });
    summary.budget = {
      objective: eb.target,
      totalRequests: totals.commands,
      budgetFailures: eb.budgetMs,
      consumedFailures: eb.consumedMs,
      remainingFailures: eb.remainingMs,
      burnRate: eb.burnRate,
      status: eb.status,
    };
  }

  return summary;
}

/** Re-export the harvested display banding default so a caller can surface it without a second constant. */
export { AT_RISK_BURN };
