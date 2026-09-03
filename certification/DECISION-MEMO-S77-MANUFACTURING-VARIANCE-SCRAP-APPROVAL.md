# DECISION MEMO — S77 · Manufacturing variance / scrap approval + write-off accounting

**Status:** STOPPED — awaiting operator policy. Nothing invented. Blocks ONLY the variance/scrap approval gate and the scrap write-off treatment; the operational production lifecycle and the existing variance *posting* mechanism are unaffected.

## What is defined and working (NOT blocked)

- Production order lifecycle (plan→allocate→start→complete) with BOM-driven component consumption + finished-goods output through the Inventory Ledger — GREEN (S73-G5).
- **Production cost + variance *posting* mechanism** exists and is decided — `ERP-SESSION5-PRODUCTION-VARIANCE-DECISION.md` / `ERP-SESSION5-FIX-STANDARD-COST-VARIANCE-EVIDENCE.md` (standard-cost variance settlement). That posting decision is NOT reopened here.

## What is UNDEFINED (the STOP)

1. **Variance approval threshold** — the variance magnitude above which a production variance settlement requires sign-off before it posts. Undefined.
2. **Scrap / rework write-off approval** — who authorizes writing off scrapped output/materials, and the executor≠approver SoD for it. Undefined.
3. **Scrap write-off GL treatment** — the account and rule for scrapped material/output (scrap-expense vs manufacturing-loss vs absorbed-overhead). No scrap/write-off account is defined in the canonical chart for this path.

## Exact operator inputs required

- Variance-approval threshold(s) and the approver role(s) (+ executor≠approver SoD).
- Scrap/rework write-off approver role(s) and threshold.
- Scrap write-off GL account(s) and posting rule.

## Recommendation

When supplied, gate the variance-settlement / scrap actions through the existing `approvalEngine` + document-adapter mechanism (the same one gating PO/bill — no new engine) and route the scrap write-off leg through the existing GL seam. Until then, variance/scrap approval stays absent and the scrap write-off GL leg stays unposted — fail-closed, never invented. The MES scrap/rework execution actions remain operational; only their *financial write-off approval and GL posting* are blocked.
