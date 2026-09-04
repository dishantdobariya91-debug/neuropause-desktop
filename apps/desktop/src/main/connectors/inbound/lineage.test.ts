/**
 * S119 — inbound-event lineage: a READ-ONLY, tenant-scoped projection over the S114 verified webhook
 * events, proven against the REAL EventBus ring. Adversarial: tenant isolation, payload-cannot-forge-
 * tenant, fail-closed on unresolved/malformed, no credentials, no ERP mutation, S114 semantics intact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../platform/eventBus';
import { projectInboundLineage, readInboundLineage } from './lineage';
import type { PlatformEventInput } from '@neuropause/shared';

function inbound(connectorId: string, provider: string, over: Record<string, string | number | boolean | null> = {}): PlatformEventInput {
  return {
    type: 'connector.online',
    category: 'connector',
    source: 'connectors',
    actor: { kind: 'connector', id: connectorId },
    resource: { type: 'connector', id: connectorId, name: null },
    metadata: { connectorId, provider, kind: 'inbound_webhook', receivedAt: 1_700_000_000_000, ...over },
  };
}

function busFor(tenantRef: { t: string | null }): EventBus {
  const bus = new EventBus({});
  bus.bindTenant(() => tenantRef.t);
  return bus;
}

describe('S119 · inbound-event lineage (read-only, tenant-scoped)', () => {
  it('projects a verified inbound webhook for the reader tenant only', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    ref.t = 'tenant-B';
    bus.publish(inbound('slack', 'slack'));

    ref.t = 'tenant-A';
    const a = readInboundLineage(bus, 'tenant-A');
    expect(a.map((r) => r.connectorId)).toEqual(['github']);
    expect(a[0]).toMatchObject({ provider: 'github', verifiedSource: 'github', tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false });
  });

  it('a reader CANNOT see another tenant’s lineage (isolation)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    ref.t = 'tenant-B';
    const b = readInboundLineage(bus, 'tenant-B');
    expect(b).toEqual([]); // A's delivery is invisible to B
  });

  it('a webhook payload CANNOT forge tenant identity (authoritative bus stamp wins)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    // the delivery metadata lies about its tenant; the bus stamps the real one (tenant-A)
    bus.publish(inbound('github', 'github', { tenantId: 'tenant-B-EVIL' }));
    ref.t = 'tenant-A';
    const a = readInboundLineage(bus, 'tenant-A');
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe('tenant-A'); // never the forged value
    ref.t = 'tenant-B-EVIL';
    expect(readInboundLineage(bus, 'tenant-B-EVIL')).toEqual([]); // forged tenant reads nothing
  });

  it('non-inbound connector events are excluded', () => {
    const events = [
      { id: 'e1', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { connectorId: 'x', provider: 'github' /* no kind */ } },
    ] as never;
    expect(projectInboundLineage(events, 'tenant-A')).toEqual([]);
  });

  it('malformed lineage (missing connectorId or provider) is DROPPED, not fabricated', () => {
    const events = [
      { id: 'e1', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { provider: 'github', kind: 'inbound_webhook' } },
      { id: 'e2', tenantId: 'tenant-A', type: 'connector.online', timestamp: '2026-09-04T00:00:00Z', metadata: { connectorId: 'gh', kind: 'inbound_webhook' } },
    ] as never;
    expect(projectInboundLineage(events, 'tenant-A')).toEqual([]);
  });

  it('duplicate deliveries remain DISTINCT rows and dedupeRef stays null (S114 dedupe semantics unchanged)', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    bus.publish(inbound('github', 'github'));
    const rows = readInboundLineage(bus, 'tenant-A');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(2); // distinct event ids
    expect(rows.every((r) => r.dedupeRef === null)).toBe(true);
  });

  it('fail-closed: no resolved tenant → no lineage', () => {
    const ref = { t: null as string | null };
    const bus = busFor(ref);
    ref.t = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    ref.t = null;
    expect(readInboundLineage(bus, null)).toEqual([]);
    expect(projectInboundLineage([], '')).toEqual([]);
  });

  it('lineage rows carry NO credential/secret material and a fixed safe shape', () => {
    const ref = { t: 'tenant-A' as string | null };
    const bus = busFor(ref);
    bus.publish(inbound('github', 'github'));
    const [row] = readInboundLineage(bus, 'tenant-A');
    expect(Object.keys(row).sort()).toEqual(['connectorId', 'credentialsPresent', 'dedupeRef', 'eventId', 'provider', 'receivedAt', 'tenantId', 'verifiedSource']);
    const blob = JSON.stringify(row).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'header', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('STRUCTURAL: lineage imports ONLY the shared type — no store/command-bus/executor/router', () => {
    const src = readFileSync(join(__dirname, 'lineage.ts'), 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    for (const line of importLines) expect(/from '@neuropause\/shared'/.test(line)).toBe(true);
    for (const forbidden of ['EnterpriseRecordStore', 'commandBus', 'dispatchCommand', 'executor', '/cst', 'connectorStore', './router', './verify']) {
      expect(src.includes(forbidden)).toBe(false);
    }
  });
});
