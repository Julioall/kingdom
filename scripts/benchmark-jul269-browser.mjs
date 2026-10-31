// JUL-269 browser-only diagnostic. Does not change Kingdom source or gameplay.
// Records visible-frame metrics and Worker request/response round-trips, not GPU execution.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, platform, arch } from 'node:os';

const opts = Object.fromEntries(process.argv.slice(2).filter(s => s.startsWith('--')).map(s => s.slice(2).split('=')));
const port = Number(opts.port || 5197);
const base = 'http://127.0.0.1:' + port + '/';
const durationMs = Number(opts.duration || 3600);
const seed = Number(opts.seed || 42);
const out = resolve(opts.output || 'reports/jul269-browser-local.json');
const server = spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d.toString().slice(-3000); });
server.stderr.on('data', d => { serverLog += d.toString().slice(-3000); });
let browser;
const report = {
  schema: 1, sourceCommit: process.env.SOURCE_COMMIT || 'unknown', seed,
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version,
    browser: 'Chromium headless/SwiftShader, GitHub-hosted runner; not a player GPU' },
  methodology: 'Single tab, 1440x900 DPR1. Profile=1; sampled after 3.6 s per scenario. Worker round trip includes simulation, queueing, transport and event dispatch. The reported tileColumnBytes excludes base data. Browser FPS excludes GPU completion. Instrumentation overhead is nonzero.',
  scenarios: [], errors: []
};
try {
  let ready = false;
  for (let n = 0; n < 200; n++) {
    if (server.exitCode !== null) throw new Error('Vite exited early: ' + serverLog.slice(-2000));
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* waiting for server */ }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready) throw new Error('Vite unavailable after 30s: ' + serverLog.slice(-2000));
  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'] };
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) launchOptions.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce' });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const records = [];
    const pending = new Map();
    const maxRecords = 500;
    class ObservedWorker extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const data = event.data || {};
          const sent = pending.get(data.requestId);
          if (sent !== undefined) pending.delete(data.requestId);
          const cols = data.type === 'snapshot' ? data.snapshot?.tileColumns : null;
          const typedBytes = cols ? ['scalars','ids','types','plants']
            .reduce((sum, k) => sum + (cols[k]?.byteLength || 0), 0) : 0;
          records.push({
            type: data.type, requestId: data.requestId, epoch: data.epoch, revision: data.revision,
            durationMs: sent === undefined ? null : performance.now() - sent,
            typedBytes, tileCount: cols?.tileCount || 0
          });
          if (records.length > maxRecords) records.shift();
        });
      }
      postMessage(message, ...rest) {
        if (Number.isInteger(message?.requestId)) pending.set(message.requestId, performance.now());
        return super.postMessage(message, ...rest);
      }
    }
    window.Worker = ObservedWorker;
    window.__jul269Transport = {
      clear() { records.length = 0; },
      read() { return records.slice(); }
    };
  });
  await page.goto(base + '?seed=' + seed + '&paused=1&profile=1&effects=fixed',
    { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('.app')?.inert === false && !!window.kingdomProfiler,
    null, { timeout: 150_000, polling: 250 });
  // Do not activate local LLM or audio; only simulation, camera, and renderer are measured.
  async function measure(name, action) {
    if (action) await action();
    await page.evaluate(() => { window.kingdomProfiler.reset(); window.__jul269Transport.clear(); });
    await page.waitForTimeout(durationMs);
    const result = await page.evaluate(() => ({
      profiler: window.kingdomProfiler.snapshot(),
      transport: window.__jul269Transport.read(),
      zoomText: document.querySelector('#mapZoomLevel')?.textContent,
      simulationControl: document.querySelector('#toggle')?.textContent?.trim(),
      canvas: { width: document.querySelector('#world')?.width, height: document.querySelector('#world')?.height }
    }));
    const trips = result.transport.filter(x => x.durationMs != null).map(x => x.durationMs).sort((a,b) => a-b);
    const percentile = (a, p) => a.length ? a[Math.ceil(a.length * p) - 1] : null;
    const snapshots = result.transport.filter(x => x.type === 'snapshot');
    report.scenarios.push({
      name, zoomText: result.zoomText, simulationControl: result.simulationControl,
      canvas: result.canvas,
      frames: result.profiler.frames, map: result.profiler.map, context: result.profiler.context,
      worker: { messages: result.transport.length, snapshots: snapshots.length,
        roundTripP50Ms: percentile(trips, .5), roundTripP95Ms: percentile(trips, .95),
        maxSnapshotTileColumnBytes: Math.max(0, ...snapshots.map(x => x.typedBytes)),
        snapshotMetadata: snapshots.map(({requestId, epoch, revision, typedBytes, tileCount}) =>
          ({requestId,epoch,revision,typedBytes,tileCount})) }
    });
    if (result.profiler.frames.samples < 8 || result.profiler.map.samples < 1) {
      throw new Error('Insufficient visible frames/draws for ' + name + ': ' +
        JSON.stringify({ frames: result.profiler.frames.samples, draws: result.profiler.map.samples }));
    }
  }
  await measure('paused-fit');
  await measure('paused-zoom-200', async () => { await page.locator('#mapZoomReset').click(); });
  await measure('paused-zoom-pan', async () => {
    const map = page.locator('#world');
    const b = await map.boundingBox();
    if (b) {
      await page.mouse.move(b.x + b.width * .48, b.y + b.height * .50);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * .68, b.y + b.height * .61, { steps: 12 });
      await page.mouse.up();
    }
  });
  await measure('running-1x', async () => {
    await page.locator('#toggle').click();
  });
  if (report.scenarios.at(-1).worker.snapshots < 1) {
    report.errors.push('No recurring snapshots observed within running sample window: inspect Worker clock or increase duration; no claim about bandwidth.');
  }
  await page.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    sourceCommit: report.sourceCommit, seed: report.seed,
    scenarios: report.scenarios.map(s => ({
      name: s.name, fps: +s.frames.fps.toFixed(1),
      frameP95Ms: +s.frames.p95Ms.toFixed(1),
      mapP95Ms: +s.map.p95Ms.toFixed(1), draws: s.map.samples,
      messages: s.worker.messages, snapshots: s.worker.snapshots,
      roundTripP95Ms: s.worker.roundTripP95Ms,
      maxSnapshotTileColumnBytes: s.worker.maxSnapshotTileColumnBytes
    })), errors: report.errors
  }, null, 2));
}
