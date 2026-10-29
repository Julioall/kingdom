import { ANIMALS, ANIMAL_ACTIONS, DOMESTIC_SHEEP_DAILY_FEED, DOMESTIC_SHEEP_ENERGY_PER_FEED,
  PLANTS, SHEEP_ADULT_AGE_DAYS, SHEEP_FORAGE, SHEEP_NEWBORN_MASS_RATIO } from '../../config/ecosystem.js';
import { randomHabitatCell } from '../world/generation.js';
import { clamp, distance, hash01, species } from '../core/math.js';
import { rand } from '../core/random.js';
import { chooseAnimalAction, createBrain, updateBrain } from '../../controllers/individual/neural.js';
import { eatPlants, plantBiomass } from './plants.js';
import { cellAt, cellsWithin, nearby } from '../world/spatial.js';
import { resourceUsePressure } from '../world/roads.js';
import Senses from '../individuals/perception.js';
import { bestPerceivedWaterCue, nearestWater } from '../individuals/actions.js';
import { drinkWater } from './hydrology.js';
import { moveOne } from '../individuals/movement.js';
import { log } from '../core/events.js';
import { consumeStoreInventory } from '../economy/inventories.js';
import { activeCommunityPens, assignedHerdPen, herdPenRadius, reconcileCommunityHerdPens } from './herd.js';

export function seedAnimals(w, counts) {
    for (const p of ANIMALS) for (let i = 0; i < counts[p.id]; i++) {
      const t = randomHabitatCell(w, p.aquatic);
      w.animals.push(makeAnimal(w, p.id, t.x, t.y, false));
    }
  }

export function makeAnimal(w, speciesId, x, y, newborn) {
    const p = species( speciesId, ANIMALS );
    const id = w.nextId++;
    const ageDays = newborn ? 0 : Math.floor(rand(w) * p.life * .62);
    const energy = newborn ? 55 : 52 + rand(w) * 44;
    const hydration = 45 + rand(w) * 50;
    const adultMassKg = p.mass * (.6 + rand(w) * .8);
    const reproductionCooldown = newborn ? 360 : Math.floor(rand(w) * 120);
    return {
      id, speciesId, x, y, alive: true, headingX: 0, headingY: 0,
      ageDays, energy, hydration,
      massKg: adultMassKg * (speciesId === 'sheep' && newborn ? SHEEP_NEWBORN_MASS_RATIO : 1),
      ...(speciesId === 'sheep' ? { adultMassKg } : {}),
      reproductionCooldown,
      habituation: 0, herdCommunityId: null, herdPenId: null, aiEnabled: true, lastFedDay: -999, lastFeedAmount: 0, feedingEvents: 0, beingLedBy: null,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      brain: createBrain(w, ANIMAL_ACTIONS, 6, id), lastReward: 0,
      state: 'buscando alimento'
    };
  }

export function feedSheep(w, tile, amount) {
    const forageBefore = plantBiomass(tile, SHEEP_FORAGE);
    const eaten = eatPlants(w, tile, SHEEP_FORAGE, amount + .021);
    const richPasture = forageBefore >= 70;
    return { eaten, energy: eaten * (richPasture ? 16.2 : 12.4) };
  }

export function findFoodCell(w, agent, diet, radius) {
    const perceived = agent.perception && agent.perception.resources || [];
    const local = perceived.filter(resource => resource.distance <= radius && diet.some(id => (resource.biomass[id] || 0) > .8))
      .sort((a, b) => a.distance + resourceUsePressure(cellAt(w, a.x, a.y)) * 3
        - b.distance - resourceUsePressure(cellAt(w, b.x, b.y)) * 3);
    if (local.length) return cellAt(w, local[0].x, local[0].y);
    return nearby(w, agent.x, agent.y, radius, t => t.terrain !== 'water' && diet.some(id => {
      const i = PLANTS.findIndex(p => p.id === id); return i >= 0 && t.plants[i] > .8;
    }));
  }

export function nearestPrey(w, animal, profile) {
    return w.animals.filter(b => b.alive && profile.prey.includes(b.speciesId) && distance(animal, b) < 7)
      .sort((a, b) => distance(animal, a) - distance(animal, b))[0] || null;
  }

