// JUL-288: compare upright person sprite direct blits against old Canvas save/translate/scale. Run locally with Chrome and hardware
// acceleration: CHROME_PATH="..." node scripts/benchmark-jul287-browser.mjs
// --duration=30000 --repeats=3 --output=reports/jul288-person-sprite-ab.json
// This cannot measure GPU completion; manually review the saved screenshots.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).filter(s => s.startsWith('--'))
  .map(s => { const at = s.indexOf('='); return [s.slice(2, at < 0 ? undefined : at), at < 0 ? '1' : s.slice(at + 1)]; }));
const port = Number(args.port || 5197);
const duration = Number(args.duration || 30000), repeats = Number(args.repeats || 3);
if (!Number.isInteger(duration) || duration < 3000 || !Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw Error('Invalid --duration or --repeats');
const output = resolve(args.output || 'reports/jul288-person-sprite-ab.json');
const base = 'http://127.0.0.1:' + port + '/';
const headless = args.headless === '1'; // Headful Chrome is necessary for hardware QA.
let sha = process.env.SOURCE_COMMIT || 'unknown';
try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = {
  schema: 1, issue: 'JUL-288', target: 'personDrawFastPath', sha, scenario: { seed: 42, world: '112x112',
    expectedPeople: 96, expectedAnimals: 24, zoom: .5, speed: 1, width: 1440, height: 900, dpr: 1 },
  method: 'Three alternating baseline/candidate pairs, 30s per capture by default; both modes keep depthCache enabled. Baseline uses personDrawFastPath=0; candidate enables optimized direct Canvas blit for eligible person sprites. Measures RAF cadence and main-thread Canvas submission, not GPU completion or Worker execution. Compare screenshots and do not equate headless SwiftShader with windowed GPU.',
  headless, platform: platform(), captures: [], errors: []
};
await mkdir(dirname(output), { recursive: true });
const server = spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
let serverLogs = '', browser;
for (const stream of [server.stdout, server.stderr]) stream.on('data', d => {
  serverLogs = (serverLogs + d.toString()).slice(-6000);
});
const percentile = (numbers, ratio) => {
  if (!numbers.length) return null;
  const sorted = numbers.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
};
const summarize = values => ({ count: values.length,
  meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
  p95Ms: percentile(values, .95), maxMs: values.length ? Math.max(...values) : null });
const mergeSamples = (target, source) => {
  for (const entry of source) target.set(entry.at, entry);
};
try {
  let ready = false;
  for (let n = 0; n < 200; n++) {
    if (server.exitCode !== null) throw Error('Vite exited: ' + serverLogs);
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 150));
  }
  if (!ready) throw Error('Vite startup failed: ' + serverLogs);
  const options = { headless, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) options.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(options);
  for (let repeat = 0; repeat < repeats; repeat++) {
    const order = repeat % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const mode of order) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(String(e)));
      await page.addInitScript(() => {
        window.__jul287LongTasks = [];
        try {
          new PerformanceObserver(entries => {
            for (const entry of entries.getEntries()) window.__jul287LongTasks.push({
              startTime: entry.startTime, duration: entry.duration
            });
          }).observe({ entryTypes: ['longtask'] });
        } catch { /* Browser does not expose long task entries. */ }
      });
      try {
        const params = new URLSearchParams({ seed: '42', profile: '1', effects: 'fixed' });
        if (mode === 'baseline') params.set('personDrawFastPath', '0');
        await page.goto(base + '?' + params, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(() => {
          const p = window.kingdomProfiler?.snapshot();
          return document.querySelector('.app')?.inert === false
            && p?.frames.samples >= 12 && p?.map.samples >= 4 && p.context?.seed === 42;
        }, null, { timeout: 150_000 });
        const environment = await page.evaluate(() => {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl');
          const debug = gl?.getExtension('WEBGL_debug_renderer_info');
          return { browser: navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
            dpr: window.devicePixelRatio, viewport: [innerWidth, innerHeight] };
        });
        const initial = await page.evaluate(() => window.kingdomProfiler.snapshot().context);
        if (initial.personDrawFastPath !== (mode !== 'baseline'))
          throw Error('Person sprite A/B switch mismatch: ' + JSON.stringify({ mode, actual: initial.personDrawFastPath }));
        if (initial.zoom !== .5 || initial.speed !== 1 || initial.worldWidth !== 112 || initial.worldHeight !== 112
            || initial.peopleTotal !== 96 || initial.animalsTotal !== 24)
          throw Error('Scenario mismatch: ' + JSON.stringify(initial));
        await page.evaluate(() => {
          window.kingdomProfiler.reset();
          window.__jul287LongTasks.length = 0;
        });
        const frames = new Map(), draws = new Map(), intervals = new Map();
        const started = Date.now();
        while (Date.now() - started < duration) {
          await page.waitForTimeout(Math.min(4500, duration - (Date.now() - started)));
          const samples = await page.evaluate(() => window.kingdomProfiler.snapshot({ includeSamples: true }).samples);
          mergeSamples(frames, samples.frames);
          mergeSamples(draws, samples.draws);
          mergeSamples(intervals, samples.frameIntervals);
        }
        const longTasks = await page.evaluate(() => window.__jul287LongTasks || []);
        const frameMs = [...intervals.values()].map(e => e.ms);
        const stages = {};
        for (const key of ['depthOrder', 'entities', 'water']) {
          stages[key] = summarize([...draws.values()].map(d => d.phases[key] || 0));
        }
        const shot = output.replace(/\.json$/i, '') + '-pair' + (repeat + 1) + '-' + mode + '.png';
        await page.locator('#world').screenshot({ path: shot });
        const capture = { repeat: repeat + 1, mode, sourceSha: sha,
          durationMs: Date.now() - started, environment, context: initial,
          frames: { ...summarize(frameMs), fps: frameMs.length
            ? 1000 / (frameMs.reduce((a, b) => a + b, 0) / frameMs.length) : null,
            over33MsPercent: frameMs.length ? 100 * frameMs.filter(x => x > 1000 / 30).length / frameMs.length : null },
          mainThreadCpu: summarize([...frames.values()].map(f => f.durationMs)),
          mapCpu: summarize([...draws.values()].map(d => d.durationMs)),
          mapStages: stages, longTasks: { countOver50Ms: longTasks.filter(x => x.duration > 50).length,
            maxMs: longTasks.length ? Math.max(...longTasks.map(x => x.duration)) : null },
          screenshot: shot, errors: pageErrors };
        report.captures.push(capture);
        console.log(JSON.stringify({ pair: repeat + 1, mode, fps: capture.frames.fps,
          frameP95: capture.frames.p95Ms, depthP95: stages.depthOrder.p95Ms,
          entityP95: stages.entities.p95Ms, waterP95: stages.water.p95Ms }));
      } catch (e) {
        report.errors.push({ pair: repeat + 1, mode, error: String(e), pageErrors });
        throw e;
      } finally { await page.close(); }
    }
  }
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
