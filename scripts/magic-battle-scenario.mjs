import Sim from '../src/simulation/engine.js';
import { MAGIC_ROLES } from '../src/simulation/magic/catalog.js';

// Shared reproducible fixture for the battle benchmark and browser QA only.
export function createMagicBattleScenario(seed = 42, composition = 'mixed') {
  const world = Sim.createWorld(seed);
  const templates = Object.fromEntries(['guerreiro', 'lanceiro', 'arqueiro', 'monge'].map(type =>
    [type, world.people.find(person => person.militaryClass === type)]));
  const people = [];
  for (let side = 0; side < 2; side++) {
    const kingdom = world.kingdoms[side];
    const roster = ['guerreiro', 'lanceiro', 'arqueiro'];
    for (let index = 0; index < 50; index++) {
      const priest = composition !== 'none' && index >= 46;
      const type = priest ? 'monge' : roster[index % roster.length];
      const person = structuredClone(templates[type]);
      const id = 10000 + side * 100 + index;
      const magicRole = composition === 'healers' ? 'healer' : ['healer', 'healer', 'protector', 'disruptor'][index - 46];
      Object.assign(person, { id, name: type + ' ' + id, kingdomId: kingdom.id, communityId: kingdom.communityId,
        militaryClass: type, role: 'soldier', militaryRank: 'soldado', alive: true,
        x: side ? 59 - (index % 5) * .7 : 50 + (index % 5) * .7,
        y: 48 + Math.floor(index / 5) * .7,
        health: 70, energy: 100, hydration: 100, foodReserve: 100, injury: 0,
        stamina: 400, maxStamina: 400, mana: 200, maxMana: 200,
        maxCombatHealth: { guerreiro: 360, lanceiro: 300, arqueiro: 220, monge: 240 }[type],
        campaignId: null, restingStructureId: null, militaryRestTargetId: null,
        towerMounted: false, towerDutyId: null, playerControlled: false, playerCommand: null,
        combatAction: null, combatCombo: null, combatDefense: null, magicEffects: [], magicCast: null,
        magicRole, magicSpells: priest ? MAGIC_ROLES[magicRole].slice() : undefined,
        militaryFacingX: side ? -1 : 1, militaryFacingY: 0 });
      people.push(person);
    }
    kingdom.memberIds = people.filter(person => person.kingdomId === kingdom.id).map(person => person.id);
    const community = world.communities.find(item => item.id === kingdom.communityId);
    community.memberIds = kingdom.memberIds.slice();
  }
  for (let y = 44; y <= 60; y++) for (let x = 45; x <= 65; x++) {
    const tile = world.tiles[y * world.width + x];
    tile.terrain = 'land'; tile.waterKind = undefined; tile.elevationLevel = 0; tile.slope = 0;
    tile.plants.fill(0);
    for (const key of ['stoneDeposit', 'goldOre', 'silverOre', 'copperOre', 'ironOre']) tile[key] = 0;
  }
  world.people = people; world.peopleSpatialIndex = null;
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  world.combatEvents = []; world.combatSequence = 0;
  world.magicTimeMs = 0; world.magicEvents = []; world.magicZones = [];
  return world;
}