export function nearestThreat(w, animal, radius) {
    const animalThreat = w.animals.filter(b => b.alive && b.id !== animal.id && species(b.speciesId, ANIMALS).prey.includes(animal.speciesId) && distance(animal, b) <= radius);
    const humanThreat = animal.habituation < .68 ? (animal.perception && animal.perception.people || [])
      .filter(sighting => sighting.visible && sighting.distance <= radius)
      .map(sighting => w.people.find(p => p.id === sighting.id && p.alive && (p.brain.lastAction === 'hunt' || p.state.includes('caç'))))
      .filter(Boolean) : [];
    return animalThreat.concat(humanThreat).sort((a, b) => distance(animal, a) - distance(animal, b))[0] || null;
  }

export function animalFoodCell(w, animal, profile) {
    const resources = animal.perception && animal.perception.resources || [];
    const candidate = resources.filter(resource => (profile.aquatic ? resource.terrain === 'water' : resource.terrain !== 'water')
      && profile.diet.some(id => (resource.biomass[id] || 0) > .5))
      .sort((a, b) => {
        const tileA = cellAt(w, a.x, a.y), tileB = cellAt(w, b.x, b.y);
        const valueA = profile.diet.reduce((sum, id) => sum + (a.biomass[id] || 0), 0) - a.distance * 4
          - resourceUsePressure(tileA) * 28;
        const valueB = profile.diet.reduce((sum, id) => sum + (b.biomass[id] || 0), 0) - b.distance * 4
          - resourceUsePressure(tileB) * 28;
        return valueB - valueA;
      })[0];
    return candidate ? cellAt(w, candidate.x, candidate.y) : null;
  }

export function animalHabitatCell(w, animal, profile) {
    let best = null, bestScore = -Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const t = cellAt(w, animal.x + dx, animal.y + dy);
      if (!t || (profile.aquatic ? t.terrain !== 'water' : t.terrain === 'water' || t.terrain === 'rock')) continue;
      const food = plantBiomass(t, profile.aquatic ? profile.diet : SHEEP_FORAGE);
      const score = food * .004 + (t.soilWaterMm / t.soilCapacityMm) * .2 - t.slope * .12 - distance(animal, t) * .018 + rand(w) * .08;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

export function moveAwayFrom(w, animal, threat, aquatic) {
    if (!threat) return false;
    const choices = [];
    const pen = animal.speciesId === 'sheep' && animal.herdCommunityId !== null
      ? assignedHerdPen(w, animal) : null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = cellAt(w, animal.x + dx, animal.y + dy);
      if (t && (aquatic ? t.terrain === 'water' : t.terrain !== 'water' && t.terrain !== 'rock')
          && (!pen || distance(t, pen) <= herdPenRadius(pen))) choices.push(t);
    }
    choices.sort((a, b) => distance(b, threat) - distance(a, threat) + (a.slope - b.slope) * .08);
    if (!choices.length) return false;
    const next = choices[0];
    animal.headingX = next.x - animal.x; animal.headingY = next.y - animal.y;
    animal.energy = Math.max(0, animal.energy - .2);
    animal.x = next.x; animal.y = next.y; return true;
  }

function wildSheepForageCell(w, flock) {
    const center = flock.reduce((sum, sheep) => ({ x: sum.x + sheep.x / flock.length, y: sum.y + sheep.y / flock.length }),
      { x: 0, y: 0 });
    const occupied = new Map();
    for (const sheep of flock) {
      const key = Math.round(sheep.x) + ',' + Math.round(sheep.y);
      occupied.set(key, (occupied.get(key) || 0) + 1);
    }
    return cellsWithin(w, center.x, center.y, 10,
      tile => tile.terrain === 'land' && plantBiomass(tile, SHEEP_FORAGE) > .5)
      .map(tile => ({
        tile,
        score: plantBiomass(tile, SHEEP_FORAGE) - distance(center, tile) * 2
          - (occupied.get(tile.x + ',' + tile.y) || 0) * 5 - resourceUsePressure(tile) * 28
          + hash01(w.seed + flock[0].id * 101, tile.x, tile.y) * 3
      }))
      .sort((left, right) => right.score - left.score)[0]?.tile || null;
  }

