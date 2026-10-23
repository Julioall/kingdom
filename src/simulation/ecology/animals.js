import { ANIMALS, ANIMAL_ACTIONS, DOMESTIC_SHEEP_DAILY_FEED, DOMESTIC_SHEEP_ENERGY_PER_FEED, PLANTS, SHEEP_FORAGE } from '../../config/ecosystem.js';
import { randomHabitatCell } from '../world/generation.js';
import { clamp, distance, species } from '../core/math.js';
import { rand } from '../core/random.js';
import { chooseAnimalAction, createBrain, updateBrain } from '../../controllers/individual/neural.js';
import { eatPlants, plantBiomass } from './plants.js';
import { cellAt, nearby } from '../world/spatial.js';
import Senses from '../individuals/perception.js';
import { bestPerceivedWaterCue, nearestWater } from '../individuals/actions.js';
import { drinkWater } from './hydrology.js';
import { moveOne } from '../individuals/movement.js';
import { log } from '../core/events.js';

export function seedAnimals(w, counts) {
    for (const p of ANIMALS) for (let i = 0; i < counts[p.id]; i++) {
      const t = randomHabitatCell(w, p.aquatic);
      w.animals.push(makeAnimal(w, p.id, t.x, t.y, false));
    }
  }

export function makeAnimal(w, speciesId, x, y, newborn) {
    const p = species( speciesId, ANIMALS );
    const id = w.nextId++;
    return {
      id, speciesId, x, y, alive: true, headingX: 0, headingY: 0,
      ageDays: newborn ? 0 : Math.floor(rand(w) * p.life * .62),
      energy: newborn ? 55 : 52 + rand(w) * 44, hydration: 45 + rand(w) * 50,
      massKg: p.mass * (.6 + rand(w) * .8), reproductionCooldown: newborn ? 360 : Math.floor(rand(w) * 120),
      habituation: 0, herdCommunityId: null, aiEnabled: true, lastFedDay: -999, lastFeedAmount: 0, feedingEvents: 0, beingLedBy: null,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      brain: createBrain(w, ANIMAL_ACTIONS, 6, id), lastReward: 0,
      state: 'buscando alimento'
    };
  }

export function feedSheep(w, tile, amount) {
    const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
    const browseBefore = tile.plants[browseIndex];
    const browseEaten = eatPlants(w, tile, ['browse'], amount);
    const largeBush = browseBefore >= 70;
    return { eaten: browseEaten, energy: browseEaten * (largeBush ? 16.2 : 12.4) };
  }

export function findFoodCell(w, agent, diet, radius) {
    const perceived = agent.perception && agent.perception.resources || [];
    const local = perceived.filter(resource => resource.distance <= radius && diet.some(id => (resource.biomass[id] || 0) > .8))
      .sort((a, b) => a.distance - b.distance);
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
        const valueA = profile.diet.reduce((sum, id) => sum + (a.biomass[id] || 0), 0) - a.distance * 4;
        const valueB = profile.diet.reduce((sum, id) => sum + (b.biomass[id] || 0), 0) - b.distance * 4;
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
      ? w.structures.find(s => s.complete && s.type === 'curral' && s.communityId === animal.herdCommunityId) : null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = cellAt(w, animal.x + dx, animal.y + dy);
      if (t && (aquatic ? t.terrain === 'water' : t.terrain !== 'water' && t.terrain !== 'rock')
          && (!pen || distance(t, pen) <= (pen.radius || 3.5))) choices.push(t);
    }
    choices.sort((a, b) => distance(b, threat) - distance(a, threat) + (a.slope - b.slope) * .08);
    if (!choices.length) return false;
    const next = choices[0];
    animal.headingX = next.x - animal.x; animal.headingY = next.y - animal.y;
    animal.energy = Math.max(0, animal.energy - .2);
    animal.x = next.x; animal.y = next.y; return true;
  }

