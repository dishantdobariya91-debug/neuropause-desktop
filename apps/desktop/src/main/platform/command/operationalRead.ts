/**
 * NeuroPause Platform — governed operational READ projection (ERP Session 32).
 *
 * A tenant-scoped, bounded, SANITIZED read over the EXISTING durable command journal (Session 18)
 * and the S31 delivered-event sink. It is a READ PROJECTION, not a query framework and not a second
 * data-access layer: it holds no state, opens no store of its own, and performs NO mutation — it only
 * shapes what the journal + sink already expose (both already tenant-filtered by construction) into an
 * operator-safe view.
 *
 * SECURITY POSTURE:
 *   • the caller passes the AUTHORITATIVE tenant id (resolved server-side from the principal) — this
 *     module never reads a renderer-claimed tenant;
 *   • only operationally-useful, non-sensitive fields are returned — no raw command payloads
 *     (`result`), no raw event `detail`, no secrets/tokens/credentials (the domain commands carry
 *     none, but the projection excludes those fields regardless);
 *   • pagination is BOUNDED (never "return everything") and a malformed filter FAILS CLOSED.
 */
import type { CommittedCommand, DurableCommandJournal } from './durableCommandJournal';
import type { DeliveredEventLog } from './deliveredEventLog';
import { readInboundLineage, summarizeInboundLineage, summarizeInboundLineageTrend, type InboundLineageSource } from '../../connectors/inbound/lineage';
import { summarizeReliability, summarizeReliabilityTrend } from '../../operationsPlatform/operationalReliability';
import { searchOperationalEvidence, type EvidenceKind } from '../../operationsPlatform/evidenceSearch';
import { composeEvidenceTrace } from '../../operationsPlatform/evidenceTrace';
import { computePlatformHealth } from './platformHealth';

/**
 * The operations this read surface answers — anything else is not a read (falls to the write path).
 * `QueryDeliveryOperations` (ERP Session 35) is the delivery-failure drill-down; it is a SIBLING read
 * on this SAME branch (no new channel/command/bus), routed to `buildDeliveryOperations`.
 */
export const OPERATIONAL_READ_OPERATIONS: ReadonlySet<string> = new Set([
  'QueryOperationalHistory',
  'QueryDeliveryOperations',
  // S120 — read-only connector inbound-event lineage (S119). A SIBLING read on this SAME governed
  // branch (server-resolved principal, RBAC operations:read, tenant validation, bounded projection);
  // routed to `buildInboundLineage`. No new channel/command/bus/store.
  'QueryInboundLineage',
  // S122 — operational reliability intelligence: a SIBLING read on this SAME governed branch, a pure
  // deterministic projection over the SAME durable command journal (delivery-reliability posture +
  // recurring error signatures). Routed to `buildReliabilitySummary`. No new channel/command/bus/store.
  'QueryReliabilitySummary',
  // S124 — cross-surface operational OVERVIEW: a SIBLING read on this SAME governed branch that COMPOSES
  // the existing operational-read builders (health + delivery + reliability + reliability-trend + inbound
  // + inbound-trend) into ONE compact operator posture. A pure composition layer — it opens no store,
  // adds no source of truth, and mutates nothing. Routed to `buildOperationalOverview`.
  'QueryOperationalOverview',
  // S125 — governed operational EVIDENCE SEARCH: a SIBLING read on this SAME branch. A deterministic
  // lexical/filter search over the SAME tenant-scoped committed-command history + verified connector
  // inbound lineage, making fragmented canonical evidence discoverable. Pure, read-only, credential-free,
  // bounded. Routed to `buildEvidenceSearch`. No new search engine / vector store / index / channel.
  'QueryEvidenceSearch',
  // S126 — governed EVIDENCE TRACE (correlation timeline): a SIBLING read on this SAME branch. Given an
  // EXISTING correlationId, composes the SAME tenant-scoped committed-command + delivered-event records
  // that genuinely carry it into ONE chronological trace. Exact-match only; inbound lineage (no
  // correlationId) is never joined. Pure, read-only, bounded, credential-free. Routed to `buildEvidenceTrace`.
  'QueryEvidenceTrace',
]);

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
export const OUTBOX_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING', 'DELIVERED', 'RETRYABLE']);

export interface OperationalReadParams {
  limit?: unknown;
  outboxStatus?: unknown;
}

export type OperationalReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/** Clamp any client-supplied limit into (0, MAX] — a non-integer / non-positive / oversized value is bounded, never trusted, never unbounded. */
export function boundLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export const trimError = (e: unknown): string => String(e).slice(0, 200);