function wildSheepForageTargets(w, animals) {
    const wildSheep = animals.filter(animal => animal.alive && animal.speciesId === 'sheep' && animal.herdCommunityId == null);
    const unassigned = new Set(wildSheep);
    const targets = new Map();
    for (const seed of wildSheep) {
      if (!unassigned.has(seed)) continue;
      unassigned.delete(seed);
      const flock = [seed];
      for (let index = 0; index < flock.length; index++) {
        const member = flock[index];
        for (const candidate of unassigned) {
          if (distance(member, candidate) > 8) continue;
          unassigned.delete(candidate);
          flock.push(candidate);
        }
      }
      const target = wildSheepForageCell(w, flock);
      for (const sheep of flock) targets.set(sheep.id, target);
    }
    return targets;
  }

function communalSheepWalkTarget(w, animal, pen, penTiles, occupied) {
  const options = penTiles.filter(tile => distance(tile, animal) > .5).map(tile => {
    const crowding = occupied.get(tile.x + ',' + tile.y) || 0;
    const browse = plantBiomass(tile, SHEEP_FORAGE);
    const dailyPreference = hash01(w.seed + animal.id * 101 + w.day * 7919, tile.x + pen.id, tile.y);
    const backtrackPenalty = tile.i === animal.herdPreviousPenTileIndex ? 1.2 : 0;
    return { tile, score: browse * .004 - crowding * 1.25 - distance(tile, animal) * .2
      + dailyPreference * 1.5 - backtrackPenalty };
  }).sort((left, right) => right.score - left.score || left.tile.i - right.tile.i);
  const top = options.slice(0, Math.min(4, options.length));
  if (!top.length) return null;
  const choice = Math.floor(hash01(w.seed + animal.id * 97 + w.day * 3571, pen.id, top.length) * top.length);
  return top[choice].tile;
}

