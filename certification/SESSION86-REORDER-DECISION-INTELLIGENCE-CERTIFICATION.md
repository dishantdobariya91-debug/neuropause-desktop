# SESSION 86 — GOVERNED REORDER DECISION-READINESS & EXECUTION-READINESS INTELLIGENCE CERTIFICATION

**Class:** Tier-2 governed ERP read/intelligence capability (decision-intelligence-only, NON-EXECUTING). Baseline S85 GREEN. Release track PAUSED.

## 1. Repository census

S85 landed the reorder RECOMMENDATION register (`inventory-reorder-recommendation`, from `assessReorder` + `openSupplyForProduct` + S84 demand). The execution seam `autoReorderSeam.runReorderCheck` (drafts a PR DRAFT) exists but is a human-gated future path. The existing spend-approval engine `erp/approvalEngine.ts` (`applicableSteps`/`DEFAULT_SPEND_POLICY`) derives required approval steps from an order value. The product master (`packages/shared/types/inventory.ts`) carries `purchaseCost` but **no preferred-supplier / lead-time / MOQ / order-multiple field**. No existing reorder DECISION-readiness register.

## 2–3. Canonical sources

- **Reorder recommendation (trigger + quantity + position + demand):** S85 `deriveReorderRecommendations` — reused verbatim.
- **Order valuation:** `product.purchaseCost` (canonical; the only pricing on the master).
- **Approval requirement:** `applicableSteps(DEFAULT_SPEND_POLICY, value)` from `erp/approvalEngine.ts` — reused; no invented thresholds.

## 4. Existing reorder/approval logic

`assessReorder` = trigger + target + suggested quantity (S85 wraps it). `DEFAULT_SPEND_POLICY` = manager (always) + finance (≥10,000) + executive (≥100,000), documented in source as illustrative/operator-replaceable. `runReorderCheck` is the EXECUTION path — **S86 does NOT import or call it.**

## 5. Exact data lineage

products (`inventory-products`) + open PRs (`procurement-requests`) + open POs (`procurement-orders`) + shipments (`warehouse-shipping`) → S85 recommendation per active SKU → + estimated order value (qty × `purchaseCost`) + required approval steps (`applicableSteps`) + blockers + fail-closed execution readiness → immutable `inventory-reorder-decision` snapshot. Read-only w.r.t. all sources.

## 6. Implemented decision-readiness semantics

Per triggered SKU: suggestedQuantity, unitCost, estimatedOrderValue (`null` when cost ≤ 0 — undeterminable, never guessed), requiredApprovalSteps (labels from the existing policy), blockers[], `readinessStatus` (REORDER_NOT_REQUIRED / READY_FOR_OPERATOR_REVIEW / SUPPLIER_DATA_MISSING), `executionReadiness` = constant `BLOCKED_UNDEFINED_POLICY`. Portfolio: skuCount, reorderRequiredCount, readyForReviewCount, supplierDataMissingCount, notRequiredCount, executionBlocked (always true).

## 7. Policy-defined vs undefined

**Defined & reused:** reorder trigger/quantity, order valuation via `purchaseCost`, approval-step derivation via the existing spend policy, RBAC, tenancy. **Undefined & NOT invented (memo §C):** supplier selection (no master field), the tenant's authoritative spend policy (DEFAULT is illustrative), automatic-execution authority, demand→reorder-point adjustment. Each is surfaced as a blocker; execution is fail-closed. No STOP required for the decision-readiness layer.

## 8. Procurement execution boundary

`runReorderCheck` (→ PR draft) is the existing governed execution seam. **S86 never reaches it** — the model/module/instance do not import it; `executionReadiness` is `BLOCKED_UNDEFINED_POLICY` on every row and `executionBlocked` is always true. Automatic execution is undefined policy (memo §C.3) → S86 STOPS at the decision-readiness boundary.

## 9. Files changed (all non-frozen, gate-detector PROCEED)

