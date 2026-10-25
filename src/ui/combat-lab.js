import { createCombatAction, resolveCombatAction, BODY_RADIUS, combatWeaponPoint } from '../simulation/kingdoms/combat-contact.js';
import { createAnimationRenderer, getUnitAnimation } from './animations.js';
import { militarySpritePose } from './military-sprites.js';

const $ = id => document.getElementById(id);
const canvas = $('arena'), ctx = canvas.getContext('2d'), scale = 72;
const renderer = createAnimationRenderer({ onReady: () => draw() });
let actor, target, action, elapsed = 0, playing = false, lastFrame = 0;
const text = { shield: 'Escudo interceptou', 'weapon-guard': 'Lança em guarda interceptou',
  body: 'Contato com o corpo', miss: 'Sem contato', cancelled: 'Ataque cancelado' };
function reset() {
  const scenario = $('scenario').value, weapon = $('weapon').value;
  actor = { id: 1, kingdomId: 1, alive: true, militaryClass: weapon, x: 2, y: 3,
    militaryFacingX: 1, militaryFacingY: 0 };
  target = { id: 2, kingdomId: 2, alive: true, militaryClass: scenario === 'spear' ? 'lanceiro' : 'guerreiro',
    x: weapon === 'arqueiro' ? 10 : weapon === 'lanceiro' ? 4.8 : 3.5, y: 3,
    militaryFacingX: scenario === 'rear' ? 1 : -1, militaryFacingY: 0, towerMounted: scenario === 'tower' };
  if (scenario === 'range') target.x = 12;
  const world = {};
  action = createCombatAction(world, actor, target, 1);
  if (scenario === 'dodge') target.y += 1.5;
  resolveCombatAction(world, actor, action, [target], (_, blocked) => blocked ? 3 : 10,
    { guarding: new Set(['front', 'rear', 'spear'].includes(scenario) ? [2] : []) });
  elapsed = 0; playing = false; $('time').max = Math.ceil(action.durationMs + 200);
  $('result').textContent = `${text[action.result.kind]} · ${Math.round(action.result.atMs)} ms · dano ${action.result.damageApplied || 0}\nAção ${action.id} · preparação ${action.windupMs} ms · janela ativa ${action.activeMs} ms · duração ${action.durationMs} ms\nUm contato confirmado por ação. A guarda só intercepta pela frente; a esquiva muda a posição do corpo.`;
  draw();
}
function circle(x, y, radius, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x * scale, y * scale, radius * scale, 0, Math.PI * 2); ctx.stroke();
}
function drawUnit(person, attack = false) {
  const preparing = attack && person.militaryClass === 'lanceiro' && elapsed < action.windupMs;
  const guarding = !attack && ['front', 'rear', 'spear'].includes($('scenario').value);
  const pose = militarySpritePose({ ...person, militaryAnimation: attack ? preparing ? 'defend' : 'attack' : guarding ? 'defend' : 'idle', militaryAnimationDay: 1 }, { moving: false }, 1);
  const animation = getUnitAnimation(pose.unit.folder.toLowerCase(), pose.action, attack ? 'blue' : 'red');
  const time = attack && person.militaryClass === 'lanceiro' && !preparing ? elapsed - action.windupMs : elapsed;
  renderer.draw(ctx, animation, person.x * scale, (person.y - (person.towerMounted ? 1.8 : 0)) * scale,
    { elapsedMs: time, scale: scale / 64 * .75, flipX: pose.flip, loop: !attack });
}
function draw() {
  if (!action) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#385247'; ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 0; y < canvas.height; y += scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  drawUnit(actor, elapsed < action.durationMs); drawUnit(target);
  for (const person of [actor, target]) {
    circle(person.x, person.y, .22, '#9bada2'); circle(person.x, person.y, BODY_RADIUS, '#62d7ed');
  }
  if (['front', 'rear', 'spear'].includes($('scenario').value)) circle(target.x + target.militaryFacingX * .42, target.y, target.militaryClass === 'guerreiro' ? .4 : .25, '#f2cb70');
  const end = action.windupMs + (action.flightMs || action.activeMs);
  if (elapsed >= action.windupMs && elapsed <= Math.min(end, action.result.atMs)) {
    const tip = combatWeaponPoint(action, elapsed);
    ctx.strokeStyle = '#ff8b73'; ctx.lineWidth = 4; ctx.beginPath();
    const from = action.weapon === 'arqueiro' ? combatWeaponPoint(action, Math.max(action.windupMs, elapsed - 20)) : action.origin;
    ctx.moveTo(from.x * scale, from.y * scale); ctx.lineTo(tip.x * scale, tip.y * scale); ctx.stroke();
  }
  if (action.result.point && elapsed >= action.result.atMs) circle(action.result.point.x, action.result.point.y, .1, '#fff');
  ctx.fillStyle = '#edf4e8'; ctx.font = '18px system-ui';
  ctx.fillText(elapsed < action.windupMs ? 'PREPARAÇÃO' : elapsed < end ? 'JANELA ATIVA / TRAJETÓRIA' : 'RECUPERAÇÃO', 24, 35);
  $('time').value = elapsed; $('timeValue').textContent = `${Math.round(elapsed)} ms`;
}
$('weapon').addEventListener('change', reset); $('scenario').addEventListener('change', reset);
$('time').addEventListener('input', event => { elapsed = Number(event.target.value); playing = false; draw(); });
$('play').addEventListener('click', () => { elapsed = 0; playing = true; });
function frame(now) {
  if (playing) { elapsed = Math.min(Number($('time').max), elapsed + (lastFrame ? now - lastFrame : 0)); draw(); if (elapsed >= Number($('time').max)) playing = false; }
  lastFrame = now; requestAnimationFrame(frame);
}
reset(); requestAnimationFrame(frame);
