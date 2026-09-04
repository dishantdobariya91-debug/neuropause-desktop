# SESSION 91 — REORDER RECEIVING (PO → GOODS RECEIPT → INVENTORY) — CERTIFICATION

**Class:** governed receiving continuation + certification. **Outcome: the S90 reorder-originated PO enters the EXISTING governed P2P receiving path (PO approve/send → Receive Goods → Post Goods Receipt → inventory + GRNI) with ZERO production changes.** No new receiving engine, no second inventory ledger, no new approval engine, no bypass, no auto-receive. No frozen change; no FG-S91 token. Baseline S90 GREEN. Release track PAUSED.

## 1. Source-wins discovery

The receiving path already exists (S16/S23/S24) and is UI-wired; the reorder PO is a normal single-product PO that flows through it. Sources: `purchaseOrderModule.ts`, `conversion.ts` (`convertPurchaseOrderToReceipt`), `goodsReceiptModule.ts`, `inventoryGlBridge.ts`, `postMovement.ts`/`multiLineMovements.ts`, `commandBus.ts` (`PostGoodsReceipt`).

## 2. Canonical PO receiving path

`PO draft → (approve) approved → (send) sent → assign warehouse → (receiveGoods) pending GR → (PostGoodsReceipt) receive movement + Dr Inventory / Cr GRNI → inventory += qty`. Full trace + guards in DECISION-MEMO-S91 §1.

## 3. Existing commands / actions reused

`PostGoodsReceipt` (command bus, durable journal — idempotency + event + outbox + audit) is the governed economic step. PO `approve`/`send`/`receiveGoods` and GR `post` are governed module actions (`procurement:manage` + tenant + audit), UI-wired. Reused verbatim; none modified.

## 4. PO approval / send status

DEFINED: `draft → approve → approved → send → sent`; **receiving requires approved/sent** (`convertPurchaseOrderToReceipt` refuses draft/cancelled; the `post` ingress refuses a cancelled PO). No auto-approve/auto-send — each is an explicit operator action. DECISION-MEMO-S91 §3.

## 5. Goods Receipt path

PO `receiveGoods` → `convertPurchaseOrderToReceipt` creates ONE pending GR (`GR-PO-PR-REORDER-<report>-<sku>`, `purchaseOrder` = PO id, qty = PO qty), idempotent (`convertedReceipt` guard). The economic posting is the separate governed `PostGoodsReceipt`.

## 6. Quantity integrity

PO quantity preserved through PO → GR (`quantityOrdered`/`quantityReceived` = PO qty). Inventory increases ONLY when the canonical receipt is posted. Over-receipt: cumulative ≤ ordered per SKU for multi-line receipts (S16/S24); the reorder single-product path is bounded by one-GR-per-PO + one-post-per-GR + conversion-set qty (the header-only path does not cumulative-check an edited pending quantity — a recorded pre-existing characteristic, DECISION-MEMO-S91 §4, not changed here). No tolerance invented.

## 7. Inventory ledger proof

Before receipt inventory = X; after one posted receipt inventory = X + received qty; replay/restart leaves it at X + received qty (no duplicate movement). The ledger is immutable — inventory is derived from the movement ledger, never edited; the GR/PO edit doors refuse to hand-set `received` (no inventory mutation via edit). `reorderReceivingLifecycle.test.ts` inventory-safety block + the journey inventory readback.

## 8. Duplicate / replay protection

`PostGoodsReceipt` same-key replays (no second movement); distinct-key re-post refused (`received` guard, document-level idempotency); a second `receiveGoods` refused (`convertedReceipt` guard — one GR per PO). Proven.

## 9. Restart proof

Replay across a durable-journal restart does not double-post inventory (fresh journal over the same file → replay, one movement). Proven.

## 10. Tenant / security proof