`inventory/reorderDecisionModel.ts` · `inventory/reorderDecisionModule.ts` · `inventory/reorderDecisionModuleInstance.ts` · `inventory/reorderDecision.test.ts` · `e2e/s86ReorderDecisionReadinessJourney.e2e.cjs` · memo + gate doc + this cert.

## 10. Frozen-surface requirements

One frozen touch: register in `enterprise/index.ts` (1 import + 1 `registerModule`) — gated by the literal **FG-S86** token (`FG-S86-REORDER-DECISION-REGISTRATION.md`). No `packages/shared`/channels/Executive-Center change. STOPPED before the frozen edit awaiting the token.

## 11. Focused test results — 16/16 green (`reorderDecision.test.ts`)

Pure: valued order + manager approval, threshold-crossing pulls finance/executive, no-cost → SUPPLIER_DATA_MISSING (value null, not guessed), blockers present (supplier + undefined-execution), well-stocked → REORDER_NOT_REQUIRED, execution fail-closed on every row, inactive excluded + empty + determinism. Governed: RBAC (inventory:manage/read), decision row, **CRITICAL — no PR drafted / no PO created / products untouched**, **CRITICAL — execution blocked on every row**, empty honesty, deterministic regeneration, immutability, NO_TENANT fail-closed, tenant isolation.

## 12. Full regression (Linux sandbox)

gate-detector new files PROCEED · typecheck node+web **0** · eslint clean · S86 **16/16** · inventory+procurement+demand-trend **223/223**.

## 13. Real-Electron result

`e2e/s86ReorderDecisionReadinessJourney.e2e.cjs` written + syntax-checked. **PENDING Mac**: product (purchaseCost 4) → receive → ship (demand) → reorder decision (READY_FOR_OPERATOR_REVIEW, estimatedOrderValue 1720 = 430 × 4, requiredApprovalSteps [Manager approval], executionReadiness BLOCKED_UNDEFINED_POLICY) → deterministic regeneration → governed read → **and the critical negatives: no PR, no PO, no inventory mutation, no GL posted, execution blocked on every row.**

## 14. Tenant/RBAC/security evidence

RBAC inventory:read/manage (unit-pinned) · tenant-scoped `EnterpriseRecordStore` (isolation unit-pinned) · NO_TENANT fail-closed (unit-pinned) · reads via governed `enterprise:module.*` only · no renderer tenant · AI advisory-only.

## 15. Immutability / read-only evidence

Immutable snapshot (regeneration-in-place refused) · deterministic byte-identical regeneration · stable identity (`REORDER-DECISION-<asOf>-<n>`) · sources byte-identical after generation.

## 16. No-PR/PO/inventory/GL mutation + no-execution evidence

Unit + journey pinned: generating a decision report drafts NO purchase request, creates NO PO, mutates NO product/inventory, posts NO GL, and reaches no execution path — `executionReadiness` fail-closed on every row. The execution seam (`runReorderCheck`) is not imported/called.

## 17. Decision memos

`DECISION-MEMO-S86-REORDER-DECISION-SEMANTICS.md` (A reused / B derived / C operator-gated undefined policy incl. automatic execution).

## 18. Remaining Tier-2 gaps

Supplier selection master field + product→supplier link; tenant-configurable spend policy wiring; the governed reorder EXECUTION gate (decision → PR draft authority, operator-gated); demand→reorder-point adjustment; optional KPI/Executive-Center reorder-decision surfacing.

## 19. Status — awaiting FG-S86 token

Non-frozen decision-readiness core COMPLETE and GREEN in the Linux sandbox (16/16 focused + 223/223 sweep + typecheck + lint clean). FG-S86 gate doc presented; the 2-line `enterprise/index.ts` registration is STOPPED pending the literal token. Real-Electron journey PENDING the operator's Mac. `certification/baseline.json` untouched. Execution stays an operator-gated future gate (memo §C.3). Release track PAUSED.
