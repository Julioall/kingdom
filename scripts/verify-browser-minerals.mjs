import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = 5178;
const base = 'http://127.0.0.1:' + port + '/';
const outputDir = resolve('browser-mineral-evidence');
await mkdir(outputDir, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
let logs = '';
server.stdout.on('data', data => { logs += data.toString(); });
server.stderr.on('data', data => { logs += data.toString(); });
let browser;
const report = { seed: 42, browser: 'chromium', viewport: { width: 1280, height: 800 },
  scenarios: [], thresholdPolicy: 'informational: no machine-specific FPS gate',
  notes: 'Browser CPU/map submission and screenshots; no direct GPU completion timing.' };
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error('Vite exited: ' + server.exitCode + '\n' + logs);
    try {
      const response = await fetch(base);
      if (response.ok) { ready = true; break; }
    } catch { /* server not yet listening */ }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Dev server failed to start: ' + logs.slice(-2000));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
  for (const renderer of ['optimized', 'reference']) {
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const url = base + '?profile=1&effects=fixed&seed=42&paused=1' +
      (renderer === 'reference' ? '&render=reference' : '');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForFunction(() => {
      const snapshot = window.kingdomProfiler?.snapshot();
      const canvas = document.getElementById('world');
      return canvas?.width > 0 && canvas?.height > 0
        && snapshot?.map?.samples >= 12 && snapshot?.frames?.samples >= 12;
    }, null, { timeout: 150_000 });
    // Compare the same seed, pause state, camera zoom and viewport. The
    // unzoomed 50% view hides individual mineral deposits; zoom to the regular
    // 200% map inspection view before collecting samples.
    await page.locator('#mapZoomReset').click();
    await page.waitForFunction(() => Math.abs((window.kingdomProfiler?.snapshot()?.context?.zoom ?? 0) - 2) < .02);
    await page.evaluate(() => window.kingdomProfiler.reset());
    await page.waitForFunction(() => {
      const p = window.kingdomProfiler?.snapshot();
      return p?.map.samples >= 12 && p?.frames.samples >= 12 && p.context?.seed === 42;
    }, null, { timeout: 120_000 });
    await page.waitForTimeout(1600);
    const metrics = await page.evaluate(() => {
      const p = window.kingdomProfiler.snapshot();
      const c = document.getElementById('world');
      return { fps: p.frames.fps, frameP95Ms: p.frames.p95Ms,
        over33MsPercent: p.frames.over33MsPercent, mapP95Ms: p.map.p95Ms,
        mapMeanMs: p.map.meanMs, mapSamples: p.map.samples,
        cachedPercent: p.map.cache.hitPercent, renderer: p.context?.renderer,
        seed: p.context?.seed, canvasWidth: c.width, canvasHeight: c.height,
        snapshotContext: p.context };
    });
    if (metrics.seed !== 42 || Math.abs(metrics.snapshotContext?.zoom - 2) > .02)
      throw new Error(renderer + ': baseline seed/zoom drifted during browser capture');
    const image = resolve(outputDir, renderer + '-map.png');
    // Save the raw 2D map pixels, not an element screenshot obscured by the
    // atmospheric overlay, floating panels or profiler. Keep a separate
    // viewport screenshot for reviewing the complete browser presentation.
    const dataUrl = await page.locator('#world').evaluate(canvas => canvas.toDataURL('image/png'));
    await writeFile(image, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.screenshot({ path: resolve(outputDir, renderer + '-viewport.png'), timeout: 30_000 });
    const png = await stat(image);
    if (png.size < 6000 || !Number.isFinite(metrics.fps) || metrics.mapSamples < 1)
      throw new Error(renderer + ': canvas/profiler did not produce useful samples');
    report.scenarios.push({ label: renderer, ...metrics, screenshot: renderer + '-map.png',
      screenshotBytes: png.size, pageErrors: errors });
    await page.close();
  }
  await writeFile(resolve(outputDir, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ scenarios: report.scenarios.map(({ label, fps, frameP95Ms, mapP95Ms, cachedPercent, screenshotBytes, pageErrors }) =>
    ({ label, fps, frameP95Ms, mapP95Ms, cachedPercent, screenshotBytes, pageErrors })) }, null, 2));
} catch (error) {
  await writeFile(resolve(outputDir, 'diagnostic.json'), JSON.stringify({
    ...report, error: String(error), serverLog: logs.slice(-5000)
  }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