export function updateAnimals(w) {
    const communityIds = new Set(w.animals.filter(animal => animal.alive && animal.speciesId === 'sheep'
      && animal.herdCommunityId != null).map(animal => animal.herdCommunityId));
    for (const communityId of communityIds) reconcileCommunityHerdPens(w, communityId);
    feedCommunalHerds(w);
    const living = w.animals.filter(a => a.alive).sort((a, b) => a.id - b.id);
    const wildSheepTargets = wildSheepForageTargets(w, living);
    for (const a of living) {
      if (!a.alive) continue;
      const p = species(a.speciesId, ANIMALS);
      a.ageDays++; a.reproductionCooldown = Math.max(0, a.reproductionCooldown - 1);
      if (a.speciesId === 'sheep') {
        a.adultMassKg ??= a.massKg || p.mass;
        const growth = clamp(a.ageDays / SHEEP_ADULT_AGE_DAYS, 0, 1);
        a.massKg = a.adultMassKg * (SHEEP_NEWBORN_MASS_RATIO + (1 - SHEEP_NEWBORN_MASS_RATIO) * growth);
      }
      if (a.beingLedBy) {
        const handler = w.people.find(person => person.id === a.beingLedBy && person.alive && person.leadingSheepId === a.id);
        if (!handler) {
          const previousHandler = w.people.find(person => person.id === a.beingLedBy);
          if (previousHandler?.leadingSheepId === a.id) {
            previousHandler.leadingSheepId = null;
            previousHandler.leadingSheepPenId = null;
          }
          a.beingLedBy = null; a.herdPenId = null; a.state = 'solta';
        }
        else { a.x = handler.x + .25; a.y = handler.y + .15; a.state = 'seguindo o condutor'; continue; }
      }
      if (a.speciesId === 'sheep' && a.herdCommunityId != null) {
        a.aiEnabled = false;
        const upkeep = .68 + p.mass * .003;
        a.energy = clamp(a.energy - upkeep, 0, 100);
        const rationEnergy = (a.lastFeedAmount || 0) * DOMESTIC_SHEEP_ENERGY_PER_FEED;
        const energyNeed = Math.max(0, upkeep - rationEnergy);
        let grazed = 0;
        let grazedOutsidePen = false;
        const pen = assignedHerdPen(w, a);
        let candidates = [];
        if (pen) {
          const penRadius = herdPenRadius(pen);
          const penTiles = cellsWithin(w, pen.x, pen.y, penRadius, tile => tile.terrain === 'land');
          const occupied = new Map();
          for (const sheep of w.animals) {
            if (!sheep.alive || sheep.id === a.id || sheep.herdCommunityId !== a.herdCommunityId) continue;
            const key = Math.round(sheep.x) + ',' + Math.round(sheep.y);
            occupied.set(key, (occupied.get(key) || 0) + 1);
          }
          candidates = penTiles.filter(tile => plantBiomass(tile, SHEEP_FORAGE) > .02)
            .sort((left, right) => {
              const score = tile => plantBiomass(tile, SHEEP_FORAGE) - distance(tile, a) * 2
                - (occupied.get(tile.x + ',' + tile.y) || 0) * 5 + hash01(w.seed + a.id * 101, tile.x, tile.y) * 3;
              return score(right) - score(left);
            });
          const destination = communalSheepWalkTarget(w, a, pen, penTiles, occupied);
          const previousTile = cellAt(w, Math.round(a.x), Math.round(a.y));
          if (destination && moveOne(w, a, destination, false) && previousTile
              && (a.x !== previousTile.x || a.y !== previousTile.y)) {
            a.herdPreviousPenTileIndex = previousTile.i;
          }
        }
        if (energyNeed > .001) {
          if (pen) {
            const penRadius = herdPenRadius(pen);
            if (!candidates.length) {
              candidates = cellsWithin(w, pen.x, pen.y, penRadius + 2,
                tile => tile.terrain === 'land' && distance(tile, pen) > penRadius
                  && plantBiomass(tile, SHEEP_FORAGE) > .02)
                .sort((left, right) => plantBiomass(right, SHEEP_FORAGE) - plantBiomass(left, SHEEP_FORAGE)
                  || distance(left, a) - distance(right, a));
              grazedOutsidePen = candidates.length > 0;
            }
            const pasture = candidates[0];
            if (pasture) {
              const browse = plantBiomass(pasture, SHEEP_FORAGE);
              const energyPerUnit = browse >= 70 ? 16.2 : 12.4;
              const result = feedSheep(w, pasture, Math.min(browse, energyNeed / energyPerUnit));
              grazed = result.eaten;
              a.energy = clamp(a.energy + result.energy, 0, 100);
            }
          }
        }
        a.lastGrazeAmount = grazed;
        a.state = grazed > .001
          ? grazedOutsidePen
            ? a.lastFeedAmount > .001 ? 'comendo ração e pastando perto do curral' : 'pastando perto do curral'
            : a.lastFeedAmount > .001 ? 'comendo ração e pastando' : 'pastando no curral'
          : a.lastFeedAmount > .001 ? 'consumindo ração do rebanho' : 'rebanho sem ração';
        if (grazed > .001) {
          a.lastFedDay = w.day;
          a.feedingEvents = (a.feedingEvents || 0) + 1;
        }
        if (a.energy <= .1 || a.ageDays > p.life) resolveAnimalDeath(w, a, p);
        continue;
      }
      a.aiEnabled = true;
      a.perception = Senses.observe(w, a, 'animal', PLANTS);
      a.energy = clamp(a.energy - (p.aquatic ? .42 : .68 + p.mass * .003), 0, 100);
      if (p.water) a.hydration = clamp(a.hydration - .48, 0, 100);
      const water = p.water ? nearestWater(w, a, 32) : null;
      const localWater = p.water ? nearestWater(w, a, 5) : null;
      const wildSheep = a.speciesId === 'sheep' && a.herdCommunityId == null;
      const flockFood = wildSheep ? wildSheepTargets.get(a.id) : null;
      const food = flockFood || animalFoodCell(w, a, p);
      const prey = p.prey.length ? nearestPrey(w, a, p) : null;
      const threat = nearestThreat(w, a, 5.5);
      const waterCue = !water && a.hydration < 62 ? bestPerceivedWaterCue(w, a) : null;
      const foodSignal = food ? clamp(1 - distance(a, food) / 5, 0, 1) : 0;
      const waterSignal = localWater ? clamp(1 - distance(a, localWater) / 5, 0, 1) : 0;
      const inputs = [
        clamp((86 - a.energy) / 86, 0, 1),
        p.water ? clamp((76 - a.hydration) / 76, 0, 1) : 0,
        foodSignal, waterSignal, threat ? 1 : 0, clamp(a.ageDays / p.life, 0, 1)
      ];
      const utilities = [
        a.energy < 94 ? .12 + inputs[0] * .2 + foodSignal * .56 : -.36,
        p.water && a.hydration < 78 && water ? .12 + inputs[1] * .78 + waterSignal * .3 : -.7,
        p.prey.length && a.energy < 88 ? .2 + (prey ? .62 : -.25) : -.52,
        a.energy < 32 ? .74 : .06,
        .22 + rand(w) * .12 + (!water && p.water && a.hydration < 68 ? .52 : 0),
        threat ? .98 : -.65
      ];
      let action = chooseAnimalAction(w, a, inputs, utilities);
      if (wildSheep) {
        action = threat ? 'flee'
          : a.hydration < 62 && water ? 'drink'
            : flockFood && distance(a, flockFood) <= 1.6 ? 'feed' : 'explore';
      }
      const here = cellAt(w, a.x, a.y);
      if (p.aquatic && here.terrain !== 'water') action = 'explore';
      const before = a.energy + (p.water ? a.hydration * .35 : 0);
      if (action === 'drink') {
        if (water && distance(a, water) <= 1.5) { drinkWater(w, a, water, 30); a.state = 'bebendo'; }
        else if (water) { moveOne(w, a, water, false); a.state = 'procurando água'; }
        else a.state = 'buscando água';
      } else if (action === 'feed') {
        if (food && distance(a, food) <= 1.6) {
          const meal = a.speciesId === 'sheep' ? feedSheep(w, food, p.food) : { eaten: eatPlants(w, food, p.diet, p.food), energy: 0 };
          const eaten = meal.eaten;
          a.energy = clamp(a.energy + (a.speciesId === 'sheep' ? meal.energy : eaten * (p.aquatic ? 19 : 10.2)), 0, 100);
          a.state = eaten > .1 ? 'alimentando-se' : 'buscando alimento';
        } else if (food) { moveOne(w, a, food, p.aquatic); a.state = 'migrando para alimento'; }
        else a.state = 'buscando alimento';
      } else if (action === 'hunt') {
        if (prey && distance(a, prey) <= 1.4 && rand(w) < .48) {
          recordAnimalDeath(w, prey, 'predation'); a.energy = clamp(a.energy + 46, 0, 100);
          const carcass = cellAt(w, prey.x, prey.y); carcass.detritusGPerM2 += species(prey.speciesId, ANIMALS).mass * 190;
          log(w, 'Uma raposa capturou uma lebre; a matéria retorna ao ciclo ecológico.');
          a.state = 'caçando';
        } else if (prey) { moveOne(w, a, prey, false); a.state = 'caçando'; }
        else a.state = 'procurando presa';
      } else if (action === 'flee') {
        moveAwayFrom(w, a, threat, p.aquatic); a.state = 'fugindo de predador';
      } else if (action === 'rest') { a.energy = clamp(a.energy + 2.1, 0, 100); a.state = 'descansando'; }
      else {
        const target = waterCue || (wildSheep ? flockFood : null) || animalHabitatCell(w, a, p);
        if (target) moveOne(w, a, target, p.aquatic);
        a.state = p.aquatic && here.terrain !== 'water' ? 'buscando água' : 'explorando';
      }
      const after = a.energy + (p.water ? a.hydration * .35 : 0);
      updateBrain(a, clamp((after - before) / 20, -.8, .8));
      if (a.energy <= .1 || (p.water && a.hydration <= .1) || a.ageDays > p.life) resolveAnimalDeath(w, a, p);
    }
    reproduceAnimals(w);
  }