/**
 * S120 — the governed connector inbound-event lineage read (S119 projection). `tenantId` MUST be the
 * authoritative server-resolved tenant (never a renderer claim). Reads only the EXISTING per-tenant
 * EventBus ring via `readInboundLineage`; mutates nothing, creates no ERP transaction, and returns a
 * bounded, sanitized projection that carries no credential/secret. A null source (bus not yet bound
 * at boot) returns an honest empty lineage — never an error, never fabricated rows.
 */
export function buildInboundLineage(
  source: InboundLineageSource | undefined,
  tenantId: string,
  params: OperationalReadParams,
): OperationalReadResult {
  const limit = boundLimit(params.limit);
  const rows = source ? readInboundLineage(source, tenantId) : [];
  const bounded = rows.slice(-limit).reverse(); // most-recent-first, bounded
  // S121 — per-connector activity rollup (operational intelligence), derived purely from the same
  // tenant-scoped rows. Computed over ALL rows (not just the bounded page) so counts are accurate.
  const summary = summarizeInboundLineage(rows);
  // S123 — connector inbound TREND over the SAME tenant-scoped lineage rows (two chronological windows).
  // Additive field on the same governed read (generic `data` — no frozen contract change).
  const trend = summarizeInboundLineageTrend(rows);
  return { ok: true, data: { tenantId, limit, counts: { lineage: rows.length, connectors: summary.length }, lineage: bounded, summary, trend } };
}

/**
 * S122 — the governed operational RELIABILITY read. `tenantId` MUST be the authoritative
 * server-resolved tenant (never a renderer claim). Reads only the EXISTING per-tenant journal records
 * via `journal.records(tenantId)`; mutates nothing, creates no ERP transaction, and returns a bounded,
 * sanitized reliability posture. An optional `objective` in [0,1] adds a request-based error budget
 * (no verdict is computed without one — no invented SLO policy). `byCommandType` and `topErrors` are
 * bounded by `limit`.
 */
export function buildReliabilitySummary(
  journal: DurableCommandJournal,
  tenantId: string,
  params: OperationalReadParams & { objective?: unknown },
): OperationalReadResult {
  const limit = boundLimit(params.limit);
  // Optional SLO objective — validated to a proper fraction; anything else is treated as "not supplied"
  // (FAILS CLOSED to no verdict rather than fabricating a target).
  let objective: number | undefined;
  if (params.objective !== undefined && params.objective !== null && params.objective !== '') {
    const n = Number(params.objective);
    if (Number.isFinite(n) && n >= 0 && n <= 1) objective = n;
  }
  const records = journal.records(tenantId); // tenant-scoped by construction
  const summary = summarizeReliability(records, objective !== undefined ? { objective } : {});
  // S123 — reliability TREND over the SAME tenant-scoped records (two chronological windows). Pure,
  // deterministic, policy-free; additive `trend` field on the same governed read response (the response
  // `data` is a generic Record — no frozen contract change, no new operation/channel).
  const trend = summarizeReliabilityTrend(records);
  return {
    ok: true,
    data: {
      tenantId,
      limit,
      totals: summary.totals,
      successRatio: summary.successRatio,
      deliveryFailureRatio: summary.deliveryFailureRatio,
      byCommandType: summary.byCommandType.slice(0, limit),
      topErrors: summary.topErrors.slice(0, limit),
      trend,
      ...(summary.budget ? { budget: summary.budget } : {}),
    },
  };
}

/**
 * S126 — the governed EVIDENCE TRACE (correlation timeline). `tenantId` MUST be the authoritative
 * server-resolved tenant. Reads only the EXISTING per-tenant committed-command + delivered-event records
 * and composes the pure exact-match correlation trace. Read-only, bounded, credential-free. A blank or
 * non-matching correlationId returns an honest no-identifier / not-found trace, never a fuzzy match.
 */
export function buildEvidenceTrace(
  journal: DurableCommandJournal,
  deliveredLog: DeliveredEventLog | undefined,
  tenantId: string,
  params: OperationalReadParams & { correlationId?: unknown },
): OperationalReadResult {
  const limit = boundLimit(params.limit);
  const correlationId = typeof params.correlationId === 'string' ? params.correlationId : '';
  const commands = journal.records(tenantId); // tenant-scoped by construction
  const delivered = deliveredLog ? deliveredLog.delivered(tenantId) : [];
  const trace = composeEvidenceTrace(commands, delivered, correlationId, { limit });
  return {
    ok: true,
    data: {
      tenantId,
      limit,
      correlationId: trace.correlationId,
      found: trace.found,
      counts: trace.counts,
      entries: trace.entries,
      bounded: trace.bounded,
      inboundCorrelatable: trace.inboundCorrelatable,
      ...(trace.note ? { note: trace.note } : {}),
    },
  };
}

