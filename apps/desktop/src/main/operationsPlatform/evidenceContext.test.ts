/**
 * S128 — AI evidence grounding (pure). Proves governed evidence → AiContextItem[] with explicit per-item
 * provenance, evidence-not-interpretation text, trace-leads-then-hits ordering, provenance dedup, bounding,
 * credential-free output, and honest-empty behavior. No AI execution (pure projection).
 */
import { describe, it, expect } from 'vitest';
import type { EvidenceHit } from './evidenceSearch';
import type { TraceEntry } from './evidenceTrace';
import { projectEvidenceForAI, MAX_GROUNDING_ITEMS, DEFAULT_GROUNDING_ITEMS, boundGroundingLimit } from './evidenceContext';

function hit(over: Partial<EvidenceHit> = {}): EvidenceHit {
  return { kind: 'command', id: 'tx_1', source: 'command-journal', type: 'CreateSalesOrder', timestamp: 1_700_000_000_000, summary: 'CreateSalesOrder · DELIVERED', status: 'DELIVERED', correlationId: 'corr-1', connectorId: null, score: 1, ...over } as EvidenceHit;
}
function entry(over: Partial<TraceEntry> = {}): TraceEntry {
  return { source: 'command-journal', id: 'tx_1', timestamp: 1, at: '2026-09-05T00:00:01.000Z', type: 'CreateSalesOrder', status: 'DELIVERED', aggregateId: 'so-1', correlationId: 'corr-1', delivery: { state: 'DELIVERED', linked: true, attempts: 1, deliveredAt: '2026-09-05T00:00:05.000Z' }, ...over } as TraceEntry;
}

describe('S128 · AI evidence grounding (pure)', () => {
  it('projects search hits into AiContextItem[] with EXACT per-item provenance', () => {
    const items = projectEvidenceForAI({ hits: [hit({ id: 'tx_A', source: 'command-journal' })] });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('timeline'); // coarse channel (frozen enum), exact provenance below
    expect(items[0].evidence).toEqual([{ kind: 'command-journal', id: 'tx_A' }]);
    expect(items[0].text).toContain('CreateSalesOrder'); // evidence, not interpretation
  });

  it('trace entries lead, then hits; deduped by provenance (kind:id)', () => {
    const items = projectEvidenceForAI({
      traceEntries: [entry({ id: 'tx_1', source: 'command-journal' })],
      hits: [hit({ id: 'tx_1', source: 'command-journal' }), hit({ id: 'gh1', source: 'connector-inbound', kind: 'inbound', connectorId: 'github' })],
    });
    // tx_1 appears once (trace wins), plus the distinct connector-inbound hit
    expect(items.map((i) => i.evidence?.[0])).toEqual([
      { kind: 'command-journal', id: 'tx_1' },
      { kind: 'connector-inbound', id: 'gh1' },
    ]);
    expect(items[0].text).toContain('Correlated evidence'); // trace-derived
  });

  it('is bounded by the caller limit', () => {
    const hits = Array.from({ length: MAX_GROUNDING_ITEMS + 10 }, (_, i) => hit({ id: `tx_${i}` }));
    expect(projectEvidenceForAI({ hits, limit: 5 })).toHaveLength(5);
    expect(projectEvidenceForAI({ hits }).length).toBe(DEFAULT_GROUNDING_ITEMS); // no limit ⇒ default cap
    expect(projectEvidenceForAI({ hits, limit: MAX_GROUNDING_ITEMS }).length).toBe(MAX_GROUNDING_ITEMS); // capped at max
  });

  it('empty input ⇒ empty context (honest, never fabricated)', () => {
    expect(projectEvidenceForAI({})).toEqual([]);
  });

  it('grounding items carry NO credential/secret/raw payload material', () => {
    const items = projectEvidenceForAI({
      hits: [hit({ id: 'tx_1' })],
      traceEntries: [entry({ id: 'tx_2', source: 'delivered-events' })],
    });
    const blob = JSON.stringify(items).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody', 'bearer']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('boundGroundingLimit clamps junk to default and caps at max', () => {
    expect(boundGroundingLimit('junk')).toBeGreaterThan(0);
    expect(boundGroundingLimit(-1)).toBeGreaterThan(0);
    expect(boundGroundingLimit(9999)).toBe(MAX_GROUNDING_ITEMS);
  });
});
