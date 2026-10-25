import { ANIMALS, HEIGHT, PLANTS, WIDTH } from '../../config/ecosystem.js';
import { clamp, species } from '../core/math.js';
import { cellAt } from './spatial.js';
import { plantBiomass } from '../ecology/plants.js';
import { calendarDate } from '../ecology/climate.js';

export function refreshHarvestSuitability(w) {
    const size = WIDTH * HEIGHT, huntDensity = new Float32Array(size), fishDensity = new Float32Array(size);
    for (const animal of w.animals) {
      if (!animal.alive) continue;
      const profile = species(animal.speciesId, ANIMALS);
      const fishing = !!profile.fishable, hunting = !!profile.huntable;
      if (!fishing && !hunting) continue;
      const radius = fishing ? 3.5 : 4.5, cx = Math.round(animal.x), cy = Math.round(animal.y), reach = Math.ceil(radius);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy), tile = cellAt(w, cx + dx, cy + dy);
        if (!tile || d > radius || (fishing ? tile.terrain !== 'water' : tile.terrain !== 'land')) continue;
        const contribution = 1 - d / (radius + 1);
        if (fishing) fishDensity[tile.i] += contribution;
        if (hunting) huntDensity[tile.i] += contribution;
      }
    }
    for (const tile of w.tiles) {
      const greenFood = plantBiomass(tile, ['grass', 'berry', 'browse']);
      const cover = clamp(plantBiomass(tile, ['berry', 'browse', 'broadleaf', 'conifer']) / 430, 0, 1);
      const slopeSuitability = clamp(1 - tile.slope * .8, .25, 1);
      tile.nearbyHuntableAnimals = huntDensity[tile.i];
      tile.nearbyFish = fishDensity[tile.i];
      tile.huntingSuitability = tile.terrain === 'land'
        ? clamp(huntDensity[tile.i] / 1.3, 0, 1) * (.7 + cover * .2 + clamp(greenFood / 180, 0, 1) * .1) * slopeSuitability
        : 0;
      const algae = clamp(plantBiomass(tile, ['algae']) / 85, 0, 1);
      const waterBodySuitability = tile.waterKind === 'lake' || tile.waterKind === 'ocean' ? 1 : tile.waterKind === 'river' ? .88 : .5;
      tile.fishingSuitability = tile.terrain === 'water'
        ? clamp(fishDensity[tile.i] / 1.25, 0, 1) * (.7 + algae * .18 + waterBodySuitability * .12)
        : 0;
    }
    for (const community of w.communities || []) {
      if (community.dissolved || !community.grounds) continue;
      for (const kind of ['hunting', 'fishing']) {
        const ground = community.grounds[kind];
        const tile = ground && cellAt(w, ground.x, ground.y);
        if (ground && tile) ground.score = kind === 'hunting' ? tile.huntingSuitability : tile.fishingSuitability;
      }
    }
    return { huntDensity, fishDensity };
  }

