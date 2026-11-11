// JUL-293: deterministic, deliberately hostile scripted scenario driven by
// actual World objects, the Kingdom construction command and damageStructure.
// Some fast-forward completions/claims are injected to exercise rare events
// in a short QA run. They are test fixtures, not newly enabled gameplay rules.
import { buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { damageStructure, initializeStructureHealth } from '../../src/simulation/kingdoms/fortifications.js';
import { kingdomRelation, recomputeKingdomTerritories } from '../../src/simulation/kingdoms/territories.js';

export const WAR_STRESS_DAYS = 35;
const schedule = new Map([
  [0, ['war']],
  [1, ['build0']],
  [2, ['claim0']],
  [3, ['complete0']],
  [4, ['siege1']],
  [5, ['damageInfluence']],
  [6, ['claim1']],
  [7, ['build1']],
  [8, ['restoreInfluence']],
  [9, ['complete1']],
  [11, ['siege0']],
  [12, ['claim0']],
  [14, ['build0']],
  [15, ['complete0']],
  [17, ['siege1']],
  [18, ['moveTower']],
  [20, ['claim1']],
  [22, ['siege0']],
  [24, ['build1']],
  [25, ['complete1']],
  [27, ['damageInfluence']],
  [28, ['restoreInfluence']],
  [30, ['claim0']],
  [31, ['siege1']]
]);

function completeProject(world, kingdom) {
  const tower = world.structures.find(s => s.type === 'torre' && s.kingdomId === kingdom.id
    && s.kingdomProject && !s.complete && s.destroyedDay == null && s.integrity > 0);
  if (!tower) return { action: 'complete-project', changed: false };
  tower.progress = tower.required;
  tower.complete = true;
  tower.builtDay = world.day;
  tower.integrity = 1;
  initializeStructureHealth(tower);
  tower.health = tower.maxHealth;
  return { action: 'complete-project', changed: true, towerId: tower.id };
}

function activeTower(world, kingdom, favorNewest = false) {
  const candidates = world.structures.filter(s => s.kingdomId === kingdom.id
    && s.type === 'torre' && s.complete && s.destroyedDay == null && s.integrity > 0);
  return (favorNewest ? candidates.at(-1) : candidates[0]) || null;
}

function applyAction(world, code) {
  const [a,b] = world.kingdoms;
  if (!a || !b) throw Error('War stress requires two kingdoms.');
  if (code === 'war') {
    const relation = kingdomRelation(world, a.id, b.id);
    relation.status = 'at-war';
    relation.startedDay = world.day;
    const war = { id:world.nextId++, a:a.id, b:b.id, attackerId:a.id,
      defenderId:b.id, startedDay:world.day, status:'active',
      cause:'territory-cache synthetic siege QA' };
    world.wars.push(war);
    return { action:'declare-war', changed:true, warId:war.id };
  }
  if (code.startsWith('build')) {
    const kingdom = code.endsWith('0') ? a : b;
    // This is the real paid construction command, not a fabricated tower.
    const result = buildKingdomStructure(world, kingdom.id, 'torre');
    return { action:'build-project', kingdomId:kingdom.id, changed:result.ok,
      towerId:result.structure?.id ?? null, reason:result.ok ? null : result.reason };
  }
  if (code.startsWith('complete')) {
    const kingdom = code.endsWith('0') ? a : b;
    return completeProject(world, kingdom);
  }
  if (code.startsWith('claim')) {
    const kingdom = code.endsWith('0') ? a : b;
    const enemy = kingdom === a ? b : a;
    const claim = { id:world.nextId++, status:'annexed', ownerId:kingdom.id,
      x:(kingdom.x+enemy.x)/2, y:(kingdom.y+enemy.y)/2,
      radius:7+(world.day % 3), expiresDay:world.day+3 };
    world.territoryClaims.push(claim);
    return { action:'annexation', changed:true, claimId:claim.id, expiresDay:claim.expiresDay };
  }
  if (code.startsWith('siege')) {
    const defending = code.endsWith('0') ? a : b;
    const attacker = defending === a ? b : a;
    const tower = activeTower(world, defending, true);
    if (!tower) return { action:'siege-destroy', changed:false };
    const applied = damageStructure(world, tower, 1e6, world.day, attacker.id);
    return { action:'siege-destroy', changed:applied>0,
      towerId:tower.id, damage:applied, ownerId:defending.id };
  }
  if (code === 'damageInfluence' || code === 'restoreInfluence') {
    const tower = activeTower(world, a) || activeTower(world, b);
    if (!tower) return { action:code, changed:false };
    const next = code === 'damageInfluence' ? 0.55 : 1;
    const changed = tower.integrity !== next;
    tower.integrity = next;
    return { action:code, changed, towerId:tower.id };
  }
  if (code === 'moveTower') {
    // Stress an explicit world edit/mod. This need not be physically legal:
    // the goal is to prove the cache never reuses a stale position.
    const tower = activeTower(world, a) || activeTower(world, b);
    if (!tower) return { action:'moveTower', changed:false };
    tower.x += 1;
    return { action:'moveTower', changed:true, towerId:tower.id };
  }
  throw Error('Unknown scripted war event '+code);
}

export function applyScriptedTerritorialWarEvents(world) {
  const planned = schedule.get(world.day) || [];
  const effects = [];
  for (const code of planned) {
    effects.push(applyAction(world,code));
    // Explicitly evaluate territory at this exact causal boundary, not only
    // after the subsequent day. Siege destruction also does its own immediate
    // contextual recalc and will be safe to recompute again.
    recomputeKingdomTerritories(world);
  }
  return effects;
}
