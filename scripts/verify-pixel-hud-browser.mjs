import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('browser-ui-evidence');
const base = 'http://127.0.0.1:5181/';
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 1024, height: 768 },
  { label: 'mobile', width: 390, height: 844 },
  { label: 'small-mobile', width: 320, height: 640 },
];
await mkdir(directory, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'],
  { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', data => { serverLog += data.toString(); });
server.stderr.on('data', data => { serverLog += data.toString(); });
const findings = [];
let browser;
let page;
try {
  let started = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error('Vite exit ' + server.exitCode + ': ' + serverLog);
    try {
      if ((await fetch(base)).ok) { started = true; break; }
    } catch { /* Vite is still booting. */ }
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(started, 'Vite did not become reachable: ' + serverLog);
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox'] });
  for (const viewport of viewports) {
    page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const issues = [];
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', msg => { if (msg.type() === 'error') issues.push(msg.text()); });
    page.on('response', response => {
      if (response.status() >= 400 && /\/assets\/kingdom-ui\//.test(response.url()))
        issues.push(response.status() + ' ' + response.url());
    });
    const scenario = { viewport, errors, issues, checks: [] };
    findings.push(scenario);
    try {
      await page.goto(base + '?seed=42&paused=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // The app becomes interactive only after the simulation and visual assets load.
      await page.waitForFunction(() => document.querySelector('.app')?.inert === false,
        null, { timeout: 120_000, polling: 500 });
      const sample = await page.evaluate(() => {
        const resource = document.querySelector('.resource-metric');
        const calendar = document.querySelector('.date-metric');
        const topbar = document.querySelector('.topbar');
        const metricsStrip = document.querySelector('.world-metrics');
        const foodMetric = document.querySelector('#globalFood').closest('.metric');
        const world = document.querySelector('#world');
        return {
          resourceSkin: getComputedStyle(resource).borderImageSource,
          calendarSkin: getComputedStyle(calendar).borderImageSource,
          resourceImageRendering: getComputedStyle(resource).imageRendering,
          topbarHeight: Math.round(topbar.getBoundingClientRect().height),
          metricsLeft: Math.round(metricsStrip.getBoundingClientRect().left),
          metricsRight: Math.round(metricsStrip.getBoundingClientRect().right),
          foodLeft: Math.round(foodMetric.getBoundingClientRect().left),
          foodRight: Math.round(foodMetric.getBoundingClientRect().right),
          worldWidth: world.width,
          worldHeight: world.height,
          mapVisibleHeight: Math.round(world.getBoundingClientRect().height),
        };
      });
      scenario.sample = sample;
      assert.match(sample.resourceSkin, /wood-slot\.png/, 'Forja pixel resource frame');
      assert.match(sample.calendarSkin, /paper\.png/, 'Forja parchment calendar');
      assert.equal(sample.resourceImageRendering, 'pixelated');
      assert.ok(sample.worldWidth > 0 && sample.mapVisibleHeight > 200, 'live map unobstructed');
      assert.ok(sample.foodLeft >= sample.metricsLeft - 2 && sample.foodRight <= sample.metricsRight + 2,
        'Food metric must be visible rather than clipped at the left edge');
      if (viewport.width <= 760) assert.ok(sample.topbarHeight <= 100, 'Mobile HUD should leave map height available');
      scenario.checks.push('Forja sprites / map stage rendered');
      await page.screenshot({ path: resolve(directory, viewport.label + '-world.png'), timeout: 45_000 });
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
      assert.equal(await page.locator('#leftPanel').getAttribute('aria-hidden'), 'false');
      scenario.checks.push('Kingdom parchment panel opens and is accessible');
      await page.screenshot({ path: resolve(directory, viewport.label + '-kingdoms.png'), timeout: 45_000 });
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      scenario.checks.push('Closed panel is inert');
      await page.locator('#settingsToggle').click();
      assert.equal(await page.locator('#settingsTray').isVisible(), true);
      scenario.checks.push('Settings panel opens');
      await page.locator('#settingsToggle').click();
      // The red parchment survival alert is only temporarily exposed for a visual state snapshot.
      await page.evaluate(() => {
        document.getElementById('mapTags').classList.add('has-alert');
        document.getElementById('foodPressureTag').hidden = false;
        document.getElementById('foodRiskCount').textContent = '3';
      });
      assert.equal(await page.locator('#foodPressureTag').isVisible(), true);
      const warning = await page.locator('#foodPressureTag').boundingBox();
      const rail = await page.locator('.world-rail').boundingBox();
      assert.ok(warning.height <= 90, 'Food warning must not cover the vertical playfield');
      assert.ok(warning.x >= rail.x + rail.width - 2, 'Food warning must not overlap the realm shortcuts');
      scenario.checks.push('Food warning compact and clear of navigation');
      await page.screenshot({ path: resolve(directory, viewport.label + '-alert-preview.png'), timeout: 45_000 });
      scenario.checks.push('Critical food-warning texture displayed');
      assert.deepEqual(errors, [], 'JavaScript page errors');
      assert.ok(!issues.some(x => /\/assets\/kingdom-ui\//.test(x)), 'Missing Forja UI assets');
      await page.close(); page = undefined;
    } catch (error) {
      scenario.error = String(error);
      scenario.document = await page.evaluate(() => ({
        title: document.title,
        loading: document.getElementById('loadingMessage')?.textContent,
        loadingError: document.getElementById('loadingError')?.textContent,
        resources: document.getElementById('loadingResourceCount')?.textContent,
        appInert: document.querySelector('.app')?.inert,
        readyState: document.readyState,
        profiler: window.kingdomProfiler?.snapshot?.()?.map?.samples ?? null,
      })).catch(e => ({ evaluateFailure: String(e) }));
      await page.screenshot({ path: resolve(directory, viewport.label + '-failure.png'), timeout: 15_000 }).catch(() => {});
      console.error(viewport.label + ' ERROR:', scenario.error, JSON.stringify(scenario.document), JSON.stringify(errors));
      throw error;
    }
  }
  console.log('Kingdom HUD UI smoke passed:\n' + JSON.stringify(findings.map(f => ({ viewport:f.viewport.label,checks:f.checks,sample:f.sample,errors:f.errors })),null,2));
} catch (error) {
  console.error('Kingdom HUD UI smoke failed:', String(error));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify({ findings, serverLog: serverLog.slice(-3000) }, null, 2));
  await page?.close().catch(() => {});
  await browser?.close();
  server.kill('SIGTERM');
}