export function snapshot(w) {
    const plantCounts = {}, animalCounts = {};
    let plantBiomass = 0, edibleBiomass = 0, humanFoodBiomass = 0, cultivatedFoodBiomass = 0, plantCover = 0, soilWater = 0, cells = 0, goodHuntingCells = 0, goodFishingCells = 0;
    for (const p of PLANTS) plantCounts[p.id] = 0;
    for (const a of ANIMALS) animalCounts[a.id] = 0;
    for (const t of w.tiles) {
      let occupied = false;
      for (let i = 0; i < PLANTS.length; i++) {
        plantBiomass += t.plants[i];
        if (PLANTS[i].id === 'grass' || PLANTS[i].foodFor === 'people') edibleBiomass += t.plants[i];
        if (PLANTS[i].foodFor === 'people') humanFoodBiomass += t.plants[i];
        if (PLANTS[i].cultivatedOnly && t.cropFieldId != null) cultivatedFoodBiomass += t.plants[i];
        if (t.plants[i] > 25) { plantCounts[PLANTS[i].id]++; occupied = true; }
      }
      if (occupied) plantCover++;
      if (t.terrain !== 'water') { soilWater += t.soilWaterMm / t.soilCapacityMm; cells++; }
      if (t.huntingSuitability >= .62) goodHuntingCells++;
      if (t.fishingSuitability >= .62) goodFishingCells++;
    }
    humanFoodBiomass += w.structures.filter(structure => structure.type === 'roça' && !structure.complete)
      .reduce((sum, structure) => sum + (structure.cropSeedStored || 0), 0);
    for (const a of w.animals) if (a.alive) animalCounts[a.speciesId]++;
    const groups = w.communities.filter(c => !c.dissolved && c.memberIds.length);
    const people = w.people.filter(p => p.alive);
    const soldiers = people.filter(person => person.role === 'soldier');
    const meanFoodReserve = people.length ? people.reduce((sum, p) => sum + p.foodReserve, 0) / people.length : 0;
    const foodRiskPeople = people.filter(p => p.foodReserve < 30).length;
    const criticalFoodPeople = people.filter(p => p.foodReserve < 12).length;
    const propertyCount = groups.reduce((sum, community) => sum + (community.properties || []).length, 0);
    const activeCampaigns = (w.campaigns || []).filter(campaign => ['mobilizing', 'marching', 'engaged', 'withdrawing'].includes(campaign.status));
    const communityTasksCompleted = groups.reduce((sum, community) => sum + (community.assignments || []).filter(task => task.status === 'concluída').length, 0);
    const meanCommunitySatisfaction = groups.length ? groups.reduce((sum, community) => sum + (community.satisfaction || 0), 0) / groups.length : 0;
    const communityStages = { group: 0, tribe: 0, reino: 0 };
    for (const c of groups) {
      if (c.stage === 'grupo') communityStages.group++;
      if (c.stage === 'tribo') communityStages.tribe++;
      if (c.stage === 'reino') communityStages.reino++;
    }
    const date = calendarDate(w.day);
    return {
      day: w.day, year: date.year, season: date.season, dayOfYear: date.dayOfYear,
      dayOfSeason: date.dayOfSeason, daysInSeason: date.daysInSeason,
      daysUntilNextSeason: date.daysUntilNextSeason, nextSeason: date.nextSeason,
      animalCount: w.animals.filter(a => a.alive).length, animalCounts,
      wildSheep: w.animals.filter(a => a.alive && a.speciesId === 'sheep' && a.herdCommunityId === null).length,
      communitySheep: w.animals.filter(a => a.alive && a.speciesId === 'sheep' && a.herdCommunityId !== null).length,
      meatCarried: people.reduce((sum, p) => sum + (p.carriedMeat || 0), 0),
      meatStored: w.structures.filter(s => s.complete && s.type === 'abrigo').reduce((sum, s) => sum + (s.meatStored || 0), 0),
      fruitCarried: people.reduce((sum, p) => sum + (p.carriedFruit || 0), 0),
      fruitStored: w.structures.filter(s => s.complete && s.type === 'abrigo').reduce((sum, s) => sum + (s.fruitStored || 0), 0),
      looseWood: (w.logs || []).filter(item => item.available).reduce((sum, item) => sum + item.amount, 0),
      carriedWood: people.reduce((sum, p) => sum + (p.carriedWood || 0), 0),
      storedWood: groups.reduce((sum, c) => sum + (c.stores.wood || 0), 0),
      storedStone: groups.reduce((sum, c) => sum + (c.stores.stone || 0), 0),
      storedFeed: groups.reduce((sum, c) => sum + (c.stores.feed || 0), 0),
      storedGold: groups.reduce((sum, c) => sum + (c.stores.gold || 0), 0),
      peopleCount: people.length, soldierCount: soldiers.length, kingdomCount: w.kingdoms.length,
      borderIncidents: w.borderIncidents || 0, activeWars: (w.wars || []).filter(war => {
        const relation = w.kingdomRelations[Math.min(war.a, war.b) + ':' + Math.max(war.a, war.b)];
        return relation && relation.status === 'at-war';
      }).length,
      activeCampaigns: activeCampaigns.length,
      campaignBattles: (w.campaigns || []).reduce((sum, campaign) => sum + (campaign.battleCount || 0), 0),
      territorialClaims: (w.territoryClaims || []).filter(claim => claim.status === 'annexed').length,
      treaties: (w.treaties || []).length,
      independentPeople: people.filter(p => p.kingdomId == null).length,
      communityCount: groups.length, communityStages,
      communityProperties: propertyCount, communityTasksCompleted, meanCommunitySatisfaction,
      structureCount: w.structures.filter(s => s.complete).length,
      cultivatedFieldCount: w.structures.filter(s => s.complete && s.type === 'roça').length,
      cultivatedFoodBiomass,
      corralCount: w.structures.filter(s => s.complete && s.type === 'curral').length,
      boundaryCount: w.structures.filter(s => s.complete && s.type === 'torre').length,
      structuresUnderConstruction: w.structures.filter(s => !s.complete).length,
      births: w.births, deaths: w.deaths, birthsByKind: Object.assign({}, w.birthsByKind), deathsByCause: Object.assign({}, w.deathsByCause),
      conflicts: w.conflicts, trades: w.trades, splits: w.splits, raidAttempts: w.raidAttempts, successfulRaids: w.successfulRaids,
      harvests: Object.assign({}, w.harvests), goodHuntingCells, goodFishingCells,
      ecologyFlows: Object.assign({}, w.ecologyFlows),
      plantBiomass, edibleBiomass, humanFoodBiomass, plantCover: plantCover / w.tiles.length, plantCounts,
      meanFoodReserve, foodRiskPeople, criticalFoodPeople,
      soilMoisture: cells ? soilWater / cells : 0,
      rainfallMm: w.regions.reduce((s, r) => s + r.rainfallMm, 0) / w.regions.length,
      dryRegions: w.regions.filter(r => r.dryDays > 16).length,
      speciesPlants: Object.values(plantCounts).filter(n => n > 0).length,
      speciesAnimals: Object.values(animalCounts).filter(n => n > 0).length
    };
  }