`PostGoodsReceipt` requires `procurement:manage` (denied actor → `UNAUTHORIZED`, no movement); `NO_TENANT` → `UNRESOLVED_TENANT`; forged tenant → `CROSS_TENANT_CLAIM`; a foreign-tenant actor cannot see the GR → refused. Actor server-derived; AI holds no `procurement:manage` path and cannot receive/post (§13). A generic EDIT cannot set the GR/PO to `received` (edit-door fences) — no direct-status-mutation inventory bypass. The legacy action door is RBAC+tenant+audit governed and document-idempotent (DECISION-MEMO-S91 §7).

## 11. Lineage proof

recommendation → PR (`PR-REORDER-<report>-<sku>`) → PO (`PO-PR-REORDER-…`, `sourceRequest`) → GR (`GR-PO-PR-REORDER-…`, `purchaseOrder`) → movement (`referenceRecord` = GR). End-to-end, through existing fields; no second lineage system.

## 12. Side-effect proof

One valid GR; one inventory movement; canonical Dr Inventory / Cr GRNI (expected — the defined goods-receipt accounting, tested not invented); durable event + outbox + audit; complete lineage. **No** vendor invoice, no payment, no unrelated GL, no COGS, no duplicate PO, no auto-procurement/payment. `reorderReceivingLifecycle.test.ts` side-effect block + the journey.

## 13. Real-Electron result

`e2e/s91ReorderReceivingJourney.e2e.cjs` written + syntax-checked. **PENDING Mac**: product → demand → S86 → S89 confirmation → PR → Submit → Approve → Convert → PO → assign warehouse → PO Approve → Send → (draft receive refused) → Receive Goods → pending GR → (edit-door received refused) → PostGoodsReceipt → ONE receive movement, inventory 70 → 500 (+430), canonical GRNI; replay/re-post do not double-post; one GR per PO; full lineage.

## 14. UI result

No new receiving application. The existing PO detail renders Approve/Send/Receive Goods (module actions), and the GR detail renders Post Receipt (GOVERNED command). The reorder identity is visible through existing fields (`PO-PR-REORDER-…`, `sourceRequest`, `GR-PO-PR-REORDER-…`, `purchaseOrder`). **No UI change was required.** The only operator-supplied field is the receiving warehouse on the PO (DECISION-MEMO-S91 §5), an existing editable field.

## 15. Frozen-file changes

**None.** gate-detector PROCEED on all S91 files. `enterprise/index.ts`, `runtimeCore.ts`, `packages/shared`, `commandBus.ts`, the procurement/inventory modules untouched. No FG-S91 token. `certification/baseline.json` untouched. Zero production code changed.

## 16. Test totals

`reorderReceivingLifecycle.test.ts` **11/11** (happy path + lineage + GRNI, inventory-safety incl. replay + durable restart, one-GR-per-PO, status-machine negatives [draft-PO / cancelled-PO / edit-door GR / edit-door PO], security [procurement:manage / NO_TENANT / forged / cross-tenant], side-effects). Typecheck node clean; eslint clean. Procurement + inventory + command-spine regression sweep recorded on landing. Full main + UI + build + journey PENDING operator Mac.

## 17. Policy gaps (documented, not implemented)

PO approve/send governance promotion to command-bus commands + S46 fence for PO/GR consequential actions; single-product over-receipt bound; warehouse/supplier defaulting for reorder POs (deliberately operator inputs); PR/GR legacy-door fencing. Each is a future operator-gated decision (DECISION-MEMO-S91 §9); none blocks the S91 target.

## 18. Exact commits

One non-frozen commit (tests + journey + memo + cert), recorded on landing.

## 19. Final S91 status

**Reorder receiving CERTIFIED (TEST-VERIFIED 11/11; real-Electron journey PENDING Mac) with ZERO production change.** The reorder PO enters the existing governed receiving path to exactly one inventory movement + canonical GRNI, inventory += received quantity; approval-before-receive enforced; idempotent (no double-post on replay/restart); full lineage; no auto-receive, no invented policy, no bypass, no unrelated economic effects. Release track PAUSED.