export function updateAnimals(w) {
    feedCommunalHerds(w);
    const living = w.animals.filter(a => a.alive).sort((a, b) => a.id - b.id);
    for (const a of living) {
      if (!a.alive) continue;
      const p = species(a.speciesId, ANIMALS);
      a.ageDays++; a.reproductionCooldown = Math.max(0, a.reproductionCooldown - 1);
      if (a.beingLedBy) {
        const handler = w.people.find(person => person.id === a.beingLedBy && person.alive && person.leadingSheepId === a.id);
        if (!handler) { a.beingLedBy = null; a.state = 'solta'; }
        else { a.x = handler.x + .25; a.y = handler.y + .15; a.state = 'seguindo o condutor'; continue; }
      }
      if (a.speciesId === 'sheep' && a.herdCommunityId != null) {
        // Domestic sheep are managed by the herd system: no perception, movement,
        // neural decision, or learning updates run for them.
        a.aiEnabled = false;
        a.energy = clamp(a.energy - (.68 + p.mass * .003), 0, 100);
        a.state = a.lastFeedAmount > .001 ? 'consumindo ração do rebanho' : 'rebanho sem ração';
        if (a.energy <= .1 || a.ageDays > p.life) resolveAnimalDeath(w, a, p);
        continue;
      }
      a.aiEnabled = true;
      a.perception = Senses.observe(w, a, 'animal', PLANTS);
      a.energy = clamp(a.energy - (p.aquatic ? .42 : .68 + p.mass * .003), 0, 100);
      if (p.water) a.hydration = clamp(a.hydration - .48, 0, 100);
      const water = p.water ? nearestWater(w, a, 32) : null;
      const localWater = p.water ? nearestWater(w, a, 5) : null;
      const food = animalFoodCell(w, a, p);
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
          prey.alive = false; w.deaths++; w.deathsByCause.predation++; a.energy = clamp(a.energy + 46, 0, 100);
          const carcass = cellAt(w, prey.x, prey.y); carcass.detritusGPerM2 += species(prey.speciesId, ANIMALS).mass * 190;
          log(w, 'Uma raposa capturou uma lebre; a matéria retorna ao ciclo ecológico.');
          a.state = 'caçando';
        } else if (prey) { moveOne(w, a, prey, false); a.state = 'caçando'; }
        else a.state = 'procurando presa';
      } else if (action === 'flee') {
        moveAwayFrom(w, a, threat, p.aquatic); a.state = 'fugindo de predador';
      } else if (action === 'rest') { a.energy = clamp(a.energy + 2.1, 0, 100); a.state = 'descansando'; }
      else {
        const target = waterCue || animalHabitatCell(w, a, p);
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
    if (!animal.alive) return;
    animal.alive = false; w.deaths++;
    const cause = animal.ageDays > profile.life ? 'age'
      : profile.water && animal.hydration <= .1 ? 'dehydration' : 'starvation';
    w.deathsByCause[cause] = (w.deathsByCause[cause] || 0) + 1;
    const remains = cellAt(w, animal.x, animal.y);
    if (remains) remains.detritusGPerM2 += profile.mass * 170;
    if (w.deaths % 5 === 0) log(w, 'A mortalidade animal depositou biomassa no estoque de detritos.');
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
        if (id === 'sheep' && a.herdCommunityId !== null && mate.herdCommunityId === a.herdCommunityId) {
          offspring.herdCommunityId = a.herdCommunityId;
          offspring.aiEnabled = false;
          offspring.habituation = Math.min(a.habituation || 0, mate.habituation || 0);
        }
        w.animals.push(offspring); w.births++; w.birthsByKind.animals++;
        break;
      }
    }
  }

export function communityHerd(w, community) {
    if (!community) return [];
    const pen = w.structures.find(s => s.communityId === community.id && s.complete && s.type === 'curral');
    return w.animals.filter(a => a.alive && a.speciesId === 'sheep' &&
      (a.herdCommunityId === community.id || (pen && distance(a, pen) <= (pen.radius || 5)) || (!pen && distance(a, community) <= 5)));
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
      community.stores.feed = Math.max(0, community.stores.feed - total);
      for (const animal of flock) {
        animal.lastFeedAmount = ration;
        animal.energy = clamp(animal.energy + ration * DOMESTIC_SHEEP_ENERGY_PER_FEED, 0, 100);
        animal.habituation = clamp((animal.habituation || 0) + .002, 0, 1);
        animal.lastFedDay = w.day; animal.feedingEvents = (animal.feedingEvents || 0) + 1;
      }
      consumed += total;
    }
    return consumed;
  }
