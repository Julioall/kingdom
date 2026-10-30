import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'browser-ui-evidence/magic';
await mkdir(output, { recursive: true });
const workerSource = `
import { createSimulationWorkerRuntime } from '/src/simulation/worker-runtime.js';
import { createMagicBattleScenario } from '/scripts/magic-battle-scenario.mjs';
import { beginSpell } from '/src/simulation/magic/system.js';
import { applyMagicEffect } from '/src/simulation/magic/effects.js';
const runtime = createSimulationWorkerRuntime({ createWorldImpl: seed => {
  const world = createMagicBattleScenario(seed, 'mixed');
  for (const person of world.people.filter(person => person.id % 100 < 20)) {
    const id = ['fortitude','protection','slow','poison'][person.id % 4];
    applyMagicEffect(person,id,{now:0,durationMs:9000,intensity:id==='poison'?.008:.15,
      sourceId:10048,spellId:id,color: {fortitude:'#c4b77e',protection:'#99adbe',slow:'#687da7',poison:'#90a26d'}[id]});
  }
  const priest = world.people.find(person => person.id === 10047);
  beginSpell(world,priest,'greater-heal',{targetId:10010});
  const protector = world.people.find(person => person.id === 10048);
  beginSpell(world,protector,'sanctuary',{x:protector.x,y:protector.y});
  return world;
}});
self.addEventListener('message', event => self.postMessage(runtime.handle(event.data)));
`;
// Absolute URLs are required because the fixture worker lives in a Blob URL.
const source = workerSource.replaceAll("from '/", "from 'http://127.0.0.1:5173/");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(source => {
    const NativeWorker = window.Worker;
    const fixtureUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    window.magicProbe = { world: null, commands: [], updates: 0, maxMagicBytes: 0 };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        const simulation = String(url).includes('simulation.worker');
        super(simulation ? fixtureUrl : url, options);
        if (simulation) this.addEventListener('message', ({ data }) => {
          const probe = window.magicProbe;
          if (data.type === 'snapshot') probe.world = data.snapshot.base;
          if (data.type === 'player-update' && probe.world) {
            for (const update of data.people || (data.person ? [data.person] : [])) {
              const person = probe.world.people.find(person => person.id === update.id);
              if (person) Object.assign(person, update);
            }
            for (const key of ['magicTimeMs','magicStats','magicEvents','magicZones'])
              if (data[key] !== undefined) probe.world[key] = data[key];
            if (data.magicTimeMs !== undefined) {
              probe.updates++;
              probe.maxMagicBytes = Math.max(probe.maxMagicBytes, JSON.stringify(data).length);
            }
          }
        });
      }
      postMessage(message, ...args) {
        if (message.type === 'dispatch') window.magicProbe.commands.push(message.command.type);
        return super.postMessage(message, ...args);
      }
    };
  }, source);
  await page.goto('http://127.0.0.1:5173/?seed=42&paused=1&profile=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.app')?.inert === false && window.magicProbe.world,
    null, { timeout: 120000 });
  await page.evaluate(() => window.kingdomProfiler.enable({ panel: false }));
  const center = await page.evaluate(() => {
    const rect = document.querySelector('#world').getBoundingClientRect();
    const transform = window.kingdomProfiler.snapshot().context.cameraTransform;
    const size = 1024 / window.magicProbe.world.width;
    return { x: rect.x + 55 * size * transform[0] + transform[4],
      y: rect.y + 52 * size * transform[3] + transform[5] };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(500);
  await page.screenshot({ path: output + '/casting-100-soldiers.png' });
  await page.locator('#toggle').click();
  await page.waitForFunction(() => window.magicProbe.world.magicStats?.healing > 0,
    null, { timeout: 30000 });
  await page.evaluate(() => window.kingdomProfiler.reset());
  await page.waitForTimeout(4000);
  await page.screenshot({ path: output + '/active-battle.png' });
  const performance = await page.evaluate(() => window.kingdomProfiler.snapshot());
  const state = await page.evaluate(() => ({
    magicTimeMs: window.magicProbe.world.magicTimeMs,
    stats: window.magicProbe.world.magicStats,
    zones: window.magicProbe.world.magicZones?.length || 0,
    affected: window.magicProbe.world.people.filter(person => person.magicEffects?.length).length,
    updates: window.magicProbe.updates, maxMagicBytes: window.magicProbe.maxMagicBytes,
    soldiers: window.magicProbe.world.people.length
  }));
  assert.equal(state.soldiers, 100);
  assert.ok(state.magicTimeMs > 1000 && state.updates > 5);
  assert.ok(state.stats.healing > 0 && state.affected > 0);
  if (process.argv.includes('--visual-only')) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(250);
    await page.screenshot({ path: output + '/vfx-detail.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { state, fps: performance.frames?.fps, mapP95Ms: performance.map?.p95Ms, errors };
    await writeFile(output + '/visual-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(0);
  }
  await page.locator('#toggle').click();
  const candidates = await page.evaluate(() => {
    const world = window.magicProbe.world;
    const rect = document.querySelector('#world').getBoundingClientRect();
    const transform = window.kingdomProfiler.snapshot().context.cameraTransform;
    const size = 1024 / world.width;
    return world.people.filter(person => person.alive && person.militaryClass === 'monge' && person.mana >= 75)
      .sort((a, b) => b.mana - a.mana).map(person => ({ id: person.id, name: person.name,
        x: rect.x + (person.x + .5) * size * transform[0] + transform[4],
        y: rect.y + (person.y + .5) * size * transform[3] + transform[5] }));
  });
  let selected;
  for (const candidate of candidates) {
    await page.mouse.click(candidate.x, candidate.y);
    if (await page.locator('#inspectTitle').textContent() === candidate.name) { selected = candidate; break; }
  }
  assert.ok(selected, 'a priest must be selectable in the battle');
  assert.equal(await page.locator('[data-magic-slot]').count(), 5);
  await page.locator('[data-magic-slot="4"]').selectOption('poison');
  await page.waitForFunction(id => window.magicProbe.world.people.find(person => person.id === id)?.magicSpells?.includes('poison'), selected.id);
  await page.locator('[data-magic-role]').selectOption('healer');
  await page.waitForFunction(id => window.magicProbe.world.people.find(person => person.id === id)?.magicSpells?.[2] === 'greater-heal', selected.id);
  await page.locator('[data-magic-slot="0"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + '/priest-loadout.png' });
  await page.locator('#world').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(id => window.magicProbe.world.people.find(person => person.id === id)?.playerControlled, selected.id);
  await page.locator('#toggle').click();
  await page.waitForFunction(id => !window.magicProbe.world.people.find(person => person.id === id)?.magicCast,
    selected.id, { timeout: 10000 });
  // The autonomous priest may already have used Greater Heal before takeover.
  // Respect its real cooldown/mana instead of making this visual QA timing-dependent.
  await page.waitForFunction(id => {
    const world = window.magicProbe.world, priest = world.people.find(person => person.id === id);
    return priest?.mana >= 75 && (priest.magicCooldowns?.['greater-heal'] || 0) <= world.magicTimeMs;
  }, selected.id, { timeout: 30000 });
  await page.locator('#world').focus();
  await page.keyboard.press('3');
  await page.waitForFunction(id => window.magicProbe.world.people.find(person => person.id === id)?.magicCast?.spellId === 'greater-heal', selected.id);
  const canvasRect = await page.locator('#world').boundingBox();
  await page.mouse.move(canvasRect.x + canvasRect.width / 2, canvasRect.y + canvasRect.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(250);
  await page.screenshot({ path: output + '/manual-greater-heal.png' });
  await page.waitForFunction(id => window.magicProbe.world.magicEvents?.some(event =>
    event.kind === 'activated' && event.spellId === 'greater-heal' && event.casterId === id), selected.id, { timeout: 10000 });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(performance.context.magic.particles <= performance.context.magic.maxParticles);
  await writeFile(output + '/browser-report.json', JSON.stringify({ state, performance,
    manual: { priestId: selected.id, loadoutChanged: true, greaterHealCompleted: true }, errors }, null, 2));
  console.log(JSON.stringify({ state, fps: performance.frames?.fps, mapP95Ms: performance.map?.p95Ms, errors }, null, 2));
} finally { await browser.close(); }
