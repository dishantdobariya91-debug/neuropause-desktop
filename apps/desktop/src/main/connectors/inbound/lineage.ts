/**
 * S119 — INBOUND-EVENT LINEAGE (read-only, tenant-scoped projection over the S114 verified event).
 *
 * A PURE, READ-ONLY projection over the platform events the S114 webhook router already emits for a
 * VERIFIED inbound delivery (`type: 'connector.online'`, `metadata.kind: 'inbound_webhook'`). It adds
 * NO connector framework, NO registry, NO event store, NO event bus — it reads the EXISTING per-tenant
 * event ring (`EventBus.replay`, already tenant-scoped and fail-closed) and reshapes it into lineage rows.
 *
 * SAFETY BOUNDARY (each pinned in lineage.test.ts):
 *   - TENANT SCOPE comes from the AUTHORITATIVE bus-stamped `event.tenantId` (materialized from the
 *     resolved tenant), NEVER from the webhook payload. A row whose authoritative tenant ≠ the reader's
 *     tenant is dropped; a webhook payload cannot forge tenant/workspace identity.
 *   - READ-ONLY: it imports only types; it mutates no store, creates no ERP transaction, dispatches no
 *     command, and grants no AI/execution authority. Lineage is DESCRIPTION, never an authorization input.
 *   - NO SECRETS: the source event carries no payload/headers/secret/token (S114), and this projection
 *     emits a fixed row shape that has no field for any of them.
 *   - FAIL-CLOSED: no resolved tenant ⇒ no rows; an event missing connectorId/provider is dropped
 *     (incomplete lineage is not fabricated); the S114 event carries no dedupe/idempotency reference, so
 *     `dedupeRef` is honestly `null` (ABSENT) — never invented.
 *   - S114 UNCHANGED: this file does not import or modify the router/verify path.
 */
import type { PlatformEvent } from '@neuropause/shared';

/** One verified inbound-webhook delivery, projected for read-only lineage/context. */
export interface InboundLineageRow {
  /** the platform event's own id (stable per delivery; duplicates remain distinct — S114 does not dedupe). */
  eventId: string;
  connectorId: string;
  provider: string;
  /** the verified source = the provider that passed S114 signature/clientState verification. */
  verifiedSource: string;
  /** epoch ms the router received the verified delivery (authoritative server clock). */
  receivedAt: number;
  /** authoritative tenant (bus-stamped), never from payload. */
  tenantId: string;
  /** S114 carries no dedupe/idempotency reference on the event ⇒ ABSENT (never fabricated). */
  dedupeRef: null;
  /** structural marker: lineage never carries credential/secret material. */
  credentialsPresent: false;
}

const INBOUND_EVENT_TYPE = 'connector.online';
const INBOUND_KIND = 'inbound_webhook';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Project the verified inbound-webhook events for exactly ONE authoritative tenant. Pure; drops any
 * event that is not a verified inbound webhook, is missing connectorId/provider, or belongs to a
 * different (or unresolved) tenant. The caller supplies the AUTHORITATIVE tenant id (never the payload).
 */
export function projectInboundLineage(events: readonly PlatformEvent[], tenantId: string): InboundLineageRow[] {
  if (str(tenantId) === null) return []; // fail-closed: no resolved tenant → no lineage
  const out: InboundLineageRow[] = [];
  for (const e of events) {
    if (e.type !== INBOUND_EVENT_TYPE) continue;
    const meta = e.metadata ?? {};
    if (meta.kind !== INBOUND_KIND) continue;
    // AUTHORITATIVE tenant scoping — the bus-stamped tenantId, not any payload/metadata claim.
    if (e.tenantId !== tenantId) continue;
    const connectorId = str(meta.connectorId);
    const provider = str(meta.provider);
    if (connectorId === null || provider === null) continue; // fail-closed: incomplete lineage not fabricated
    const receivedAt = typeof meta.receivedAt === 'number' && Number.isFinite(meta.receivedAt)
      ? meta.receivedAt
      : Date.parse(e.timestamp);
    out.push({
      eventId: e.id,
      connectorId,
      provider,
      verifiedSource: provider,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0,
      tenantId,
      dedupeRef: null,
      credentialsPresent: false,
    });
  }
  return out;
}

/** The minimal read surface this projection needs — satisfied by the existing `EventBus`. */
export interface InboundLineageSource {
  replay(filter?: { types?: readonly string[]; limit?: number }): PlatformEvent[];
}

/**
 * Read verified inbound-webhook lineage for the active tenant from the EXISTING event ring. Fail-closed:
 * a null tenant returns []. Reuses `EventBus.replay` (already tenant-scoped); adds no new store or channel.
 */
export function readInboundLineage(source: InboundLineageSource, tenantId: string | null): InboundLineageRow[] {
  if (tenantId === null || str(tenantId) === null) return [];
  return projectInboundLineage(source.replay({ types: [INBOUND_EVENT_TYPE] }), tenantId);
}
