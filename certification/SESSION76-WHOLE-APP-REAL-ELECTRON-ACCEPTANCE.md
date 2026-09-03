# SESSION 76 — WHOLE-APP REAL-ELECTRON ACCEPTANCE

**Class:** whole-app real-Electron acceptance run for the six outstanding domain journeys. No new domain, no production source change. Baseline S75 HEAD `ee220b0`. Release/notarization track PAUSED.

## Custody (verified before anything else)

- HEAD = `ee220b0` (S75 Projects) — confirmed; `ee220b0` object exists.
- No unexpected production changes since S75 (`git status` clean except the two known items below).
- `certification/baseline.json` — the pre-existing custody-protected working-tree modification (3±/3∓), **not touched by S76, never staged**.
- Untracked `.claude/` — not staged.
- No application source was modified to make any journey pass (none could be run — see below).

## THE ENVIRONMENT BLOCKER (decisive — Classification C for all six)

The six journeys require the **real NeuroPause Electron app on macOS**. This execution environment is a **Linux aarch64 sandbox** and **cannot launch Electron**, measured first-hand:

- `uname -s -m` → `Linux aarch64`.
- `apps/desktop/node_modules/electron/dist/` contains **`Electron.app`** — the **macOS** application bundle (installed for the operator's Mac), i.e. a Mach-O bundle. There is **no Linux-runnable `electron` ELF and no `chrome-sandbox`** in the dist. `playwright-core`'s `_electron.launch` therefore has no runnable binary here.
- The alternate release builds the harnesses launch (`out-seam-s73`, `out-seam-s74`, `out-seam-s75`) **do not exist in this environment**.

Consequently **no genuine Electron/UI journey can be executed here**, and the directive forbids substituting unit tests / mocked Electron / direct store or IPC calls / seeded state / privileged shortcuts. Per FAILURE DISCIPLINE this is recorded as **C — ENVIRONMENT ISSUE**, uniformly, for all six domains. It is **not** a product defect (A), not a harness defect (B) — the harnesses are syntax-valid and their governed-layer counterparts are green — and not policy (D).

## Result table

| Domain | Harness | Result | Assertions | Evidence | Classification |
|---|---|---|---|---|---|
| CRM | `e2e/s73CrmJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** (real Electron unavailable on Linux) | real-Electron: 0 run; governed-layer pin `session73CrmJourney.test.ts` 4/4 green (not the E2E journey) | harness syntax-checked; no Mac evidence yet | C — Environment |
| HR | `e2e/s73HrJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** | governed-layer `session73HrJourney.test.ts` 4/4 green | harness syntax-checked; no Mac evidence | C — Environment |
| Warehouse | `e2e/s73WarehouseJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** | governed-layer `session73WarehouseJourney.test.ts` 2/2 green | harness syntax-checked; no Mac evidence | C — Environment |
| Manufacturing | `e2e/s73ManufacturingJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** | governed-layer `session73ManufacturingJourney.test.ts` 2/2 green | harness syntax-checked; no Mac evidence | C — Environment |
| Maintenance | `e2e/s74MaintenanceJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** | governed-layer `session74MaintenanceJourney.test.ts` 4/4 green | harness syntax-checked; no Mac evidence | C — Environment |
| Projects | `e2e/s75ProjectsJourney.e2e.cjs` | **NOT RUN — ENVIRONMENT-BLOCKED** | governed-layer `session75ProjectsJourney.test.ts` 2/2 green | harness syntax-checked; no Mac evidence | C — Environment |

Governed-layer reconfirmation this session (module pins through the real secure handlers, **explicitly not the real-Electron UI journey**): 6 files / **18 assertions pass**. This proves the governed mutation paths are intact at `ee220b0`; it does **not** substitute for the real-Electron acceptance the directive requires.

## Regression (sandbox-feasible only; no S76 code change to regress)

S76 changed **no** production or test source (only this certification doc), so there is nothing new to regress; the S75 suite state stands. Governed-layer journey pins re-run green (18/18) as a drift check. The **full main suite + full UI suite + typecheck + release lint + build** are part of the Mac acceptance run alongside the six journeys (the full main suite is not runnable to completion in this constrained sandbox; it belongs on the Mac with the journeys, per prior sessions' practice).

## Operator Mac runbook (to convert PENDING → GREEN)

On the macOS host, at `ee220b0`, from `apps/desktop`:

```
# build the alternate release bundles the harnesses launch (once each, or reuse one out-seam dir)
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s73"
cp -R out-seam-s73 out-seam-s74 && cp -R out-seam-s73 out-seam-s75   # or build each
# run each journey against the real Electron app
for h in s73CrmJourney s73HrJourney s73WarehouseJourney s73ManufacturingJourney s74MaintenanceJourney s75ProjectsJourney; do
  NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node "e2e/$h.e2e.cjs"
done
```

Each harness asserts (per its `S7x PASS` lines): isolated fresh `--user-data-dir`, boot-composition logs (`Enterprise OS ready`, `Runtime core ready`), then the real-UI governed journey via `window.neuropause.invoke`, and its domain-specific business/idempotency/immutability/tenant assertions. Record each `RESULT` line + `PASS` count into this table and flip the rows to GREEN.

## Consolidated policy blockers (unchanged from S75 — operator decisions, not resolved here)

1. **D8 — Payroll** post/generatePayslips/disburse approval authority (HR).
2. **D10 — Warehouse** cycle-count / stock-adjustment variance materiality approval.
3. **Manufacturing** variance / scrap write-off approval.
4. **Maintenance cost → GL** (`DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md`).
5. **Projects cost/revenue → GL** (`DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md`).
6. **D12 — PO approve-send** authority.
7. **Bank-reconciled payment reversal** semantics (S61 flag).
8. **Session-2 posting-ownership** decision (Option A/B/C).

None resolved, none invented.

## FINAL DECISION

**REAL-ELECTRON WHOLE-APP ACCEPTANCE = PARTIAL** — 0 of 6 journeys executed; all six classified **C — ENVIRONMENT** (real Electron cannot launch in this Linux sandbox; no macOS host, no Linux electron binary, no alternate builds). The harnesses and their governed-layer counterparts are intact and green; the missing evidence is exclusively the on-Mac real-Electron run.

**WHOLE-APP ENGINEERING STATUS = PARTIAL** — all operational domains are governed-layer GREEN (CRM, HR+Expenses, Warehouse, Manufacturing, Maintenance, Projects); real-user E2E acceptance is PENDING the operator's Mac run of the six harnesses above.

**POLICY STATUS =** the eight unresolved operator decisions listed in "Consolidated policy blockers" above.

**RELEASE TRACK = PAUSED** (no notarization, no signing, no updater, no tag, no publish, no repackage).
