import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
  const systemChrome = process.env.CHROME_PATH
    || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '');
  const launchOptions = { headless: true, args: ['--disable-gpu-sandbox'] };
  if (systemChrome && existsSync(systemChrome)) launchOptions.executablePath = systemChrome;
  browser = await chromium.launch(launchOptions);
  for (const viewport of viewports) {
    page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const issues = [];
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', msg => {
      if (msg.type() === 'error') issues.push(msg.text() + (msg.location().url ? ' @ ' + msg.location().url : ''));
    });
    page.on('requestfailed', request => {
      issues.push('Request failed: ' + request.url() + ' (' + (request.failure()?.errorText || 'unknown') + ')');
    });
    page.on('response', response => {
      if (response.status() >= 400) issues.push(response.status() + ' ' + response.url());
    });
    const scenario = { viewport, errors, issues, checks: [] };
    findings.push(scenario);
    try {
      await page.goto(base + '?seed=42&paused=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // The app becomes interactive only after the simulation and visual assets load.
      await page.waitForFunction(() => document.querySelector('.app')?.inert === false,
        null, { timeout: 120_000, polling: 500 });
      const sample = await page.evaluate(() => {
        const calendar = document.querySelector('.date-metric');
        const topbar = document.querySelector('.topbar');
        const metricsStrip = document.querySelector('.world-metrics');
        const world = document.querySelector('#world');
        return {
          calendarSkin: getComputedStyle(calendar).borderImageSource,
          kingdomCardSkin: getComputedStyle(document.querySelector('#kingdomList .community-card')).borderImageSource,
          topbarHeight: Math.round(topbar.getBoundingClientRect().height),
          resourceMetricCount: metricsStrip.querySelectorAll(':scope > .resource-metric').length,
          calendarCount: metricsStrip.querySelectorAll(':scope > .date-metric').length,
          calendarText: calendar.textContent.trim(),
          worldWidth: world.width,
          worldHeight: world.height,
          mapVisibleHeight: Math.round(world.getBoundingClientRect().height),
          modalSkins: ['leftPanel', 'rightPanel', 'journal', 'settingsTray'].map(id => {
            const panel = document.getElementById(id);
            return { id, skin: panel?.dataset.uiSkin, sprite: getComputedStyle(panel?.querySelector(':scope > .skin-layer')).borderImageSource };
          }),
          panelRibbons: ['rightPanel', 'settingsTray'].map(id => {
            const panel = document.getElementById(id);
            const heading = panel?.querySelector(':scope > .panel-heading, :scope > .utility-heading');
            const ribbon = heading?.querySelector(':scope > .panel-ribbon');
            const headingBounds = heading?.getBoundingClientRect();
            const ribbonBounds = ribbon?.getBoundingClientRect();
            const title = heading?.querySelector('h2');
            return { id, color: ribbon?.dataset.ribbonColor, slices: ribbon?.children.length,
              title: title?.textContent.trim(), titleVisible: !!title && getComputedStyle(title).display !== 'none',
              titleColor: title && getComputedStyle(title).color,
              ribbonFillsHeading: !!headingBounds && !!ribbonBounds && Math.abs(headingBounds.left - ribbonBounds.left) < 1
                && Math.abs(headingBounds.width - ribbonBounds.width) < 1,
              sliceImage: ribbon && ribbon.children[1] ? getComputedStyle(ribbon.children[1]).backgroundImage : '' };
          }),
          railRibbons: ['kingdomsToggle', 'journalToggle'].map(id => {
            const button = document.getElementById(id);
            const ribbon = button?.querySelector(':scope > .rail-ribbon');
            return { id, color: ribbon?.dataset.ribbonColor, slices: ribbon?.children.length,
              sliceImages: ribbon ? [...ribbon.children].map(part => getComputedStyle(part).backgroundImage) : [],
              sliceHeights: ribbon ? [...ribbon.children].map(part => Math.round(part.getBoundingClientRect().height)) : [],
              sliceGap: ribbon ? getComputedStyle(ribbon).columnGap : '',
              bandWidth: ribbon ? Math.round(ribbon.getBoundingClientRect().width) : 0,
              buttonBackground: getComputedStyle(button).backgroundImage, label: button?.getAttribute('aria-label'),
              text: button?.querySelector('.rail-caption > span')?.textContent.trim(),
              closedTitleWidth: getComputedStyle(button?.querySelector('.rail-title')).maxWidth };
          }),
          inspectorWidth: Math.round(document.querySelector('#rightPanel').getBoundingClientRect().width),
          modalPadding: ['.left-panel .panel-scroll', '#events', '#inspector', '.utility-content'].map(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
          }),
        };
      });
      scenario.sample = sample;
      assert.match(sample.calendarSkin, /paper\.png/, 'Forja parchment calendar');
      assert.match(sample.kingdomCardSkin, /paper\.png/, 'Kingdom cards use the Forja parchment frame');
      assert.ok(sample.worldWidth > 0 && sample.mapVisibleHeight > 200, 'live map unobstructed');
      assert.equal(sample.resourceMetricCount, 0, 'Top bar no longer shows realm resources or population totals');
      assert.equal(sample.calendarCount, 1, 'Top bar retains only the date and season');
      assert.match(sample.calendarText, /DIA\s+\d+\s+·\s+ANO\s+\d+\s*[A-ZÁÉÍÓÚ]+/);
      assert.deepEqual(sample.modalSkins.map(panel => panel.skin), ['scroll', 'scroll', 'scroll', 'scroll'],
        'Every modal uses the parchment scroll skin');
      assert.ok(sample.modalSkins.every(panel => /scroll\.png/.test(panel.sprite)), 'Parchment scroll sprite is rendered');
      assert.deepEqual(sample.panelRibbons.map(ribbon => [ribbon.color, ribbon.slices]), [['black', 3], ['black', 3]],
        'Selection and settings modals use a three-part slate ribbon');
      assert.ok(sample.panelRibbons.every(ribbon => ribbon.titleVisible && ribbon.sliceImage.includes(`ribbon-${ribbon.color}-center.png`)),
        'Modal titles sit on the matching ribbon center');
      assert.ok(sample.panelRibbons.every(ribbon => ribbon.ribbonFillsHeading && ribbon.titleColor === 'rgb(248, 233, 194)'),
        'Modal ribbon fills its heading and keeps the title legible');
      assert.deepEqual(sample.railRibbons.map(ribbon => [ribbon.color, ribbon.slices]), [['yellow', 3], ['cyan', 3]],
        'Closed realm shortcuts use the three-part gold and blue ribbon assets');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.buttonBackground === 'none'), 'Ribbon has no second background layer');
      assert.deepEqual(sample.railRibbons.map(ribbon => ribbon.text), ['♜', '☷'], 'Closed realm ribbons show only their icon');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.closedTitleWidth === '0px'), 'Closed ribbon titles stay collapsed');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.sliceImages[1].includes(`ribbon-${ribbon.color}-center.png`)), 'Every ribbon uses its color-matched center slice');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.sliceHeights[0] === ribbon.sliceHeights[2]
        && Math.abs(ribbon.sliceHeights[1] - (ribbon.sliceHeights[0] * .79 - 2)) <= 1), 'Ribbon center is 2px shorter than the previous 79% height');
      assert.ok(sample.railRibbons.every(ribbon => Number.parseFloat(ribbon.sliceGap) === 0), 'Ribbon pieces connect without gaps');
      assert.deepEqual(sample.railRibbons.map(ribbon => ribbon.label), ['Reinos', 'Crônicas'], 'Icon-only ribbons keep accessible names');
      assert.ok(sample.modalPadding.every(padding => padding.top >= 50 && padding.bottom >= 50), 'Every parchment body has 50px top and bottom breathing room');
      const maxInspectorWidth = viewport.width <= 760 ? (viewport.width - 65) * .8 + 1 : 307;
      assert.ok(sample.inspectorWidth <= maxInspectorWidth, 'Inspector is 20% narrower and leaves zoom controls clear');
      if (viewport.width <= 760) assert.ok(sample.topbarHeight <= 100, 'Mobile HUD should leave map height available');
      scenario.checks.push('Forja sprites / map stage rendered');
      await page.screenshot({ path: resolve(directory, viewport.label + '-world.png'), timeout: 45_000 });
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
      assert.equal(await page.locator('#leftPanel').getAttribute('aria-hidden'), 'false');
      await page.waitForFunction(() => {
        const title = document.querySelector('#kingdomsToggle .rail-title');
        return title && title.getBoundingClientRect().width > 0;
      });
      assert.equal(await page.locator('#kingdomsToggle .rail-title').isVisible(), true, 'Expanded kingdoms ribbon shows its title');
      const kingdomMetrics = await page.locator('#kingdomList [data-kingdom]').evaluateAll(cards => cards.map(card =>
        [...card.querySelectorAll('[data-kingdom-stat]')].map(stat => [stat.dataset.kingdomStat, stat.querySelector('b')?.textContent.trim()])));
      assert.ok(kingdomMetrics.length > 0 && kingdomMetrics.every(stats =>
        JSON.stringify(stats.map(([key]) => key)) === JSON.stringify(['food', 'wealth', 'people', 'births', 'deaths'])
        && stats.every(([, value]) => value !== undefined && value.length > 0)),
      'Each realm card has its own food, wealth, population, births and deaths values');
      const kingdomsBounds = await page.evaluate(() => {
        const panel = document.querySelector('#leftPanel').getBoundingClientRect();
        const stage = document.querySelector('.world-stage').getBoundingClientRect();
        return { panelHeight: panel.height, stageHeight: stage.height, scrollHeight: document.querySelector('#leftPanel .panel-scroll').scrollHeight, clientHeight: document.querySelector('#leftPanel .panel-scroll').clientHeight };
      });
      assert.ok(kingdomsBounds.panelHeight < kingdomsBounds.stageHeight * .7, 'Two kingdoms fit in a compact parchment panel');
      assert.ok(kingdomsBounds.clientHeight > 0, 'Compact kingdoms panel keeps its content area available');
      await page.waitForTimeout(500);
      const kingdomsCaption = await page.evaluate(() => {
        const icon = document.querySelector('#kingdomsToggle .rail-caption > span').getBoundingClientRect();
        const title = document.querySelector('#kingdomsToggle .rail-title').getBoundingClientRect();
        return { ribbonWidth: document.querySelector('#kingdomsToggle .rail-ribbon').getBoundingClientRect().width,
          panelWidth: document.querySelector('#leftPanel').getBoundingClientRect().width, gap: title.left - icon.right };
      });
      assert.ok(kingdomsCaption.ribbonWidth > sample.railRibbons[0].bandWidth + 60, 'Kingdoms ribbon expands when opened');
      assert.ok(Math.abs(kingdomsCaption.ribbonWidth - kingdomsCaption.panelWidth) <= 1, 'Expanded kingdoms ribbon matches parchment width');
      assert.ok(kingdomsCaption.gap >= 8, 'Expanded kingdoms title is spaced from its icon');
      scenario.checks.push('Kingdom parchment panel opens and is accessible');
      await page.screenshot({ path: resolve(directory, viewport.label + '-kingdoms.png'), timeout: 45_000 });
      await page.locator('.date-metric').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      scenario.checks.push('Kingdom modal closes on outside click');
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      scenario.checks.push('Kingdom modal closes by toggling its ribbon');
      await page.locator('#journalToggle').click();
      assert.equal(await page.locator('#journal').isVisible(), true);
      assert.equal(await page.locator('#journal').getAttribute('data-ui-skin'), 'scroll');
      assert.ok(Number.parseFloat(await page.locator('#journalToggle .rail-title').evaluate(el => getComputedStyle(el).maxWidth)) > 0,
        'Expanded chronicles ribbon shows its title');
      await page.waitForTimeout(500);
      const journalCaption = await page.evaluate(() => {
        const icon = document.querySelector('#journalToggle .rail-caption > span').getBoundingClientRect();
        const title = document.querySelector('#journalToggle .rail-title').getBoundingClientRect();
        return { ribbonWidth: document.querySelector('#journalToggle .rail-ribbon').getBoundingClientRect().width,
          panelWidth: document.querySelector('#journal').getBoundingClientRect().width, gap: title.left - icon.right };
      });
      assert.ok(journalCaption.ribbonWidth > sample.railRibbons[1].bandWidth + 60, 'Chronicles ribbon expands when opened');
      assert.ok(Math.abs(journalCaption.ribbonWidth - journalCaption.panelWidth) <= 1, 'Expanded chronicles ribbon matches parchment width');
      assert.ok(journalCaption.gap >= 8, 'Expanded chronicles title is spaced from its icon');
      const journalBounds = await page.evaluate(() => {
        const panel = document.querySelector('#journal').getBoundingClientRect();
        const stage = document.querySelector('.world-stage').getBoundingClientRect();
        const events = document.querySelector('#events');
        const style = getComputedStyle(events);
        return { panelTop: panel.top, panelBottom: panel.bottom, stageTop: stage.top, stageBottom: stage.bottom,
          contentWidth: events.clientWidth, contentScrollWidth: events.scrollWidth,
          paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom) };
      });
      assert.ok(journalBounds.panelTop >= journalBounds.stageTop && journalBounds.panelBottom <= journalBounds.stageBottom,
        'Chronicles parchment remains inside the visible playfield');
      assert.ok(journalBounds.contentScrollWidth <= journalBounds.contentWidth, 'Chronicles text wraps inside its scroll');
      assert.ok(journalBounds.paddingTop >= 50 && journalBounds.paddingBottom >= 50, 'Chronicles has at least 50px clearance at both ends');
      await page.screenshot({ path: resolve(directory, viewport.label + '-chronicles.png'), timeout: 45_000 });
      await page.locator('#journalToggle').click();
      assert.equal(await page.locator('#journal').isVisible(), false);
      scenario.checks.push('Chronicles modal opens and closes by toggling its ribbon');
      await page.locator('#settingsToggle').click();
      assert.equal(await page.locator('#settingsTray').isVisible(), true);
      assert.equal(await page.locator('#settingsTray').getAttribute('data-ui-skin'), 'scroll');
      await page.locator('#settingsClose').click();
      assert.equal(await page.locator('#settingsTray').isVisible(), false);
      scenario.checks.push('Settings modal opens and closes from its close button');
      await page.locator('#kingdomsToggle').click();
      await page.locator('#kingdomList [data-kingdom]').first().click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.classList.contains('is-open'));
      assert.equal(await page.locator('#rightPanel').getAttribute('data-ui-skin'), 'scroll');
      assert.equal(await page.locator('#rightPanel .panel-ribbon').getAttribute('data-ribbon-color'), 'cyan',
        'Blue realm selection uses the blue ribbon palette');
      assert.equal(await page.locator('#inspector button').count(), 0, 'Realm cards have no action or navigation buttons');
      assert.equal(await page.locator('#inspector details').count(), 0, 'Realm cards do not list or route to construction cards');
      assert.doesNotMatch(await page.locator('#inspector').innerText(), /ordens militares|construções do reino|construção e defesa/i,
        'Realm cards stay focused on realm information');
      await page.locator('#rightClose').click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      await page.locator('#kingdomsToggle').click();
      await page.locator('#kingdomList [data-kingdom]').nth(1).click();
      assert.equal(await page.locator('#rightPanel .panel-ribbon').getAttribute('data-ribbon-color'), 'red',
        'Red realm selection uses the red ribbon palette');
      const inspectorLayout = await page.evaluate(() => {
        const panel = document.querySelector('#rightPanel').getBoundingClientRect();
        const zoom = document.querySelector('.map-zoom').getBoundingClientRect();
        return { panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, zoom: { left: zoom.left, right: zoom.right, top: zoom.top, bottom: zoom.bottom } };
      });
      const overlapsZoom = inspectorLayout.panel.left < inspectorLayout.zoom.right
        && inspectorLayout.panel.right > inspectorLayout.zoom.left
        && inspectorLayout.panel.top < inspectorLayout.zoom.bottom
        && inspectorLayout.panel.bottom > inspectorLayout.zoom.top;
      assert.equal(overlapsZoom, false, 'Inspector must leave the zoom controls unobstructed');
      await page.locator('#rightClose').click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      scenario.checks.push('Selection inspector uses parchment and its close button');
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
