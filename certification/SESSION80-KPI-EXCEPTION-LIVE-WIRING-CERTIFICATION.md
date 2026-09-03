# SESSION 80-FG — KPI/EXCEPTION LIVE WIRING CERTIFICATION

**Class:** authorized FG live-wiring of the S80 governed KPI-intelligence core. Baseline S80 `95f53cf`. **Status: ENGINEERING COMPLETE — MAC VALIDATION PENDING** (per the directive's §10, this Linux sandbox cannot run the full main/UI suites, build, or real Electron). Release track PAUSED.

## Authorization token (verbatim)

`AUTHORIZED: FG-S80 — ExecutiveSnapshot kpiIntelligence optional field + runtimeCore KPI-intelligence capture-service registration, per gate doc`

Verified against `FG-S80-KPI-EXCEPTION-LIVE-WIRING.md` (field name `kpiIntelligence` exact; frozen surface `packages/shared/`). **Two corrections/scope-reductions, both recorded (§2 #20 source-wins + micro-authorization):**
1. The IPC-returned type is **`ExecutiveCenterSnapshot`** (`packages/shared/src/types/executiveCenter.ts`), not `ExecutiveSnapshot` — the FG doc named the wrong type. Both are within the authorized frozen surface (`packages/shared/`), the field/intent are identical, and `ExecutiveCenterSnapshot` is the ONLY type that surfaces through the live channel, so it is unambiguously the correct target.
2. **The runtimeCore change was NOT needed.** `serviceManager`'s service list is in **non-frozen** `services/serviceManager.ts` (and `startAll` already runs), so the capture service registers there with **zero frozen runtimeCore lines** — below the authorized envelope (using less is within the micro-authorization rule). **Net frozen footprint = ONE file.**

## Exact frozen files modified (1)

- `packages/shared/src/types/executiveCenter.ts` — **additive only**: one optional field `kpiIntelligence?: KpiIntelligenceSnapshot | null` on `ExecutiveCenterSnapshot` + the additive `KpiIntelligenceSnapshot` interface (snapshots[] + activeExceptions[]). Backward-compatible (optional; older callers/builds unaffected — proven by typecheck:web exit 0).

gate-detector confirms this is the ONLY changed file that is FROZEN; the other four changed files are PROCEED (non-frozen).

## Non-frozen changes (3 + 1 new)

- `apps/desktop/src/main/analyticsPlatform/kpiIntelligenceInstance.ts` (**new**) — composition root: constructs the two `DurableJsonStore`s; `captureForScope` reads the real `productModule` store (each product's own `safetyStock`/`currentStock`), runs `captureAndEvaluate`; `readKpiIntelligence(tenantId)` sync read-model; `KpiIntelligenceCaptureService` (BackgroundService) ticks `forEachTenantBackground` per tenant.
- `apps/desktop/src/main/services/serviceManager.ts` — one import + one list entry (`kpiIntelligenceCapture`) in the existing static services array. Reuses the existing cadence/startAll.
- `apps/desktop/src/main/enterprise/executiveCenterSubsystem.ts` — one import + one line: `snap.kpiIntelligence = readKpiIntelligence(currentPrincipal()?.tenantId ?? null)` before returning the existing `ExecutiveCenterSnapshot` (surfaces via the already-registered `ExecutiveCenterSnapshot` channel — no new channel).
- `apps/desktop/src/main/analyticsPlatform/kpiSnapshotStore.ts` — added `KpiSnapshotStore.load()` (hydrate for the sync read after restart).

## Existing infrastructure reused (no duplicates)

`DurableJsonStore` (persistence) · `forEachTenantBackground` (per-tenant fan-out) · `serviceManager` (cadence) · `productModule` store + safety-stock master fields · the existing `ExecutiveCenterSnapshot` channel (read). No new KPI/analytics/notification/workflow/event/outbox/audit/transaction/inventory engine; no new IPC channel; no new event type.

## S80 core evidence

Unchanged core: `session80KpiException.test.ts` **10/10 green** (immutable idempotent snapshots · NORMAL/WARNING/EXCEPTION/RECOVERED · dedup/no-spam · recovery · fail-closed no-tenant + null threshold · tenant isolation · dedupeKey stability).

## Live-wiring evidence (runnable here)

- gate-detector: exactly ONE frozen file changed (the authorized `executiveCenter.ts`).
- typecheck:node exit **0**; typecheck:web exit **0** (shared type backward-compatible).
- eslint: clean on all changed files.
- `executiveCenter.test.ts` **14/14** (no regression in the composed snapshot — `kpiIntelligence` is set after the pure compose).

## Governance (§4)

Tenant is resolved in main (`currentPrincipal()` / `forEachTenantBackground` per-tenant principal) — never renderer-supplied. `captureAndEvaluate` refuses `NO_TENANT` (deny-by-default). No renderer→store access (renderer reads only the governed snapshot channel). Historical snapshots immutable (idempotent record; `KpiSnapshotStore.record` never overwrites). Exception transitions deterministic; notification intents deduped by `<exceptionId>#<transitionSeq>`. Undefined thresholds fail-closed. AI has no role and no execution authority in this path.

## Notification path

The capture produces `KpiNotificationIntent`s on transitions (deduped); active exceptions are surfaced on the executive snapshot. **Inbox DELIVERY is a deliberate non-frozen follow-up** (routing intents to the existing `notifications` inbox) — kept out of this gate to hold the frozen footprint to the single authorized file. The directive's §6 test-4 (notification through the existing path) is part of the Mac E2E, PENDING.

## Regression (§7) — honest PENDING

Runnable here: typecheck node+web (0), eslint (clean), S80 tests (10/10), executiveCenter tests (14/14). **NOT runnable in this Linux sandbox → PENDING Mac:** full main suite, full UI suite, build, and the real-Electron journey `e2e/s80KpiExceptionJourney.e2e.cjs` (which asserts capture→snapshot→exception→Executive Center visibility→recovery on a fresh profile). **Not claimed GREEN.**

## Remaining blocker

Mac validation only (full suites + build + real-Electron journey). Once the Mac run is green, S80 = GREEN; also the inbox-delivery follow-up (non-frozen) can wire the intents to the notifications inbox.

## FINAL STATUS

**S80 = PARTIAL — ENGINEERING COMPLETE, MAC VALIDATION PENDING.** Frozen gate applied additively (ONE file, backward-compatible), non-frozen wiring complete, all sandbox-runnable checks green, exactly one authorized frozen surface touched, `baseline.json` untouched, no runtimeCore change needed. Release track PAUSED. STOP after S80-FG — S81 not started.
