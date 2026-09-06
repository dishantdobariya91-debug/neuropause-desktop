/**
 * S139 — the operator-facing Operational Exceptions panel renders the unified "needs follow-up" queue
 * (retrying deliveries + held reconciliations) fetched through the governed IPC
 * (`ipc.platform.operationalExceptions` → `platform:command.dispatch`, `QueryOperationalExceptions`).
 * Proves the real UI → bridge → governed read path; that both exception kinds render and never read as
 * success; the honest empty state; and that a governed-read failure surfaces as unavailable without a leak.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { route, clearRoutes } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { OperationalExceptionsPanel } from '@renderer/operationsPlatform/OperationalExceptionsPanel';

beforeEach(() => {
  cleanup();
  clearRoutes();
});

const resp = (over: Record<string, unknown>) => ({
  ok: true,
  data: { counts: { retryingDeliveries: 0, heldReconciliations: 0, total: 0 }, exceptions: [], ...over },
  requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions',
});

describe('OperationalExceptionsPanel', () => {
  it('renders both exception kinds from the governed read (retrying + held), never as success', async () => {
    let sawOperation = '';
    route(IpcChannel.PlatformCommandDispatch, (payload: unknown) => {
      sawOperation = (payload as { operation: string }).operation;
      return resp({
        counts: { retryingDeliveries: 1, heldReconciliations: 1, total: 2 },
        exceptions: [
          { kind: 'held_reconciliation', id: 'tenant-A::kA', at: '2026-09-05T13:00:00.000Z', summary: 'Held for reconciliation: kA', idempotencyKey: 'kA', state: 'HOLD', reason: 'RECONCILIATION_REQUIRED' },
          { kind: 'delivery_retrying', id: 'tx1', at: '2026-09-05T10:00:00.000Z', summary: 'Delivery retrying: SalesOrderCreated', eventType: 'SalesOrderCreated', aggregateId: 'agg-tx1', attempts: 2, lastError: 'sink unreachable' },
        ],
      });
    });
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Needs attention: 2')).toBeTruthy());
    expect(sawOperation).toBe('QueryOperationalExceptions');
    expect(screen.getByText('Retrying: 1')).toBeTruthy();
    expect(screen.getByText('Held: 1')).toBeTruthy();
    expect(screen.getByText('Delivery retrying: SalesOrderCreated')).toBeTruthy();
    expect(screen.getByText('Held for reconciliation: kA')).toBeTruthy();
    expect(screen.getByText(/sink unreachable/)).toBeTruthy();
  });

  it('honest empty state when nothing needs attention', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => resp({}));
    render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Nothing needs attention')).toBeTruthy());
    expect(screen.getByText('Needs attention: 0')).toBeTruthy();
  });

  it('a governed-read failure surfaces as unavailable and leaks no secret', async () => {
    route(IpcChannel.PlatformCommandDispatch, () => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'not permitted' }, requestId: 'r', correlationId: 'c', operation: 'QueryOperationalExceptions' }));
    const { container } = render(<OperationalExceptionsPanel />);
    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy());
    const blob = container.textContent!.toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'bearer']) expect(blob).not.toContain(forbidden);
  });
});
