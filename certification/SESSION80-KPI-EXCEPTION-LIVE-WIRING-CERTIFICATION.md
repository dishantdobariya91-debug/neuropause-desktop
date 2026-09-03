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

## Mac validation run (operator, 2026-09-03, HEAD a78df40) — honest record

| Item | Result |
|---|---|
| Build (`out-seam-s80`) | ✅ built |
| Full main suite | **10200 passed / 2 failed / 7 skipped.** The **2 failures are `releaseDiscipline.test.ts` (Gate 27)** — "rc.24 tag already spent, 15 commits past it" + "CHANGELOG says no unreleased changes." These are the **PAUSED RELEASE-TRACK hygiene guards** (the standing S76 state), **class D — not S80, not a product defect.** Zero S80-related failures among the 10200. |
| Full UI suite | ✅ **455/455** |
| S80 Electron journey | ❌ **FAILED** at `FG-S80 capture channel present and captured` — the harness invoked `enterprise:kpi.capture`, **a channel that does not exist.** The implementation deliberately provides **no capture channel** (per "no new IPC channel"); capture is the background service. **Class B — harness defect, NOT a product defect.** |

**Classification:** the main-suite 2 = **D (paused release track)**; the journey failure = **B (harness defect)**. **No class-A product defect appeared.** But the live path is therefore **UNVERIFIED end-to-end → S80 is NOT GREEN.**

## S80-MAC fix (class B, harness only — no production source changed)

`e2e/s80KpiExceptionJourney.e2e.cjs` corrected to drive the REAL no-channel path: seed a product below its own safety stock (governed create) → **poll the existing `executiveCenter:snapshot` channel** across the background capture ticks until `kpiIntelligence.activeExceptions` shows the `inventory.belowSafetyStock` EXCEPTION → restock (governed update) → poll until it clears (recovery). It also asserts the `KPI intelligence capture started` boot log. syntax-checked; **PENDING a Mac re-run.**

## Design finding (recorded, not patched)

Capture is **background-only** (`TICK_MS = 60_000`) with **no governed on-demand trigger** — by design, to honor "no new IPC channel." Consequences: (1) the E2E must wait/poll across a 60s+ tick (the fix does this, up to ~150s); (2) a user cannot force a KPI refresh from the UI. **If the Mac re-run still fails** — e.g. the background `forEachTenantBackground` fan-out does not iterate the fresh local-mode profile's tenant, or 60s is impractical — that is a **genuine product finding** whose remedy is a governed on-demand capture trigger, which requires a **NEW frozen IPC channel = a separate FG gate** (out of scope here; presented as the operator's decision). Not implemented in this gate.

## FG-S80b applied — governed on-demand `kpi:capture` (closes the F-P45 finding)

**Token (verbatim, matched):** `AUTHORIZED: FG-S80b — kpi:capture governed IPC channel (channels.ts enum + allowlist, 2 additive lines), per gate doc`.

- **Frozen (ONLY file):** `packages/shared/src/ipc/channels.ts` — 2 additive lines: `KpiCapture: 'kpi:capture'` (enum) + `IpcChannel.KpiCapture` (renderer-invokable allowlist). gate-detector confirms this is the sole FROZEN file in the changeset; the other three are PROCEED (non-frozen). No `contracts.ts`/`runtimeCore.ts`/`baseline.json` change.
- **Non-frozen:** `kpiIntelligenceInstance.ts` → `captureForCurrentPrincipal()` (resolves tenant from `currentPrincipal()` in main — never renderer-supplied; deny-by-default on no principal; reuses `captureForScope`→`captureAndEvaluate`, so immutable/idempotent/fail-closed preserved). `executiveCenterSubsystem.ts` → one `SecureHandlerDef` on `IpcChannel.KpiCapture` (`schema: EmptyRequest`, `requireAuth: true`). `e2e/s80KpiExceptionJourney.e2e.cjs` → drives `kpi:capture` (create→capture→exception→idempotent re-capture→restock→capture→recover).
- **The fix:** the WRITER now stamps `tenantId = currentPrincipal().tenantId`, the SAME key the READER (`readKpiIntelligence(currentPrincipal().tenantId)`) uses — writer = reader, so the F-P45 divergence is closed. The background service remains as the periodic path.
- **Security:** `EmptyRequest` (`.strict()`) blocks any renderer tenant/`organization.id` injection; `requireAuth: true`; tenant resolved in main; tenant-isolated; no renderer→store / AI→store; no new engine/store/read-channel.
- **Verified here:** gate-detector (1 authorized frozen file) · typecheck:node 0 · typecheck:web 0 · eslint clean (incl. channels.ts) · S80 core 10/10 + executiveCenter 14/14. **PENDING Mac:** full main suite, full UI suite, build, and the updated real-Electron `s80KpiExceptionJourney` (the actual proof of the live path).

## FINAL STATUS

**S80 = PARTIAL — NOT GREEN.** Engineering complete (frozen field + non-frozen wiring; typecheck node+web 0, eslint clean, 10/10 core + 14/14 executiveCenter); Mac build ✅, main suite clean of S80 failures (only Gate-27 paused-release), UI 455/455. **The real-Electron journey has NOT passed** — the original harness assumed a non-existent channel (class B); it is now fixed to drive the real background→executive-snapshot path and awaits a Mac **re-run**. If the re-run passes, S80 = GREEN; if it fails on background capture reaching the local-mode tenant, that is a product finding requiring a governed on-demand capture trigger (separate FG). Release track PAUSED. S81 not started.
