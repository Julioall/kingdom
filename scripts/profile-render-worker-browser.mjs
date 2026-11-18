// Separates paused Canvas/RAF cost from active Worker simulation + rendering.
// These are two independent browser workloads, NOT an A/B optimizer benchmark.
// Never conflate Worker simulationMs with main-thread RAF or GPU completion.
// node scripts/profile-render-worker-browser.mjs --duration=3500 --repeats=2
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw Error('Expected --name=value');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const integer = (key, fallback, lo, hi) => {
  const n = Number(args[key] ?? fallback);
  assert.ok(Number.isSafeInteger(n) && n >= lo && n <= hi, 'Invalid --' + key);
  return n;
};
const port = integer('port', 5341, 1024, 65535);
const durationMs = integer('duration', 3500, 2000, 8500);
const repeats = integer('repeats', 2, 1, 5);
const output = resolve(args.output ?? 'out/npc-workloads/render-worker.json');
const headful = args.headful === '1';
const npcBehaviors = String(args['npc-behaviors'] || 'legacy').split(',');
assert.ok(npcBehaviors.length >= 1 && npcBehaviors.length <= 2
  && npcBehaviors.every(mode => ['legacy', 'hybrid'].includes(mode))
  && new Set(npcBehaviors).size === npcBehaviors.length,
  'Invalid --npc-behaviors');
const url = 'http://127.0.0.1:' + port + '/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
{stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' }});
let logs = '';
for (const stream of [server.stdout, server.stderr])
  stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-4000); });
