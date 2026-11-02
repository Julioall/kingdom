// JUL-288: category-level diagnosis, not an A/B speed gate.
// Run on Windows/Chrome with hardware acceleration:
// $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
// node scripts/profile-jul288-entities.mjs --duration=30000 --repeats=3
// The profiler changes timings; compare CATEGORY ranking, not FPS versus non-profiled runs.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { summarizeEntityDraws } from '../src/ui/entity-draw-probe.js';
import { platform, cpus } from 'node:os';

const opts = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--'))
  .map(arg => { const at = arg.indexOf('='); return [arg.slice(2, at < 0 ? undefined : at), at < 0 ? '1' : arg.slice(at + 1)]; }));
const duration = Number(opts.duration || 30000), repeats = Number(opts.repeats || 3), port = Number(opts.port || 5199);
if (!Number.isSafeInteger(duration) || duration < 3000 || !Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw Error('Expected --duration >= 3000 and --repeats between 1 and 10');
const output = resolve(opts.output || 'reports/jul288-entity-profiling.json');
let sha = process.env.SOURCE_COMMIT || 'unknown';
try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const report = { issue: 'JUL-288', sha, date: new Date().toISOString(),
  scenario: { seed: 42, width: 112, height: 112, people: 96, animals: 24, zoom: .5,
    speed: 1, viewport: [1440, 900], dpr: 1 },
  caveats: 'Item counts are exact; estimated times sample 1/16 synchronous main-thread Canvas calls. Excludes GPU completion, Worker CPU, and blood/ground/magic overlays outside the painter loop. Opt-in profiling distorts timing; compare categories, not FPS against non-profiled games.',
  environment: { os: platform(), cpu: cpus()[0]?.model, headless: opts.headless === '1' },
  captures: [], errors: [] };
await mkdir(dirname(output), { recursive: true });
const server = spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
let log = '', browser;
for (const stream of [server.stdout, server.stderr]) stream.on('data', d => { log = (log + d).slice(-6000); });
const merge = (map, data) => { for (const sample of data) map.set(sample.at, sample); };
const percentile = (numbers, p) => numbers.length ? numbers.toSorted((a, b) => a - b)[Math.ceil(numbers.length * p) - 1] : null;
const summarise = values => ({ count: values.length, meanMs: values.length ? values.reduce((a,b) => a+b, 0) / values.length : null,
  p95Ms: percentile(values, .95), maxMs: values.length ? Math.max(...values) : null });
try {
  let ready = false;
  for (let i=0; i<200; i++) {
    if (server.exitCode !== null) throw Error('Vite terminated: ' + log);
    try { if ((await fetch('http://127.0.0.1:' + port)).ok) { ready=true; break; } } catch {}
    await new Promise(done => setTimeout(done, 150));
  }
  if (!ready) throw Error('Vite did not start: ' + log);
  const launchOptions = { headless: opts.headless === '1', args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH))
    launchOptions.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(launchOptions);
  for (let repeat=0; repeat<repeats; repeat++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      window.__jul288Tasks = [];
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries())
            window.__jul288Tasks.push({ at: entry.startTime, ms: entry.duration });
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
    });
    try {
      await page.goto('http://127.0.0.1:' + port + '/?seed=42&profile=1&effects=fixed&entityProfile=1',
        { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const p = window.kingdomProfiler?.snapshot();
        return document.querySelector('.app')?.inert === false && p?.map?.samples >= 8
          && p?.map?.entityBreakdown?.measuredFrames >= 4;
      }, null, { timeout: 150000 });
      const environment = await page.evaluate(() => {
        const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return { browser: navigator.userAgent,
          gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
          viewport: [innerWidth, innerHeight], dpr: devicePixelRatio };
      });
      const context = await page.evaluate(() => window.kingdomProfiler.snapshot().context);
      if (context.seed !== 42 || context.zoom !== .5 || context.speed !== 1 ||
          context.worldWidth !== 112 || context.worldHeight !== 112 ||
          context.peopleTotal !== 96 || context.animalsTotal !== 24 || !context.entityProfile)
        throw Error('Unexpected benchmark setup: ' + JSON.stringify(context));
      await page.evaluate(() => {
        window.kingdomProfiler.reset();
        window.__jul288Tasks.length = 0;
      });
      const frames = new Map(), draws = new Map(), intervals = new Map();
      const started = Date.now();
      while (Date.now() - started < duration) {
        await page.waitForTimeout(Math.min(3000, Math.max(1, duration - (Date.now() - started))));
        const samples = await page.evaluate(() => window.kingdomProfiler.snapshot({ includeSamples: true }).samples);
        merge(frames, samples.frames); merge(draws, samples.draws); merge(intervals, samples.frameIntervals);
      }
      const tasks = await page.evaluate(() => window.__jul288Tasks || []);
      const drawSamples = [...draws.values()];
      const breakdown = summarizeEntityDraws(drawSamples);
      const categories = Object.entries(breakdown.categories)
        .sort((a,b) => (b[1].estimatedMsPerDraw ?? -1) - (a[1].estimatedMsPerDraw ?? -1));
      const screenshot = (output.endsWith('.json') ? output.slice(0, -5) : output) + '-run' + (repeat+1) + '.png';
      await page.locator('#world').screenshot({ path: screenshot });
      const frameMs = [...intervals.values()].map(x=>x.ms);
      const capture = { repeat: repeat+1, durationMs: Date.now()-started,
        environment, context, frame: summarise(frameMs),
        fps: frameMs.length ? 1000 / (frameMs.reduce((a,b)=>a+b, 0) / frameMs.length) : null,
        mapCpu: summarise(drawSamples.map(x=>x.durationMs)),
        entityPhaseCpu: summarise(drawSamples.map(x=>x.phases.entities || 0)),
        depthPhaseCpu: summarise(drawSamples.map(x=>x.phases.depthOrder || 0)),
        waterPhaseCpu: summarise(drawSamples.map(x=>x.phases.water || 0)),
        breakdown: { ...breakdown, categories: Object.fromEntries(categories) },
        longTasks: { over50Ms: tasks.filter(x=>x.ms>50).length,
          maxMs: tasks.length ? Math.max(...tasks.map(x=>x.ms)) : null },
        screenshot, errors };
      report.captures.push(capture);
      console.log(JSON.stringify({ repeat: repeat+1, fps: capture.fps,
        entityP95Ms: capture.entityPhaseCpu.p95Ms, topCategories: categories.slice(0,8) }, null, 2));
    } catch (e) {
      report.errors.push({ repeat: repeat+1, error: String(e), pageErrors: errors });
      throw e;
    } finally { await page.close(); }
  }
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
