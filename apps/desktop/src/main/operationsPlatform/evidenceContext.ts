/**
 * S128 — AI evidence GROUNDING (pure, deterministic, read-only).
 *
 * Turns governed operational EVIDENCE (the S125 evidence-search hits + the S126/S127 correlation-trace
 * entries) into `AiContextItem[]` — the SAME context shape the assistant's canonical Context Builder
 * already consumes (mirrors `capabilities/capabilityAiContext.ts projectCapabilitiesForAI`). It lets the
 * live Brain be GROUNDED on what actually happened operationally, WITHOUT any new AI runtime, store, or
 * retrieval engine — it is a pure projection over evidence the governed reads already produced.
 *
 * BOUNDARIES (each pinned):
 *   • READ-ONLY: pure function, no store/clock/IO/mutation; produces context, never executes anything.
 *   • EVIDENCE ≠ INTERPRETATION: every item is a sanitized factual line tagged with EXPLICIT per-item
 *     provenance in `evidence:[{kind,id}]` (kind = the canonical source, id = the record id). The text is
 *     evidence, not an AI conclusion. The frozen `AiContextItem.source` is a COARSE channel label
 *     (`'timeline'`); the precise provenance is the per-item `evidence[]` (as capabilities use
 *     `'mission-brief'` coarsely).
 *   • CREDENTIAL-FREE: only ids/types/statuses/timestamps/summaries — never payloads, secrets, tokens, or
 *     raw outbox error text (the inputs already exclude those).
 *   • BOUNDED: never "return everything"; clamped to a caller cap.
 *   • TENANT-SAFE by construction: the caller supplies evidence ALREADY scoped to the server-resolved
 *     tenant; this module resolves no tenant.
 *   • NO FROZEN CHANGE: reuses the frozen `AiContextItem` type + an existing `AiContextSource` value; it
 *     neither modifies nor extends the shared contract.
 */
import type { AiContextItem } from '@neuropause/shared';
import type { EvidenceHit } from './evidenceSearch';
import type { TraceEntry } from './evidenceTrace';

/** Coarse context channel (frozen enum). Exact provenance is carried per-item in `evidence[]`. */
const EVIDENCE_SOURCE = 'timeline' as const;
export const MAX_GROUNDING_ITEMS = 50;
export const DEFAULT_GROUNDING_ITEMS = 20;

export function boundGroundingLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_GROUNDING_ITEMS;
  return Math.min(n, MAX_GROUNDING_ITEMS);
}

const iso = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : 'unknown time');

/** One evidence-search hit → a grounding item (factual line + exact provenance). */
function hitToItem(h: EvidenceHit): AiContextItem {
  const bits = [
    `${h.type}`,
    h.status ? `status ${h.status}` : null,
    h.connectorId ? `connector ${h.connectorId}` : null,
    h.correlationId ? `correlation ${h.correlationId}` : null,
    `at ${iso(h.timestamp)}`,
  ].filter(Boolean);
  return { source: EVIDENCE_SOURCE, text: `Operational evidence — ${bits.join(' · ')}.`, evidence: [{ kind: h.source, id: h.id }] };
}

/** One correlation-trace entry → a grounding item (factual line + exact provenance incl. delivery posture). */
function traceEntryToItem(e: TraceEntry): AiContextItem {
  const bits = [
    `${e.type}`,
    e.status ? `status ${e.status}` : null,
    e.delivery && e.delivery.state !== 'UNAVAILABLE' ? `delivery ${e.delivery.state}` : null,
    e.aggregateId ? `aggregate ${e.aggregateId}` : null,
    `at ${e.at || 'unknown time'}`,
  ].filter(Boolean);
  return { source: EVIDENCE_SOURCE, text: `Correlated evidence — ${bits.join(' · ')}.`, evidence: [{ kind: e.source, id: e.id }] };
}

export interface EvidenceGroundingInput {
  /** evidence-search hits (already tenant-scoped, sanitized). */
  hits?: readonly EvidenceHit[];
  /** correlation-trace entries (already tenant-scoped, sanitized). */
  traceEntries?: readonly TraceEntry[];
  limit?: number;
}

/**
 * Project governed evidence into grounding context for the Brain. Pure and total. Trace entries (the more
 * specific "what happened for this correlation") lead, then search hits, deduplicated by provenance
 * (kind:id), bounded. Empty input ⇒ empty context (honest: nothing to ground on), never fabricated.
 */
export function projectEvidenceForAI(input: EvidenceGroundingInput): AiContextItem[] {
  const limit = boundGroundingLimit(input.limit);
  const seen = new Set<string>();
  const out: AiContextItem[] = [];
  const push = (item: AiContextItem): void => {
    const prov = item.evidence?.[0];
    const key = prov ? `${prov.kind}:${prov.id}` : item.text;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  for (const e of input.traceEntries ?? []) push(traceEntryToItem(e));
  for (const h of input.hits ?? []) push(hitToItem(h));
  return out.slice(0, limit);
}
