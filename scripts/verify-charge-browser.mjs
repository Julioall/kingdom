import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.env.KINGDOM_IMPACT_OUTPUT || 'browser-ui-evidence/impact';
const base = process.env.KINGDOM_BROWSER_URL || 'http://127.0.0.1:5173/';
const bloodMode = process.argv.includes('--blood');
await mkdir(output, { recursive: true });
const source = `
import { createSimulationWorkerRuntime } from 'http://127.0.0.1:5173/src/simulation/worker-runtime.js';
import { createMagicBattleScenario } from 'http://127.0.0.1:5173/scripts/magic-battle-scenario.mjs';
let fixtureWorld;
const runtime=createSimulationWorkerRuntime({createWorldImpl:seed=>{
 const world=createMagicBattleScenario(seed,'none');
 const warrior=world.people.find(p=>p.militaryClass==='guerreiro');
 const archer=world.people.find(p=>p.militaryClass==='arqueiro');
 world.people=[{...warrior,id:10000,name:'Guerreiro de teste',x:50,y:52},
  ...[${bloodMode ? '51.2' : '52'},53,54].map((x,i)=>({...structuredClone(archer),id:10100+i,name:'Alvo '+(i+1),
   x,y:52,kingdomId:world.kingdoms[1].id,playerControlled:true,militaryFacingX:1}))];
 world.structures=[];world.peopleSpatialIndex=null;
 for(const p of world.people) {p.health=100;p.stamina=400;p.combatAction=null;}
 for(const k of world.kingdoms) k.memberIds=world.people.filter(p=>p.kingdomId===k.id).map(p=>p.id);
 fixtureWorld=world;return world;
}});
self.addEventListener('message',event=>{
 const response=runtime.handle(event.data);
 // Keep stationary test targets from AI dodging; only the attacker receives inputs.
 if(event.data.command?.type==='player-control'&&event.data.command.enabled)
  for(const p of fixtureWorld.people.slice(1))p.playerControlled=true;
 self.postMessage(response);
});`.replaceAll('http://127.0.0.1:5173/', base);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(source => {
    const NativeWorker = window.Worker;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    window.impactProbe = { world: null, commands: [], results: [] };
    window.Worker = class extends NativeWorker {
      constructor(path, options) {
        const simulation = String(path).includes('simulation.worker');
        super(simulation ? url : path, options);
        if (simulation) this.addEventListener('message', ({ data }) => {
          if (data.result) window.impactProbe.results.push(data.result);
          if (data.type === 'snapshot') window.impactProbe.world = data.snapshot.base;
          const world = window.impactProbe.world;
          if (world && data.type === 'player-update') {
            for (const update of data.people || (data.person ? [data.person] : [])) {
              const p = world.people.find(p => p.id === update.id); if (p) Object.assign(p, update);
            }
            if (data.magicTimeMs !== undefined) world.magicTimeMs = data.magicTimeMs;
          }
        });
      }
      postMessage(message, ...args) {
        if (message.command) window.impactProbe.commands.push(message.command);
        return super.postMessage(message, ...args);
      }
    };
  }, source);
  await page.goto(new URL('?seed=42&paused=1&profile=1', base).href);
  await page.waitForFunction(() => window.impactProbe.world && document.querySelector('.app')?.inert === false,
    null, { timeout: 120000 });
  await page.evaluate(() => window.kingdomProfiler.enable({ panel: false }));
  const screen = async (x, y) => page.evaluate(({ x, y }) => {
    const rect = document.querySelector('#world').getBoundingClientRect();
    const transform = window.kingdomProfiler.snapshot().context.cameraTransform;
    const size = 1024 / window.impactProbe.world.width;
    return { x: rect.x + (x + .5) * size * transform[0] + transform[4],
      y: rect.y + (y + .5) * size * transform[3] + transform[5] };
  }, { x, y });
  const center = await screen(52, 52);
  await page.mouse.move(center.x, center.y); await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(250);
  const actor = await screen(50, 52); await page.mouse.click(actor.x, actor.y);
  await page.locator('#world').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => window.impactProbe.world.people[0].playerControlled === true);
  await page.addStyleTag({ content: '.king-thoughts{display:none!important}' });
  await page.waitForTimeout(200);
  const target = await screen(bloodMode ? 51.2 : 52, 52); await page.mouse.move(target.x, target.y);
  await page.locator('#toggle').click(); await page.locator('#world').focus();
  await page.keyboard.press(bloodMode ? 'e' : '3');
  if (bloodMode) {
    await page.waitForFunction(() => window.impactProbe.world.people[1].health < 100);
    const hit = await page.evaluate(() => window.impactProbe.world.people[0].combatAction.hitEvents[0]);
    await page.waitForTimeout(hit.atMs + 80);
    await page.screenshot({ path: output + '/blood-hit.png' });
    await page.waitForTimeout(650);
    await page.screenshot({ path: output + '/blood-stains.png' });
    const result = await page.evaluate(() => ({
      targetHealth: window.impactProbe.world.people[1].health,
      launch: window.impactProbe.world.people[1].combatLaunch || null,
      angle: window.impactProbe.world.people[0].combatAction.angle
    }));
    assert.ok(result.targetHealth < 100); assert.equal(result.launch, null); assert.equal(errors.length, 0);
    await writeFile(output + '/blood-report.json', JSON.stringify({ ...result, errors }, null, 2));
    await page.waitForTimeout(10000);
    await page.screenshot({ path: output + '/blood-cleared.png' });
    console.log(JSON.stringify({ ...result, errors }));
    await browser.close(); process.exit(0);
  }
  try {
    await page.waitForFunction(() => window.impactProbe.world.people.filter(p => p.combatLaunch).length === 3,
      null, { timeout: 5000 });
  } catch (error) {
    console.log(await page.evaluate(() => ({ commands: window.impactProbe.commands.filter(c => c.type === 'player-action'),
      results: window.impactProbe.results.slice(-5), errors: [], people: window.impactProbe.world?.people.map(p => ({
        id:p.id,x:p.x,y:p.y,state:p.state,controlled:p.playerControlled,action:p.combatAction?.result,launch:p.combatLaunch })) })));
    await page.screenshot({ path: output + '/diagnostic.png' });
    throw error;
  }
  const contact = await page.evaluate(() => window.impactProbe.world.people[1].combatLaunch.atMs);
  await page.waitForTimeout(contact + 250);
  await page.screenshot({ path: output + '/airborne.png' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: output + '/landing.png' });
  const result = await page.evaluate(() => ({ now: window.impactProbe.world.magicTimeMs,
    targets: window.impactProbe.world.people.slice(1).map(p => ({ id: p.id, x: p.x, y: p.y,
      health: p.health, stunnedUntil: p.combatStunnedUntilMs, launch: p.combatLaunch })) }));
  assert.equal(result.targets.length, 3);
  assert.ok(result.targets.every(p => p.launch && p.stunnedUntil > result.now && p.health === 100));
  assert.ok(result.targets.every(p => !p.launch.spin));
  assert.equal(errors.length, 0);
  await writeFile(output + '/browser-report.json', JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ targets: result.targets.length, errors }));
} finally { await browser.close(); }