/**
 * S125 — the governed operational EVIDENCE SEARCH. `tenantId` MUST be the authoritative server-resolved
 * tenant (never a renderer claim). Reads only the EXISTING per-tenant journal records + verified inbound
 * lineage, runs the pure deterministic lexical search, and returns a bounded, sanitized, credential-free
 * result. A null lineage source (bus not bound at boot) simply contributes no inbound evidence — never an
 * error, never fabricated rows. Optional `kind` narrows to one evidence kind; an unknown kind FAILS CLOSED
 * to "both" rather than erroring.
 */
export function buildEvidenceSearch(
  journal: DurableCommandJournal,
  lineageSource: InboundLineageSource | undefined,
  tenantId: string,
  params: OperationalReadParams & { query?: unknown; kind?: unknown },
): OperationalReadResult {
  const limit = boundLimit(params.limit);
  const query = typeof params.query === 'string' ? params.query : '';
  const kind: EvidenceKind | undefined = params.kind === 'command' || params.kind === 'inbound' ? params.kind : undefined;
  const commands = journal.records(tenantId); // tenant-scoped by construction
  const lineage = lineageSource ? readInboundLineage(lineageSource, tenantId) : [];
  const result = searchOperationalEvidence(commands, lineage, query, { limit, ...(kind ? { kind } : {}) });
  return { ok: true, data: { tenantId, limit, query: result.query, counts: result.counts, bounded: result.bounded, hits: result.hits } };
}

/**
 * S124 — the governed cross-surface OPERATIONAL OVERVIEW. A pure COMPOSITION over the existing
 * operational-read builders: it re-derives the same tenant-scoped postures those reads already return
 * and folds them into one compact operator summary. `tenantId` MUST be the authoritative server-resolved
 * tenant. It opens no store, adds no source of truth, executes nothing, and mutates nothing. Each section
 * is computed defensively: a single failing sub-read degrades ONLY its own section to `available:false`
 * rather than failing the whole overview (an honest gap, never a fabricated posture).
 *
 * Audit-integrity is intentionally NOT composed here — it lives on its own governed channel/store
 * (`security:auditIntegrity.status`, S115); the overview UI reads that existing governed surface directly
 * for its tile, so each source stays authoritative and no cross-subsystem coupling is introduced.
 */
export interface OperationalOverviewDeps {
  journal: DurableCommandJournal;
  deliveredLog?: DeliveredEventLog;
  runtimeReady: () => boolean;
  lineageSource?: InboundLineageSource;
}

function section<T>(compute: () => T): { available: true; value: T } | { available: false } {
  try {
    return { available: true, value: compute() };
  } catch {
    return { available: false };
  }
}

export async function buildOperationalOverview(
  deps: OperationalOverviewDeps,
  tenantId: string,
  params: OperationalReadParams,
): Promise<OperationalReadResult> {
  const limit = boundLimit(params.limit);

  // HEALTH — real runtime + persistence probe (async, already defensive).
  let health: Record<string, unknown> | null = null;
  try {
    const h = await computePlatformHealth({
      journal: deps.journal,
      ...(deps.deliveredLog ? { deliveredLog: deps.deliveredLog } : {}),
      runtimeReady: deps.runtimeReady,
    });
    health = { status: h.status, live: h.live, ready: h.ready, checkedAt: h.checkedAt, components: h.components };
  } catch {
    health = null;
  }

  // RELIABILITY posture + trend — composed from the SAME journal records (one read).
  const reliabilitySection = section(() => {
    const records = deps.journal.records(tenantId);
    const s = summarizeReliability(records);
    const trend = summarizeReliabilityTrend(records);
    return {
      totals: s.totals,
      successRatio: s.successRatio,
      deliveryFailureRatio: s.deliveryFailureRatio,
      topError: s.topErrors[0] ?? null,
      trend: {
        comparable: trend.comparable,
        posture: trend.posture,
        deliveryFailureRateDirection: trend.deliveryFailureRate.direction,
        retryPressureDirection: trend.retryPressure.direction,
        newSignatures: trend.newSignatures.length,
      },
    };
  });

  // DELIVERY posture — the outbox status snapshot from the SAME journal (via the sibling builder's shape).
  const deliverySection = section(() => {
    const s = summarizeReliability(deps.journal.records(tenantId));
    return {
      pending: s.totals.pending,
      inFlight: s.totals.processing,
      retryable: s.totals.retryable,
      delivered: s.totals.delivered,
    };
  });

  // CONNECTOR INBOUND posture + trend — composed from the existing lineage read (bounded).
  const inbound = deps.lineageSource ? buildInboundLineage(deps.lineageSource, tenantId, { limit }) : null;
  const inboundData = inbound && inbound.ok ? (inbound.data as Record<string, unknown>) : null;
  const inboundTrend = inboundData?.trend as { comparable?: boolean; totalVolume?: { direction?: string }; newConnectors?: string[]; quietConnectors?: string[] } | undefined;
  const connectorInbound = inboundData
    ? {
        available: true as const,
        counts: inboundData.counts,
        trend: {
          comparable: Boolean(inboundTrend?.comparable),
          volumeDirection: inboundTrend?.totalVolume?.direction ?? 'STABLE',
          newConnectors: inboundTrend?.newConnectors?.length ?? 0,
          quietConnectors: inboundTrend?.quietConnectors?.length ?? 0,
        },
      }
    : { available: false as const };

  return {
    ok: true,
    data: {
      tenantId,
      checkedAt: new Date().toISOString(),
      health: health ?? { available: false },
      reliability: reliabilitySection,
      delivery: deliverySection,
      connectorInbound,
    },
  };
}

