# DECISION MEMO — S77 · Cycle-count / Stock-adjustment variance approval + write-off accounting (D10)

**Status:** STOPPED — awaiting operator policy. Nothing invented. Blocks ONLY the variance-approval gate and the write-off GL treatment; the operational cycle-count/adjustment ledger movements are GREEN and unaffected.

## What is defined and working (NOT blocked)

- Cycle-count `reconcile` and stock-adjustment `post` post **signed Inventory Ledger movements** (real on-hand change, immutable, idempotent, tenant-scoped). Stock is never overwritten by a generic edit. Proven in `warehouse.test.ts` + the S73-G4 journey pin.

## What is UNDEFINED (the STOP)

1. **Variance materiality threshold** — the amount (or % variance) above which a cycle-count/adjustment requires approval before it posts. Undefined.
2. **Approver authority** — which role approves a material variance; and executor≠approver SoD for it. Undefined. (The `approvalEngine`/`DEFAULT_SPEND_POLICY` infrastructure exists and would be reused — no new engine — but no spend/approval spec is attached to `warehouse-cycle-counts` / `warehouse-adjustments` in `DOCUMENT_SPECS`.)
3. **Write-off / shrinkage GL treatment** — a negative adjustment (damage/shrinkage) currently posts to the Inventory Ledger only; whether it also books a GL journal (e.g. inventory-shrinkage / write-off expense vs COGS) and to which account is undefined. No shrinkage/write-off account exists in the canonical chart.

## Exact operator inputs required

- Variance threshold(s) (absolute and/or %) that trigger approval, per cycle-count and per stock-adjustment.
- Approver role(s) + confirmation of executor≠approver SoD.
- Write-off/shrinkage GL account(s) and the posting rule (which account is debited against the inventory credit); positive-adjustment (found-stock) treatment if different.

## Recommendation

When supplied, attach an approval spec to the two module ids in `DOCUMENT_SPECS` (reusing `approvalEngine`/the document-adapter gate — the exact mechanism that already gates PO/bill) and wire the write-off leg through the existing GL seam (`applyGlDerivedEntries`). Until then the variance-approval gate stays absent and the write-off GL leg stays unposted — fail-closed, stated honestly, never invented.
