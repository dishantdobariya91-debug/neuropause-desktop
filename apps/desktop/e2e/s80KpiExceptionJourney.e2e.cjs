#!/usr/bin/env node
/**
 * ERP S80 — GOVERNED KPI SNAPSHOT + EXCEPTION INTELLIGENCE, real Electron journey.
 *
 * DESIGN-FORWARD: this harness drives the LIVE path
 *   inventory below safety stock → KPI snapshot → exception → notification → Executive Center
 *   visibility → recovery clears the exception
 * through `window.neuropause.invoke` on the real app.
 *
 * ⚠ PENDING the FG-S80 live-wiring gate (frozen `ExecutiveSnapshot` field + runtimeCore capture
 * service). Until that token is applied the snapshot/exception data is not yet exposed through the
 * `enterprise:executive.snapshot` channel, so this harness is INERT (it will report the wiring gap
 * rather than pass). It is committed now as the acceptance script the FG gate's verification plan runs.
 * Run only AFTER the FG wiring lands and an alternate build exists (out-seam-s80).
 *
 * Build first:  env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s80"
 * Run:          NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s80KpiExceptionJourney.e2e.cjs
 */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ALT_MAIN = path.join(path.resolve(__dirname, '..'), 'out-seam-s80/main/index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function out(k, v) { console.log(`S80 ${k} = ${JSON.stringify(v)}`); }
function fail(m) { console.error(`S80 FAIL: ${m}`); process.exitCode = 1; throw new Error(m); }
function assert(c, m) { if (!c) fail(m); out('PASS', m); }
async function waitForLog(logs, re, ms) { const end = Date.now() + ms; for (;;) { if (re.test(logs.join(''))) return true; if (Date.now() > end) return false; await sleep(400); } }

async function main() {
  if (!fs.existsSync(ALT_MAIN)) fail(`alternate build missing: ${ALT_MAIN} (FG-S80 wiring + build required first)`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-s80-'));
  const logs = [];
  const app = await electron.launch({
    args: [ALT_MAIN, `--user-data-dir=${profile}`],
    env: { ...process.env, NP_E2E_BUILD: '', NEUROPAUSE_E2E: '', ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
    timeout: 60_000,
  });
  app.process().stdout.on('data', (d) => logs.push(String(d)));
  app.process().stderr.on('data', (d) => logs.push(String(d)));
  try {
    const win = await app.firstWindow({ timeout: 45_000 });
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    assert(fs.realpathSync(userData) === fs.realpathSync(profile), 'ISOLATED profile is the running userData');
    for (const re of [/Enterprise OS ready/, /Runtime core ready/]) assert(await waitForLog(logs, re, 30_000), `BOOT_LOG ${re}`);
    const bridge = (ch, payload) => win.evaluate(([c, p]) => window.neuropause.invoke(c, p), [ch, payload]);
    const create = (moduleId, fields) => bridge('enterprise:module.create', { moduleId, fields });
    const update = (moduleId, id, fields) => bridge('enterprise:module.update', { moduleId, id, fields });
    // The FG wiring exposes capture + kpiIntelligence on the executive snapshot; channel names below
    // are the FG proposal's — the harness asserts the wiring gap explicitly if they are absent.
    const snapshot = () => bridge('enterprise:executive.snapshot', {});

    // 1. product below its own safety stock (existing master fields)
    const p = await create('inventory-products', { sku: 'WIDGET', name: 'Widget', safetyStock: 10, currentStock: 2 });
    assert(p.ok, 'product created below safety stock');
    // 2. trigger a governed KPI capture (FG channel) — asserts the wiring gap if the capture channel is absent
    const cap = await bridge('enterprise:kpi.capture', { periodKey: new Date().toISOString().slice(0, 10) }).catch(() => null);
    assert(cap && cap.ok, 'FG-S80 capture channel present and captured (else: wiring PENDING)');
    // 3. exception visible in the Executive Center snapshot
    const snap1 = await snapshot();
    const exc = (snap1 && snap1.kpiIntelligence && snap1.kpiIntelligence.activeExceptions) || [];
    assert(exc.some((e) => e.kpiKey === 'inventory.belowSafetyStock' && e.status === 'EXCEPTION'), 'safety-stock EXCEPTION visible in Executive Center');
    // 4. recovery — raise stock above safety, re-capture, exception clears
    await update('inventory-products', p.record.id, { currentStock: 50 });
    await bridge('enterprise:kpi.capture', { periodKey: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
    const snap2 = await snapshot();
    const exc2 = (snap2 && snap2.kpiIntelligence && snap2.kpiIntelligence.activeExceptions) || [];
    assert(!exc2.some((e) => e.kpiKey === 'inventory.belowSafetyStock' && e.status === 'EXCEPTION'), 'exception RECOVERED / cleared after restock');

    out('RESULT', 'S80 KPI/exception intelligence VERIFIED in the real Electron runtime (safety-stock → snapshot → exception → Executive Center → recovery)');
  } finally {
    await Promise.race([app.close(), sleep(15_000)]).catch(() => undefined);
    try { app.process().kill('SIGKILL'); } catch { /* already dead */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
