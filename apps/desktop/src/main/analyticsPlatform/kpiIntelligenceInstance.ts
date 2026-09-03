/**
 * S80 live wiring — the KPI-intelligence COMPOSITION ROOT + its BackgroundService shell.
 *
 * The S80 core (kpiSnapshotModel / kpiSnapshotStore / inventorySafetyStockSeam) is Electron-free,
 * store-injectable and clock-injectable. This file owns the real I/O + identity so the core stays
 * test-drivable. It reuses:
 *   • DurableJsonStore (S33) for persistence — no new engine,
 *   • forEachTenantBackground (the proven per-tenant fan-out) for tenant-scoped capture,
 *   • serviceManager (its list is NON-FROZEN; startAll already runs) for the cadence — ZERO frozen
 *     runtimeCore lines (mirrors readBackReconcilerInstance's disposition),
 *   • the existing productModule store + each product's own safetyStock/currentStock master fields.
 *
 * Notification DELIVERY to the inbox is a non-frozen follow-up (the intents are produced + the active
 * exceptions are surfaced on the Executive Center snapshot); this gate touches exactly ONE frozen file
 * (the ExecutiveCenterSnapshot field), below the authorized envelope.
 */
import { app } from 'electron';
import { join } from 'node:path';
import type { KpiIntelligenceSnapshot } from '@neuropause/shared';
import { productFromRecord } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { BackgroundService } from '../services/serviceManager';
import { forEachTenantBackground } from '../enterprise/index';
import { productModule } from '../enterprise/modules/inventory/productModuleInstance';
import { DurableJsonStore } from '../platform/persistence/durableJsonStore';
import {
  KpiSnapshotStore, KpiExceptionStore, captureAndEvaluate, type KpiNotificationIntent,
} from './kpiSnapshotStore';
import type { KpiSnapshot, KpiExceptionState } from './kpiSnapshotModel';
import { belowSafetyStockObservation, safetyStockCondition, type ProductStockLike } from './inventorySafetyStockSeam';

const log = createLogger('kpi-intelligence');
const TICK_MS = 60_000; // matches the other background cadences

const dir = () => (typeof app !== 'undefined' && app?.getPath ? app.getPath('userData') : process.cwd());
const snapshots = new KpiSnapshotStore(new DurableJsonStore<KpiSnapshot>(join(dir(), 'kpi-snapshots.json')));
const exceptions = new KpiExceptionStore(new DurableJsonStore<KpiExceptionState>(join(dir(), 'kpi-exceptions.json')));

/** Load once so the sync Executive Center read can see persisted data after a restart. */
void Promise.all([snapshots.load(), exceptions.load()]).catch(() => undefined);

function periodKeyFor(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10); // one snapshot per calendar day per (tenant,kpi)
}

/** Capture + evaluate the inventory safety-stock KPI for the CURRENT tenant scope. Fail-closed on no tenant. */
async function captureForScope(scope: { tenantId: string | null; workspaceId: string | null }): Promise<void> {
  const products: ProductStockLike[] = productModule.store
    .list()
    .filter((r) => r.status !== 'deleted')
    .map((r) => {
      const p = productFromRecord(r);
      return { sku: p.sku, currentStock: Number(p.currentStock ?? 0), safetyStock: Number(p.safetyStock ?? 0) };
    });
  const result = await captureAndEvaluate({
    scope, now: () => new Date().toISOString(), periodKey: periodKeyFor(Date.now()),
    snapshots, exceptions,
    observations: [belowSafetyStockObservation(products)],
    conditions: [safetyStockCondition(0)], // "any product below its own safety stock" — no invented threshold
  });
  if ('refused' in result) return; // NO_TENANT — deny-by-default, nothing produced
  for (const n of result.notifications) deliverIntent(n);
}

/**
 * Notification delivery hook. Deferred to a non-frozen follow-up (routing to the existing inbox);
 * for now the intent is logged and the active exception is surfaced on the executive snapshot.
 */
function deliverIntent(n: KpiNotificationIntent): void {
  log.info('KPI exception notification intent', { exceptionId: n.exceptionId, status: n.status, dedupeKey: n.dedupeKey });
}

/** Sync read-model for the Executive Center — latest snapshots + active exceptions for one tenant. */
export function readKpiIntelligence(tenantId: string | null): KpiIntelligenceSnapshot | null {
  if (!tenantId) return null; // unresolved scope ⇒ absent, never a fabricated 0
  const snaps = snapshots.latestForTenant(tenantId);
  const active = exceptions.activeForTenant(tenantId);
  return {
    capturedAt: new Date().toISOString(),
    snapshots: snaps.map((s) => ({ kpiKey: s.kpiKey, label: s.label, value: s.value, band: s.band, calculatedAt: s.calculatedAt, periodKey: s.periodKey })),
    activeExceptions: active.map((e) => ({
      kpiKey: e.kpiKey, conditionId: e.conditionId, status: e.status as 'WARNING' | 'EXCEPTION',
      observedValue: e.observedValue, threshold: e.threshold, lastTransitionAt: e.lastTransitionAt, message: e.message,
    })),
  };
}

class KpiIntelligenceCaptureService implements BackgroundService {
  readonly name = 'kpi-intelligence-capture';
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
    log.info('KPI intelligence capture started', { intervalMs: TICK_MS });
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One pass per operable tenant, each under that tenant's own principal (fan-out isolates failures). */
  async tick(): Promise<void> {
    await forEachTenantBackground('kpi-intelligence-capture', async (run) => {
      await captureForScope({ tenantId: run.scope.tenantId, workspaceId: run.scope.workspaceId });
    });
  }
}

export const kpiIntelligenceCapture = new KpiIntelligenceCaptureService();