/** Operator-safe projection of a committed command — ids/type/actor/status/timestamps only, no payloads. */
function sanitizeCommand(rec: CommittedCommand): Record<string, unknown> {
  return {
    txId: rec.id,
    commandType: rec.commandType,
    actor: rec.event.actor,
    aggregateId: rec.event.aggregateId,
    ...(rec.event.aggregateType ? { aggregateType: rec.event.aggregateType } : {}),
    eventType: rec.event.type,
    correlationId: rec.event.correlationId,
    committedAt: rec.committedAt,
    idempotencyKey: rec.idempotencyKey,
    outbox: {
      status: rec.outbox.status,
      attempts: rec.outbox.attempts,
      ...(rec.outbox.deliveredAt ? { deliveredAt: rec.outbox.deliveredAt } : {}),
      ...(rec.outbox.lastError ? { lastError: trimError(rec.outbox.lastError) } : {}),
    },
  };
}

/**
 * Build the tenant-scoped operational history. `tenantId` MUST be the authoritative server-resolved
 * tenant. Reads only — never mutates the journal or the sink, so it can run concurrently with the S31
 * serialized drain without racing it.
 */
export function buildOperationalHistory(
  journal: DurableCommandJournal,
  deliveredLog: DeliveredEventLog | undefined,
  tenantId: string,
  params: OperationalReadParams,
): OperationalReadResult {
  const limit = boundLimit(params.limit);

  // Optional outbox-status filter — validated against the known set; an unknown value FAILS CLOSED
  // (never silently returns everything).
  let statusFilter: string | undefined;
  if (params.outboxStatus !== undefined && params.outboxStatus !== null && params.outboxStatus !== '') {
    const s = String(params.outboxStatus);
    if (!OUTBOX_STATUSES.has(s)) return { ok: false, error: 'INVALID_STATUS_FILTER' };
    statusFilter = s;
  }

  const all = journal.records(tenantId); // tenant-scoped by construction
  const filtered = statusFilter ? all.filter((r) => r.outbox.status === statusFilter) : all;
  // Most-recent-first, bounded.
  const commands = filtered.slice(-limit).reverse().map(sanitizeCommand);

  const pending = journal.pendingOutbox(tenantId); // PENDING | RETRYABLE, tenant-scoped
  const delivered = deliveredLog ? deliveredLog.delivered(tenantId) : [];

  return {
    ok: true,
    data: {
      tenantId,
      limit,
      counts: { commands: all.length, pendingOutbox: pending.length, delivered: delivered.length },
      commands,
      pendingOutbox: pending.slice(0, limit).map((r) => ({
        txId: r.id,
        commandType: r.commandType,
        status: r.outbox.status,
        attempts: r.outbox.attempts,
        ...(r.outbox.lastError ? { lastError: trimError(r.outbox.lastError) } : {}),
      })),
      delivered: delivered.slice(-limit).reverse().map((d) => ({
        eventId: d.id,
        type: d.type,
        aggregateId: d.aggregateId,
        ...(d.aggregateType ? { aggregateType: d.aggregateType } : {}),
        correlationId: d.correlationId,
        deliveredAt: d.deliveredAt,
      })),
    },
  };
}