const report = {
  schemaVersion: 1, commit: process.env.GITHUB_SHA || 'local',
  host: {cpu: cpus()[0]?.model, node: process.version},
  browserMode: headful ? 'headful Chromium' : 'headless Chromium with SwiftShader',
  scenarios: [
    'renderOnly: paused simulation, RAF and Canvas remain active',
    'workerAndRender: unpaused authoritative simulation and Canvas both active'
  ],
  seed: 42, renderHz: 144, npcBehaviors, resolution: '1440x900 DPR1', durationMs, repeats,
  measurements: [], errors: [],
  caveats: [
    'RAF cadence is bounded by display/compositor cadence; renderHz=144 is a ceiling, NOT proof of 144 FPS.',
    'Headless SwiftShader cannot establish a hardware-GPU FPS target.',
    'Worker round-trip includes queueing/transport/processing; Worker simulationMs excludes captureMs.',
    'Both scenarios render the same initial seed and viewport but active world changes with time.',
    'Paused Canvas may redraw fewer layers due to caching; never subtract paused FPS from active FPS to infer Worker cost.',
    'Performance instrumentation itself incurs overhead.',
    'Legacy/hybrid comparisons are paired by seed, viewport and repeat, but different behavior may change scene contents and snapshot sizes.'
  ]
};
const summarize = values => {
  if (!values.length) return {count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null};
  const ordered = values.slice().sort((a, b) => a - b);
  return {count: values.length, meanMs: values.reduce((sum, n) => sum + n, 0) / values.length,
    p50Ms: ordered[Math.ceil(values.length * .5) - 1],
    p95Ms: ordered[Math.ceil(values.length * .95) - 1], maxMs: ordered.at(-1)};
};
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (server.exitCode !== null) throw Error('Vite exited: ' + logs);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* not ready */ }
    await new Promise(done => setTimeout(done, 150));
  }
  if (!ready) throw Error('Vite not ready: ' + logs);
  browser = await chromium.launch({headless: !headful, args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    ...(headful ? [] : ['--use-gl=angle', '--use-angle=swiftshader'])
  ]});
  for (const npcBehavior of npcBehaviors) for (let repeat = 1; repeat <= repeats; repeat++) {
    const order = repeat % 2 ? ['renderOnly', 'workerAndRender']
      : ['workerAndRender', 'renderOnly'];
    for (const mode of order) {
      const page = await browser.newPage({viewport: {width: 1440, height: 900},
        deviceScaleFactor: 1, reducedMotion: 'reduce'});
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      try {
        await page.addInitScript(() => {
          const OriginalWorker = window.Worker;
          const pending = new Map(), messages = [];
          class ObservedWorker extends OriginalWorker {
            constructor(...constructorArgs) {
              super(...constructorArgs);
              this.addEventListener('message', event => {
                const data = event.data;
                const sent = pending.get(data?.requestId);
                if (sent !== undefined) pending.delete(data.requestId);
                if (data?.workerTiming?.days > 0) {
                  messages.push({type: data.type, days: data.workerTiming.days,
                    simulationMs: data.workerTiming.simulationMs,
                    captureMs: data.workerTiming.captureMs,
                    roundTripMs: sent === undefined ? null : performance.now() - sent,
                    phases: data.workerTiming.phases});
                }
                if (messages.length > 300) messages.shift();
              });
            }
            postMessage(message, ...rest) {
              if (Number.isInteger(message?.requestId)) {
                pending.set(message.requestId, performance.now());
              }
              return super.postMessage(message, ...rest);
            }
          }
          window.Worker = ObservedWorker;
          window.__npcWorkerSamples = {
            reset() { messages.length = 0; },
            get() { return messages.slice(); }
          };
        });
        const paused = mode === 'renderOnly';
        await page.goto(url + '?seed=42&profile=1&effects=fixed&renderHz=144'
          + '&npcBehavior=' + npcBehavior
          + (paused ? '&paused=1' : ''), {waitUntil: 'domcontentloaded', timeout: 60000});
        await page.waitForFunction(() => {
          const snapshot = window.kingdomProfiler?.snapshot();
          return document.querySelector('.app')?.inert === false
            && snapshot?.frames.samples >= 12 && snapshot.context?.peopleTotal === 96
            && snapshot.context?.animalsTotal === 24;
        }, null, {timeout: 150000});
        const initial = await page.evaluate(() => window.kingdomProfiler.snapshot().context);
        assert.equal(initial.paused, paused, 'simulation pause contract');
        assert.equal(initial.npcBehavior, npcBehavior, 'requested NPC AI mode');
        for (let zoom = 0; zoom < 4; zoom++) await page.locator('#mapZoomIn').click();
        await page.waitForTimeout(650);
        await page.evaluate(() => {
          window.kingdomProfiler.reset();
          window.__npcWorkerSamples.reset();
        });
        await page.waitForTimeout(durationMs);
        const captured = await page.evaluate(() => ({
          render: window.kingdomProfiler.snapshot(),
          messages: window.__npcWorkerSamples.get()
        }));
        if (errors.length) throw Error(errors.join(' | '));
        const frames = captured.render.frames, map = captured.render.map;
        const advances = captured.messages.filter(item => item.days > 0
          && Number.isFinite(item.simulationMs));
        const record = {
          repeat, mode, npcBehavior, worldDay: captured.render.context?.day,
          render: {
            rafFps: frames.fps, frameIntervals: {
              count: frames.samples, meanMs: frames.meanMs,
              p50Ms: frames.p50Ms, p95Ms: frames.p95Ms, maxMs: frames.maxMs
            },
            mainThreadFrameMs: frames.cpu,
            mapCanvasMs: {count: map.samples, meanMs: map.meanMs,
              p95Ms: map.p95Ms, maxMs: map.maxMs},
            stageMs: Object.fromEntries(Object.entries(map.stages).map(
              ([name, values]) => [name, {meanMs: values.meanMs, p95Ms: values.p95Ms}]))
          },
          worker: {
            completedAdvances: advances.length,
            measuredDays: advances.reduce((sum, item) => sum + item.days, 0),
            simulationMs: summarize(advances.map(item => item.simulationMs)),
            snapshotCaptureMs: summarize(advances.map(item => item.captureMs)),
            roundTripMs: summarize(advances.map(item => item.roundTripMs).filter(Number.isFinite)),
            phases: advances.map(item => item.phases)
          },
          errors
        };
        report.measurements.push(record);
        console.log('NPC-RENDER-WORKER', JSON.stringify({
          repeat, mode, npcBehavior, rafFps: record.render.rafFps,
          frameP95Ms: record.render.frameIntervals.p95Ms,
          mapMeanMs: record.render.mapCanvasMs.meanMs,
          workerSimulationMeanMs: record.worker.simulationMs.meanMs,
          workerCaptureMeanMs: record.worker.snapshotCaptureMs.meanMs,
          completedAdvances: record.worker.completedAdvances
        }));
      } catch (error) {
        report.errors.push({ repeat, mode, message: String(error), browserErrors: errors });
        throw error;
      } finally {
        await page.close();
      }
    }
  }
  if (npcBehaviors.length === 2) {
    report.pairedComparisons = [];
    for (let repeat = 1; repeat <= repeats; repeat++) for (const mode of ['renderOnly', 'workerAndRender']) {
      const legacy = report.measurements.find(item => item.repeat === repeat
        && item.mode === mode && item.npcBehavior === 'legacy');
      const hybrid = report.measurements.find(item => item.repeat === repeat
        && item.mode === mode && item.npcBehavior === 'hybrid');
      if (!legacy || !hybrid) continue;
      report.pairedComparisons.push({repeat, mode,
        legacyFps: legacy.render.rafFps, hybridFps: hybrid.render.rafFps,
        legacyFrameP95Ms: legacy.render.frameIntervals.p95Ms,
        hybridFrameP95Ms: hybrid.render.frameIntervals.p95Ms,
        legacyWorkerSimulationMs: legacy.worker.simulationMs.meanMs,
        hybridWorkerSimulationMs: hybrid.worker.simulationMs.meanMs,
        legacyWorkerCaptureMs: legacy.worker.snapshotCaptureMs.meanMs,
        hybridWorkerCaptureMs: hybrid.worker.snapshotCaptureMs.meanMs});
    }
  }
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2));
}
