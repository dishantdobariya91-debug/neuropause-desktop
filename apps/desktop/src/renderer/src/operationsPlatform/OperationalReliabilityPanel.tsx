/**
 * S122 — the operator-facing Operational Reliability panel. A READ-ONLY, tenant-scoped view of the
 * platform's delivery-reliability posture, fetched through the governed read IPC
 * (`ipc.platform.reliabilitySummary` → `platform:command.dispatch`, `QueryReliabilitySummary` read
 * branch → the S122 pure projection over the SAME durable command journal, tenant resolved SERVER-SIDE).
 *
 * It mutates nothing, creates no ERP transaction, and renders exactly the sanitized reliability posture
 * the main process returns — per-status counts, success / delivery-failure ratios, per-command-type
 * rollup, and recurring outbox error signatures. It NEVER shows command payloads, secrets, tokens, or
 * credentials (the projection carries none). No SLO verdict is shown unless an objective is configured
 * (none is, by default — see DECISION-MEMO-S122-SLO-OBJECTIVE).
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';

interface CommandTypeRow {
  commandType: string;
  total: number;
  delivered: number;
  pending: number;
  processing: number;
  retryable: number;
  attempts: number;
  retried: number;
  everErrored: number;
}
interface ErrorRow { signature: string; count: number }
interface ReliabilityData {
  totals: { commands: number; delivered: number; pending: number; processing: number; retryable: number; attempts: number; retried: number; everErrored: number };
  successRatio: number;
  deliveryFailureRatio: number;
  byCommandType: CommandTypeRow[];
  topErrors: ErrorRow[];
}

const pct = (r: number): string => `${(Math.max(0, Math.min(1, Number(r) || 0)) * 100).toFixed(1)}%`;

export function OperationalReliabilityPanel(): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<ReliabilityData | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const resp = await ipc.platform.reliabilitySummary({ limit: 25 });
      if (!resp.ok) {
        setMessage(resp.error?.message ?? 'Operational reliability is not available.');
        setState('error');
        return;
      }
      setData((resp.data ?? null) as unknown as ReliabilityData | null);
      setState('ready');
    } catch {
      setMessage('Operational reliability could not be loaded.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === 'loading') return <LoadingBlock label="Loading operational reliability…" />;

  const totals = data?.totals;
  const byType = data?.byCommandType ?? [];
  const topErrors = data?.topErrors ?? [];
  const failureTone = (t?: typeof totals): 'green' | 'orange' | 'red' =>
    !t ? 'green' : t.retryable > 0 ? 'red' : t.pending + t.processing > 0 ? 'orange' : 'green';

  return (
    <OpsPanel
      title="Operational reliability"
      subtitle="Governed command delivery posture — read-only, tenant-scoped, credential-free"
      actions={
        <button type="button" className="text-2xs text-muted hover:text-ink" onClick={() => void refresh()}>
          Refresh
        </button>
      }
    >
      {state === 'error' ? (
        <EmptyState title="Unavailable" hint={message} />
      ) : !totals || totals.commands === 0 ? (
        <EmptyState title="No governed commands yet" hint="Reliability posture will appear once governed commands have been dispatched." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusBadge tone="gray" label={`Commands: ${totals.commands}`} />
            <StatusBadge tone="green" label={`Delivered: ${totals.delivered} (${pct(data!.successRatio)})`} />
            <StatusBadge tone={totals.retryable > 0 ? 'red' : 'gray'} label={`Retrying: ${totals.retryable} (${pct(data!.deliveryFailureRatio)})`} />
            <StatusBadge tone={totals.pending + totals.processing > 0 ? 'orange' : 'gray'} label={`In flight: ${totals.pending + totals.processing}`} />
            <StatusBadge tone={totals.retried > 0 ? 'orange' : 'gray'} label={`Retried: ${totals.retried}`} />
          </div>

          {byType.length > 0 && (
            <div className="mb-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {byType.map((t) => (
                <div key={t.commandType} className="flex items-center justify-between gap-3 py-2 text-2xs">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.commandType}</span>
                  <span className="text-faint">
                    {t.delivered}/{t.total} delivered{t.retryable > 0 ? ` · ${t.retryable} retrying` : ''}{t.retried > 0 ? ` · ${t.retried} retried` : ''}
                  </span>
                  <StatusBadge tone={failureTone(t as unknown as typeof totals)} label={t.retryable > 0 ? 'at risk' : 'ok'} />
                </div>
              ))}
            </div>
          )}

          {topErrors.length > 0 ? (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              <div className="py-2 text-2xs font-semibold uppercase tracking-wide text-faint">Recurring delivery errors</div>
              {topErrors.map((e) => (
                <div key={e.signature} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1 truncate text-2xs text-ink">{e.signature}</div>
                  <StatusBadge tone="red" label={`×${e.count}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-2xs text-faint">No recurring delivery errors recorded.</div>
          )}
        </>
      )}
    </OpsPanel>
  );
}