function resolveAnimalDeath(w, animal, profile) {
    const cause = animal.ageDays > profile.life ? 'age'
      : profile.water && animal.hydration <= .1 ? 'dehydration' : 'starvation';
    if (!recordAnimalDeath(w, animal, cause)) return;
    const remains = cellAt(w, animal.x, animal.y);
    if (remains) remains.detritusGPerM2 += profile.mass * 170;
    if (w.deaths % 5 === 0) log(w, 'A mortalidade animal depositou biomassa no estoque de detritos.');
  }

export function recordAnimalDeath(world, animal, cause) {
    if (!world || !animal?.alive || !cause) return false;
    animal.alive = false;
    animal.deathDay = world.day + 1;
    animal.deathCause = cause;
    world.deaths = (world.deaths || 0) + 1;
    world.deathsByCause ||= {};
    world.deathsByCause[cause] = (world.deathsByCause[cause] || 0) + 1;
    return true;
  }

export function reproduceAnimals(w) {
    const bySpecies = {};
    for (const a of w.animals) if (a.alive) (bySpecies[a.speciesId] ||= []).push(a);
    for (const [id, group] of Object.entries(bySpecies)) {
      const p = species(id, ANIMALS);
      if (group.length > (id === 'fox' ? 14 : 68)) continue;
      for (const a of group) {
        if (a.reproductionCooldown > 0 || a.energy < 74 || a.ageDays < 200) continue;
        const mate = group.find(b => b.id !== a.id && b.reproductionCooldown <= 30 && b.energy > 68 && distance(a, b) < 2.1
          && (id !== 'sheep' || a.herdCommunityId === null || b.herdCommunityId === a.herdCommunityId));
        if (!mate) continue;
        const domesticatedPair = id === 'sheep' && a.herdCommunityId !== null && mate.herdCommunityId === a.herdCommunityId;
        const bothRecentlyFed = (a.feedingEvents || 0) > 0 && (mate.feedingEvents || 0) > 0
          && w.day - (a.lastFedDay === undefined ? -999 : a.lastFedDay) <= 28
          && w.day - (mate.lastFedDay === undefined ? -999 : mate.lastFedDay) <= 28;
        const conceptionChance = domesticatedPair && bothRecentlyFed ? .06 : .0022;
        if (rand(w) >= conceptionChance) continue;
        a.reproductionCooldown = mate.reproductionCooldown = id === 'hare' ? 95 : 190;
        a.energy -= 14; mate.energy -= 12;
        const offspring = makeAnimal(w, id, a.x, a.y, true);
        if (id === 'sheep') offspring.motherId = a.id;
        if (id === 'sheep' && a.herdCommunityId !== null && mate.herdCommunityId === a.herdCommunityId) {
          offspring.herdCommunityId = a.herdCommunityId;
          offspring.aiEnabled = false;
          offspring.habituation = Math.min(a.habituation || 0, mate.habituation || 0);
        }
        w.animals.push(offspring); w.births++; w.birthsByKind.animals++;
        if (id === 'sheep' && offspring.herdCommunityId != null) {
          const assigned = reconcileCommunityHerdPens(w, offspring.herdCommunityId);
          const penId = assigned.assignments.get(offspring.id);
          const pen = assigned.pens.find(item => item.id === penId);
          if (pen) {
            pen.herdBirths = (pen.herdBirths || 0) + 1;
            pen.lastHerdBirthDay = w.day + 1;
          }
        }
        break;
      }
    }
  }