export function inspectTile(w, x, y) {
    const t = cellAt(w, x, y);
    if (!t) return null;
    return {
      x, y, terrain: t.terrain, kingdomId: t.kingdomId ?? null, elevationM: Math.round(t.heightM), slope: t.slope,
      soilType: t.soilType, soilWaterMm: Math.round(t.soilWaterMm * 10) / 10,
      roadWear: Math.round((t.roadWear || 0) * 10) / 10,
      soilCapacityMm: t.soilCapacityMm, mineralNitrogenGPerM2: Math.round(t.mineralNitrogenGPerM2 * 100) / 100,
      stoneDeposit: Math.round((t.stoneDeposit || 0) * 10) / 10, goldOre: Math.round((t.goldOre || 0) * 10) / 10,
      stump: !!(t.stump && t.stump.untilDay >= w.day),
      looseTreeResource: Math.round((w.logs || []).filter(item => item.available && Math.round(item.x) === x && Math.round(item.y) === y).reduce((sum, item) => sum + item.amount, 0) * 10) / 10,
      huntingSuitability: Math.round((t.huntingSuitability || 0) * 100) / 100,
      nearbyHuntableAnimals: Math.round(t.nearbyHuntableAnimals || 0),
      fishingSuitability: Math.round((t.fishingSuitability || 0) * 100) / 100,
      nearbyFish: Math.round(t.nearbyFish || 0),
      plantBiomass: PLANTS.map((p, i) => ({ id: p.id, name: p.name, biomass: Math.round(t.plants[i]) })).filter(p => p.biomass > 0)
    };
  }
