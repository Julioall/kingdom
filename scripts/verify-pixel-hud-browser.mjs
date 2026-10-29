import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const preview = process.env.KINGDOM_BROWSER_PREVIEW === '1' || process.argv.includes('--preview');
const port = preview ? 5192 : 5181;
const directory = resolve('browser-ui-evidence', preview ? 'production' : 'development');
const base = `http://127.0.0.1:${port}/`;
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 1024, height: 768 },
  { label: 'mobile', width: 390, height: 844 },
  { label: 'small-mobile', width: 320, height: 640 },
];
await mkdir(directory, { recursive: true });
const viteArgs = preview
  ? ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
const server = spawn(process.execPath, viteArgs,
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
    page = await browser.newPage({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width <= 760 });
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
            const panelBounds = panel?.getBoundingClientRect();
            const headingBounds = heading?.getBoundingClientRect();
            const ribbonBounds = ribbon?.getBoundingClientRect();
            const title = heading?.querySelector('h2');
            return { id, color: ribbon?.dataset.ribbonColor, slices: ribbon?.children.length,
              centerHeight: ribbon?.children[1] ? Math.round(ribbon.children[1].getBoundingClientRect().height) : 0,
              headingOffset: panelBounds && headingBounds ? Math.round(headingBounds.top - panelBounds.top) : null,
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
          kingdomScrollInset: (() => {
            const panel = document.querySelector('#leftPanel').getBoundingClientRect();
            const scroll = document.querySelector('#leftPanel .panel-scroll').getBoundingClientRect();
            return { left: scroll.left - panel.left, right: panel.right - scroll.right };
          })(),
          modalPadding: ['.left-panel .panel-scroll', '#events', '#inspector', '.utility-content'].map(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
          }),
        };
      });
      scenario.sample = sample;
      assert.match(sample.calendarSkin, /paper\.(png|webp)/, 'Forja parchment calendar');
      assert.match(sample.kingdomCardSkin, /paper\.(png|webp)/, 'Kingdom cards use the Forja parchment frame');
      assert.ok(sample.worldWidth > 0 && sample.mapVisibleHeight > 200, 'live map unobstructed');
      assert.equal(sample.resourceMetricCount, 0, 'Top bar no longer shows realm resources or population totals');
      assert.equal(sample.calendarCount, 1, 'Top bar retains only the date and season');
      assert.match(sample.calendarText, /DIA\s+\d+\s+·\s+ANO\s+\d+\s*[A-ZÁÉÍÓÚ]+/);
      assert.deepEqual(sample.modalSkins.map(panel => panel.skin), ['scroll', 'scroll', 'scroll', 'scroll'],
        'Every modal uses the parchment scroll skin');
      assert.ok(sample.modalSkins.every(panel => /scroll\.(png|webp)/.test(panel.sprite)), 'Parchment scroll sprite is rendered');
      assert.deepEqual(sample.panelRibbons.map(ribbon => [ribbon.color, ribbon.slices]), [['black', 3], ['black', 3]],
        'Selection and settings modals use a three-part slate ribbon');
      assert.ok(sample.panelRibbons.every(ribbon => ribbon.titleVisible
        && new RegExp(`ribbon-${ribbon.color}-center\\.(?:png|webp)`).test(ribbon.sliceImage)),
        'Modal titles sit on the matching ribbon center');
      assert.ok(sample.panelRibbons.every(ribbon => ribbon.ribbonFillsHeading && ribbon.titleColor === 'rgb(248, 233, 194)'),
        'Modal ribbon fills its heading and keeps the title legible');
      assert.deepEqual(sample.railRibbons.map(ribbon => [ribbon.color, ribbon.slices]), [['yellow', 3], ['cyan', 3]],
        'Closed realm shortcuts use the three-part gold and blue ribbon assets');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.buttonBackground === 'none'), 'Ribbon has no second background layer');
      assert.deepEqual(sample.railRibbons.map(ribbon => ribbon.text), ['♜', '☷'], 'Closed realm ribbons show only their icon');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.closedTitleWidth === '0px'), 'Closed ribbon titles stay collapsed');
      assert.ok(sample.railRibbons.every(ribbon => new RegExp(`ribbon-${ribbon.color}-center\\.(?:png|webp)`)
        .test(ribbon.sliceImages[1])), 'Every ribbon uses its color-matched center slice');
      assert.ok(sample.railRibbons.every(ribbon => ribbon.sliceHeights[0] === ribbon.sliceHeights[2]
        && Math.abs(ribbon.sliceHeights[1] - (ribbon.sliceHeights[0] * .79 - 2)) <= 1), 'Ribbon center is 2px shorter than the previous 79% height');
      assert.ok(sample.railRibbons.every(ribbon => Number.parseFloat(ribbon.sliceGap) === 0), 'Ribbon pieces connect without gaps');
      assert.deepEqual(sample.railRibbons.map(ribbon => ribbon.label), ['Reinos', 'Crônicas'], 'Icon-only ribbons keep accessible names');
      assert.ok(sample.modalPadding.every(padding => padding.top >= 8 && padding.bottom >= 50), 'Parchment bodies keep a compact top gap and 50px bottom clearance');
      const maxInspectorWidth = viewport.width <= 760 ? (viewport.width - 65) * .8 + 1 : 307;
      assert.ok(sample.inspectorWidth <= maxInspectorWidth, 'Inspector is 20% narrower and leaves zoom controls clear');
      assert.ok(sample.kingdomScrollInset.left >= 8 && sample.kingdomScrollInset.right >= 8,
        'Kingdom scroll viewport stays inside the parchment frame');
      assert.ok(sample.panelRibbons[0].centerHeight === Math.round(50 * .79 - 2)
        && sample.panelRibbons[0].headingOffset <= 6, 'Selection ribbon uses the short center and sits higher on the parchment');
      if (viewport.width <= 760) assert.ok(sample.topbarHeight <= 100, 'Mobile HUD should leave map height available');
      scenario.checks.push('Forja sprites / map stage rendered');
      await page.screenshot({ path: resolve(directory, viewport.label + '-world.png'), timeout: 45_000 });
      const initialZoom = await page.locator('#mapZoomLevel').textContent();
      await page.locator('#mapZoomIn').click();
      await page.waitForFunction(previous => document.querySelector('#mapZoomLevel')?.textContent !== previous, initialZoom);
      const zoomedLevel = await page.locator('#mapZoomLevel').textContent();
      assert.notEqual(zoomedLevel, initialZoom, 'Zoom button changes the live map scale');
      await page.locator('#mapZoomOut').click();
      await page.waitForFunction(previous => document.querySelector('#mapZoomLevel')?.textContent === previous, initialZoom);
      await page.locator('#mapZoomReset').click();
      const dragBounds = await page.locator('.world-stage').boundingBox();
      const dragStart = { x: dragBounds.x + dragBounds.width * .58, y: dragBounds.y + dragBounds.height * .52 };
      const beforeDrag = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
      const stageScrollBeforeDrag = await page.locator('.world-stage').evaluate(stage => stage.scrollLeft);
      await page.mouse.move(dragStart.x, dragStart.y);
      await page.mouse.down();
      await page.mouse.move(dragStart.x + Math.min(56, dragBounds.width * .18), dragStart.y + Math.min(34, dragBounds.height * .12), { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const afterDrag = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
      const stageScrollAfterDrag = await page.locator('.world-stage').evaluate(stage => stage.scrollLeft);
      assert.notEqual(afterDrag, beforeDrag, 'Dragging the map redraws the world at its new camera position');
      assert.equal(stageScrollAfterDrag, stageScrollBeforeDrag, 'Dragging the map changes the camera without scrolling the playfield container');
      if (viewport.width <= 760) {
        await page.evaluate(() => {
          window.__kingdomPanPointerTypes = [];
          document.addEventListener('pointerdown', event => window.__kingdomPanPointerTypes.push(event.pointerType), true);
        });
        const touchStart = { x: dragBounds.x + dragBounds.width * .69, y: dragBounds.y + dragBounds.height * .54 };
        const beforeTouchDrag = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
        const touchSession = await page.context().newCDPSession(page);
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...touchStart }] });
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: touchStart.x + 22, y: touchStart.y + 16 }] });
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: touchStart.x + 46, y: touchStart.y + 30 }] });
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await touchSession.detach();
        await page.waitForTimeout(100);
        const afterTouchDrag = await page.locator('#world').evaluate(canvas => canvas.toDataURL());
        assert.notEqual(afterTouchDrag, beforeTouchDrag, 'Touch dragging the mobile map changes the camera');
        assert.ok(await page.evaluate(() => window.__kingdomPanPointerTypes.includes('touch')),
          'Mobile map drag reaches the camera as a touch pointer');
        scenario.checks.push('Touch drag pans the map');
      }
      await page.locator('#mapZoomReset').click();
      const knownCastlePoint = await page.evaluate(() => {
        const stage = document.querySelector('.world-stage').getBoundingClientRect();
        const zoom = 2;
        const scale = Math.min(stage.width, stage.height) / 1024 * zoom;
        return { x: stage.left + stage.width / 2 + (64.5 * 8 - 512) * scale,
          y: stage.top + stage.height / 2 + (52.5 * 8 - 512) * scale };
      });
      if (viewport.width <= 760) await page.touchscreen.tap(knownCastlePoint.x, knownCastlePoint.y);
      else await page.mouse.click(knownCastlePoint.x, knownCastlePoint.y);
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.classList.contains('is-open'));
      assert.equal((await page.locator('#inspectTitle').textContent()).trim(), 'Centro de treinamento',
        'Clicking the known seed 42 military training center opens its own construction inspector');
      await page.locator('.date-metric').click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      scenario.checks.push('Zoom, map drag and seed 42 construction selection');
      if (viewport.width <= 760) {
        await page.evaluate(() => {
          window.__kingdomPointerTypes = [];
          document.addEventListener('pointerdown', event => window.__kingdomPointerTypes.push(event.pointerType), true);
        });
        await page.locator('#kingdomsToggle').tap();
        await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
        assert.ok(await page.evaluate(() => window.__kingdomPointerTypes.includes('touch')),
          'Touch activation reaches the realm ribbon as a touch pointer');
        await page.locator('#kingdomsToggle').tap();
        await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
        scenario.checks.push('Touch opens and closes the kingdom ribbon');
      }
      await page.locator('#kingdomsToggle').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
      assert.equal(await page.locator('#leftPanel').getAttribute('aria-hidden'), 'false',
        'Keyboard activation opens the realm panel and updates accessibility state');
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      assert.equal(await page.locator('.world-stage').evaluate(stage => stage.scrollLeft), 0,
        'Keyboard ribbon toggling cannot scroll the map stage');
      scenario.checks.push('Keyboard Enter and Space open/close the kingdom ribbon');
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === false);
      assert.equal(await page.locator('#leftPanel').getAttribute('aria-hidden'), 'false');
      assert.equal(await page.locator('#leftPanel .panel-heading button').count(), 0, 'Kingdom panel has no close button');
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
        return { panelLeft: panel.left, panelRight: panel.right, stageLeft: stage.left, stageRight: stage.right,
          panelHeight: panel.height, stageHeight: stage.height,
          scrollHeight: document.querySelector('#leftPanel .panel-scroll').scrollHeight,
          clientHeight: document.querySelector('#leftPanel .panel-scroll').clientHeight };
      });
      assert.ok(kingdomsBounds.panelHeight < kingdomsBounds.stageHeight * .7, 'Two kingdoms fit in a compact parchment panel');
      assert.ok(kingdomsBounds.panelLeft >= kingdomsBounds.stageLeft && kingdomsBounds.panelRight <= kingdomsBounds.stageRight,
        'Kingdoms parchment remains inside the horizontal bounds of the playfield');
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
      assert.equal(await page.locator('.world-stage').evaluate(stage => stage.scrollLeft), 0,
        'Closing the realm panel cannot scroll the map stage');
      scenario.checks.push('Kingdom modal closes by toggling its ribbon');
      await page.locator('#journalToggle').click();
      assert.equal(await page.locator('#journal').isVisible(), true);
      assert.equal(await page.locator('#journal').getAttribute('data-ui-skin'), 'scroll');
      assert.equal(await page.locator('#journal .panel-heading button').count(), 0, 'Chronicles panel has no close button');
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
        return { panelLeft: panel.left, panelRight: panel.right, stageLeft: stage.left, stageRight: stage.right,
          panelTop: panel.top, panelBottom: panel.bottom, stageTop: stage.top, stageBottom: stage.bottom,
          contentWidth: events.clientWidth, contentScrollWidth: events.scrollWidth,
          paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom) };
      });
      scenario.journalBounds = journalBounds;
      assert.ok(journalBounds.panelLeft >= journalBounds.stageLeft && journalBounds.panelRight <= journalBounds.stageRight,
        'Chronicles parchment remains inside the horizontal bounds of the playfield: ' + JSON.stringify(journalBounds));
      assert.ok(journalBounds.panelTop >= journalBounds.stageTop && journalBounds.panelBottom <= journalBounds.stageBottom,
        'Chronicles parchment remains inside the visible playfield');
      assert.ok(journalBounds.contentScrollWidth <= journalBounds.contentWidth, 'Chronicles text wraps inside its scroll');
      assert.ok(journalBounds.paddingTop >= 50 && journalBounds.paddingBottom >= 50, 'Chronicles has at least 50px clearance at both ends');
      await page.screenshot({ path: resolve(directory, viewport.label + '-chronicles.png'), timeout: 45_000 });
      await page.locator('.date-metric').click();
      assert.equal(await page.locator('#journal').isVisible(), false);
      scenario.checks.push('Chronicles modal closes on outside click');
      await page.locator('#journalToggle').click();
      assert.equal(await page.locator('#journal').isVisible(), true);
      await page.locator('#journalToggle').click();
      assert.equal(await page.locator('#journal').isVisible(), false);
      scenario.checks.push('Chronicles modal also closes by toggling its ribbon');
      await page.locator('#settingsToggle').click();
      assert.equal(await page.locator('#settingsTray').isVisible(), true);
      assert.equal(await page.locator('#settingsTray').getAttribute('data-ui-skin'), 'scroll');
      assert.equal(await page.locator('#settingsTray .utility-heading button').count(), 0, 'Settings has no close button');
      const settingsRibbonLayout = await page.evaluate(() => {
        const panel = document.querySelector('#settingsTray');
        const ribbon = panel.querySelector('.panel-ribbon');
        return { centerHeight: Math.round(ribbon.children[1].getBoundingClientRect().height),
          headingOffset: Math.round(panel.querySelector('.utility-heading').getBoundingClientRect().top - panel.getBoundingClientRect().top) };
      });
      assert.equal(settingsRibbonLayout.centerHeight, Math.round(50 * .79 - 2), 'Settings ribbon uses the short center slice');
      assert.ok(settingsRibbonLayout.headingOffset <= 6, 'Settings ribbon sits higher on the parchment');
      await page.screenshot({ path: resolve(directory, viewport.label + '-settings.png'), timeout: 45_000 });
      await page.locator('.date-metric').click();
      assert.equal(await page.locator('#settingsTray').isVisible(), false);
      scenario.checks.push('Settings modal closes on outside click');
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
      assert.equal(await page.locator('#rightPanel .panel-heading button').count(), 0, 'Inspector has no close button');
      await page.screenshot({ path: resolve(directory, viewport.label + '-inspector.png'), timeout: 45_000 });
      await page.locator('.date-metric').click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      await page.locator('#kingdomsToggle').click();
      await page.locator('#kingdomsToggle').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      assert.equal(await page.locator('#rightPanel').getAttribute('aria-hidden'), 'true',
        'Closing Kingdoms does not reopen the prior inspector selection');
      await page.locator('#kingdomsToggle').click();
      await page.locator('.date-metric').click();
      await page.waitForFunction(() => document.querySelector('#leftPanel')?.inert === true);
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      scenario.checks.push('Kingdoms closes outside without reopening a stale inspector selection');
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
      await page.locator('.date-metric').click();
      await page.waitForFunction(() => document.querySelector('#rightPanel')?.inert === true);
      scenario.checks.push('Selection inspector uses parchment and closes on outside click');
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