export function communityHerd(w, community) {
    if (!community) return [];
    const pens = activeCommunityPens(w, community.id);
    return w.animals.filter(animal => animal.alive && animal.speciesId === 'sheep'
      && (animal.herdCommunityId === community.id
        || (pens.length
          ? pens.some(pen => distance(animal, pen) <= herdPenRadius(pen))
          : distance(animal, community) <= 5)));
  }

export function domesticatedSheep(w, community) {
    if (!community) return [];
    return w.animals.filter(animal => animal.alive && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id);
  }

export function feedCommunalHerds(w) {
    let consumed = 0;
    const flocks = new Map();
    for (const animal of w.animals.filter(item => item.alive && item.speciesId === 'sheep' && item.herdCommunityId != null).sort((a, b) => a.id - b.id)) {
      animal.aiEnabled = false; animal.lastFeedAmount = 0;
      if (!flocks.has(animal.herdCommunityId)) flocks.set(animal.herdCommunityId, []);
      flocks.get(animal.herdCommunityId).push(animal);
    }
    for (const [communityId, flock] of flocks) {
      const community = w.communities.find(group => group.id === communityId && !group.dissolved);
      if (!community || !community.stores) continue;
      const ration = Math.min(DOMESTIC_SHEEP_DAILY_FEED, Math.max(0, community.stores.feed || 0) / flock.length);
      if (ration <= .001) continue;
      const total = ration * flock.length;
      if (!consumeStoreInventory(community, { feed: total }, 'livestock-feed')) continue;
      for (const animal of flock) {
        animal.lastFeedAmount = ration;
        animal.energy = clamp(animal.energy + ration * DOMESTIC_SHEEP_ENERGY_PER_FEED, 0, 100);
        animal.habituation = clamp((animal.habituation || 0) + .002, 0, 1);
        animal.lastFedDay = w.day; animal.feedingEvents = (animal.feedingEvents || 0) + 1;
      }
      w.ecologyFlows ||= {};
      w.ecologyFlows.livestockFeedConsumed = (w.ecologyFlows.livestockFeedConsumed || 0) + total;
      consumed += total;
    }
    return consumed;
  }
