# SESSION 89 — GOVERNED REORDER EXECUTION & OPERATOR CONFIRMATION — CERTIFICATION

**Class:** governed execution slice (operator-initiated). **Outcome: the smallest operator-initiated governed reorder execution path is LIVE — explicit confirmation → governed command → exactly ONE draft PR.** No automatic procurement; no PO; no inventory movement; no GL; no supplier award. No frozen change; no FG-S89 token required. Baseline S88 GREEN. Release track PAUSED.

## 1. Exact execution lineage

```
S85 recommendation → S86 decision readiness → S88 execution policy (deriveReorderExecutionDecision)
  → operator clicks "Create Purchase Request" (ReorderExecutionPanel, explicit 2-step confirm)
  → ipc.platform.createReorderPurchaseRequest(reportId, sku)   [operation: CreatePurchaseRequestFromReorderRecommendation]
  → platform:command.dispatch → Application Boundary → dispatchCommand
  → envelope validation → principal-derived tenancy → authorize('procurement:manage')
  → durable journal idempotency → re-read LIVE state → S88 policy (fail closed if stale)
  → EnterpriseModuleCreate (the EXISTING CreatePurchaseRequest path) → ONE draft PR
  → PurchaseRequestCreated event → outbox → audit → (compensation on commit failure)
```

## 2. Source-wins findings

- The command spine and dispatch channel are **entirely non-frozen**: `PlatformCommandDispatchRequest.operation` is a free `z.string().max(64)` (not a frozen enum), and `dispatchCommand`/`domainCommand.ts`/`commandBus.ts` are main-process non-frozen. So the new command needs **no frozen change and no FG token**.
- The governed **PR-draft primitive already exists** (`CreatePurchaseRequest` → `procurement:manage`, `PurchaseRequestCreated`). The S89 command REUSES it — no duplicated PR creation.
- The **S88 decision layer** (`deriveReorderExecutionDecision`) is the fail-closed gate; the **deterministic PR number** (`PR-REORDER-<reportNumber>-<sku>`) is the identity + idempotency (Session-3 pattern).

## 3. Command implementation (non-frozen)

`domainCommand.ts`: `CreatePurchaseRequestFromReorderRecommendation` added to the type union, `EVENT_FOR_COMMAND` (reuses `PurchaseRequestCreated`), `PERMISSION_FOR_COMMAND` (`procurement:manage`). `commandBus.ts` route case: reads the S86 report (tenant-scoped `store.get`), finds the SKU row (`expectedQuantity = row.suggestedQuantity`), re-reads the LIVE product + open supply, calls `deriveReorderExecutionDecision`, **fails closed unless `executable`**, then creates the draft PR through `EnterpriseModuleCreate` with the deterministic number, canonical quantity, `status:'draft'`, and a reason naming the source report (lineage). Compensation soft-deletes the draft on a failed durable commit.

## 4. UI implementation (non-frozen)

`ReorderExecutionPanel.tsx` renders ONLY on the S86 decision-report detail (mounted in `RecordDetail` beside `DocumentPanel`, the existing conditional-panel precedent), and offers "Create Purchase Request" ONLY for `READY_FOR_OPERATOR_REVIEW` rows. It shows product, available stock, open supply, reorder level, recommended quantity, estimated value, approval steps, the deterministic PR number, and a plain draft-only statement. The action is **two-step**: an explicit confirmation dialog precedes any dispatch. `ipc.platform.createReorderPurchaseRequest` derives a deterministic idempotency key (`reorder-exec:<reportId>:<sku>`) so a double-click replays rather than duplicating. No automatic/background execution.

## 5. Approval behavior

Unchanged and reused. The PR is created as a **draft**; approval is the existing downstream PR lifecycle (submit → approve → convert to PO) with the existing approval engine + budget control. S89 invents no threshold and never auto-approves.

## 6. Idempotency proof

`reorderExecutionCommand.test.ts`: first confirmation → one PR; second with the SAME key → **replay, no duplicate**; second with a DIFFERENT key → refused (the first PR's open supply restored the position → stale); **replay across a durable-journal RESTART → no duplicate** (fresh journal over the same file). The command-journal idempotency is unweakened.

## 7. Stale-state proof

Re-reads live product + open supply and re-runs `assessReorder` at execution. `stale-not-triggered` (position restored) and `stale-quantity-changed` (live suggested qty differs) both fail closed with no PR. Proven in unit + journey.

## 8. Security / tenant proof

`NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a recommendation from another tenant → `RECOMMENDATION_NOT_FOUND` (tenant-scoped `store.get`); unauthorized actor (`procurement:manage` denied) → `UNAUTHORIZED`; actor server-resolved; renderer cannot bypass (the command runs through the governed dispatch → Application Boundary → per-command RBAC); AI cannot execute directly (advisory only; no LLM→command path). All in `reorderExecutionCommand.test.ts`.

## 9. PR side-effect proof

Exactly one PR (draft); **zero PO; zero inventory mutation; zero GL; no supplier award** — before/after snapshots in the unit side-effect test and the journey.

## 10. Real-Electron result — GREEN on the execution path (operator Mac, 2026-09-04)

`e2e/s89GovernedReorderExecutionJourney.e2e.cjs` on the alternate build (`out-seam-s89`), fresh isolated profile, governed bridge only. **All execution / idempotency / side-effect assertions PASSED**: product → receive → ship → S85 → S86 → dispatch (`platform:command.dispatch`) → ONE draft PR `PR-REORDER-REORDER-DECISION-2026-09-04-1-SKU-1` × 430, recommendation lineage, **no supplier** → re-dispatch same key = replay (PR count 1) → distinct re-execution refused → **no PO, no inventory mutation, no GL**. The full main suite passed on the Mac. The final STALE step initially failed as a **class-B harness race** (it dispatched immediately after a receive, before the async stock reconciliation updated `availableStock`, so the command correctly still saw a triggered position); the command's stale logic is unit-proven (15/15, incl. `stale-not-triggered`). Fixed by polling the live `availableStock` until it reflects the receipt before asserting the stale refusal — journey re-run PENDING to confirm the corrected step.

## 11. Frozen-file changes

**None.** gate-detector PROCEED on all 8 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared` untouched. No FG-S89 token. `certification/baseline.json` untouched.

## 12. Test results

`reorderExecutionCommand.test.ts` **15/15** (positive, idempotency incl. durable restart, stale, negative, security, side-effects). `ui-tests/reorderExecutionPanel.test.tsx` **5/5** (executable-only, explicit confirmation, correct governed call, refusal surfaced, empty when none executable). Typecheck node+web 0; eslint clean. Broader command-spine + inventory + procurement + S85/S86/S87/S88 sweep recorded on landing. Full main + UI suites + build + journey PENDING operator Mac.

## 13. Exact commits

One non-frozen commit (recorded on landing).

## 14. Remaining policy gaps

None new. The S88 register's future options stay open (operator quantity override, per-SKU preferred supplier master field to pre-fill supplier). S89 keeps quantity immutable and supplier absent, per S88.

## 15. Final S89 status

**Operator-initiated governed reorder execution IMPLEMENTED and TEST-VERIFIED (15/15 command + 5/5 UI).** Explicit confirmation → governed command → exactly one draft PR, fail-closed on stale/duplicate, tenant/RBAC/idempotency/lineage proven, zero PO/inventory/GL/supplier effect. No frozen change; no automatic procurement. Real-Electron journey PENDING Mac. Release track PAUSED.
