import { clamp, hash01, spatialNoise } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';
import { cellAt } from '../world/spatial.js';
import { spendResource } from '../economy/inventories.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';
import { isRoadTile, resourceUsePressure } from '../world/roads.js';
import { CULTIVATED_FOOD_PER_SEED_UNIT } from '../economy/food-policy.js';

const RESOURCE_REGEN_INTERVAL_DAYS = 7;
const RESOURCE_REGEN_FACTOR = .3;
const FOREST_PATCH_SIZE = 18;
const DISPERSING_PLANTS = new Set(['berry', 'browse', 'broadleaf', 'conifer']);

export function plantSuitability(profile, tile, temperatureC, moisture) {
    if (profile.habitat === 'water' && tile.terrain !== 'water') return 0;
    if (profile.habitat === 'shore' && tile.soilType !== 'riparian') return 0;
    if (profile.habitat === 'upland' && tile.terrain === 'water') return 0;
    if (tile.terrain === 'water' && profile.habitat !== 'water') return 0;
    const temp = clamp((temperatureC - profile.temp[0]) / 5, 0, 1) * clamp((profile.temp[1] - temperatureC) / 5, 0, 1);
    const water = clamp((moisture - profile.water[0]) / .24, 0, 1) * clamp((profile.water[1] - moisture) / .24, 0, 1);
    if (profile.habitat === 'shore') return temp * clamp((moisture - .55) / .24, 0, 1);
    if (profile.habitat === 'water') return temp * clamp((moisture - .82) / .15, 0, 1);
    return temp * water;
  }

export function seedPlants(w) {
    invalidateNavigation(w);
    for (const t of w.tiles) {
      const moisture = clamp(t.soilWaterMm / t.soilCapacityMm, 0, 1);
      t.plantResourceMask = 0;
      const forestDensity = spatialNoise(w.seed + 2027, t.x, t.y, FOREST_PATCH_SIZE);
      const forestType = spatialNoise(w.seed + 4079, t.x, t.y, FOREST_PATCH_SIZE);
      const edgeDistance = Math.hypot((t.x - (w.width - 1) / 2) / (w.width / 2),
        (t.y - (w.height - 1) / 2) / (w.height / 2));
      const edgeDensity = edgeDistance < .35 ? .05 : edgeDistance < .6 ? .85 : 1.5;
      const treeChance = clamp(Math.max(.01, Math.min(.95, (forestDensity - .4) * 1.55)) * edgeDensity, .01, .95);
      const treeThreshold = 1 - treeChance;
      for (let n = 0; n < PLANTS.length; n++) {
        const p = PLANTS[n], suitability = plantSuitability(p, t, 18 - t.heightM * .006, moisture);
        const patchNoise = hash01(w.seed + n * 137, t.x, t.y);
        if (p.id === 'grass' && t.terrain === 'land') t.plants[n] = (7 + patchNoise * 35) * Math.max(.12, suitability);
        else if (p.id === 'algae' && t.terrain === 'water' && patchNoise > .16) t.plants[n] = 24 + patchNoise * 90;
        else if (p.id === 'reed' && t.soilType === 'riparian' && patchNoise > .39) t.plants[n] = 35 + patchNoise * 105;
        else if (p.id === 'berry' && t.terrain === 'land' && suitability > .2 && patchNoise > .58) t.plants[n] = 16 + patchNoise * 54;
        else if (p.id === 'browse' && t.terrain === 'land' && suitability > .15 && patchNoise > .72) t.plants[n] = 12 + patchNoise * 34;
        else if (p.id === 'broadleaf' && t.terrain === 'land' && forestType >= .4
            && suitability > .17 && patchNoise > treeThreshold) t.plants[n] = 120 + patchNoise * 330;
        else if (p.id === 'conifer' && t.terrain === 'land' && forestType < .4
            && suitability > .13 && patchNoise > treeThreshold) t.plants[n] = 130 + patchNoise * 280;
        if (t.plants[n] > .01) t.plantResourceMask |= 1 << n;
      }
    }
  }

export function canopyAt(t) {
    let sum = 0;
    for (let i = 0; i < PLANTS.length; i++) sum += t.plants[i] * PLANTS[i].canopy / PLANTS[i].max;
    return clamp(sum, 0, .95);
  }

export function plantBiomass(t, ids) {
    let sum = 0;
    for (const id of ids) { const i = PLANTS.findIndex(p => p.id === id); if (i >= 0) sum += t.plants[i]; }
    return sum;
  }

export function cultivatedFieldYieldTarget(seedMass, tileCount) {
    const crop = PLANTS.find(plant => plant.id === 'cultivated-root');
    if (!crop || !Number.isFinite(seedMass) || seedMass <= 0 || !Number.isFinite(tileCount) || tileCount <= 0) return 0;
    return Math.min(seedMass * CULTIVATED_FOOD_PER_SEED_UNIT, tileCount * crop.max);
  }

export function cultivatedFieldStandingBiomass(w, structure) {
    if (!w || !structure || structure.type !== 'roça') return 0;
    const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
    if (cropIndex < 0) return 0;
    return (structure.fieldTileIndices || []).reduce((sum, index) => {
      const tile = w.tiles?.[index];
      return sum + (tile?.cropFieldId === structure.id ? Math.max(0, Number(tile.plants?.[cropIndex]) || 0) : 0);
    }, 0);
  }

export function isTreeAnchor(w, tile) {
    if (!w || !tile || tile.terrain === 'water' || tile.cropFieldId != null) return false;
    const broadleaf = PLANTS.findIndex(plant => plant.id === 'broadleaf');
    const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
    const massAt = candidate => Math.max(candidate.plants[broadleaf] || 0, candidate.plants[conifer] || 0);
    const mass = massAt(tile);
    if (mass < 150) return false;
    const tieAt = candidate => ((candidate.x * 92821 + candidate.y * 68917 + (w.seed + 431) * 283) >>> 0) % 11;
    const tie = tieAt(tile), index = tile.y * w.width + tile.x, spacing = 1;
    for (let dy = -spacing; dy <= spacing; dy++) for (let dx = -spacing; dx <= spacing; dx++) {
      if (!dx && !dy) continue;
      const neighbor = cellAt(w, tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain === 'water') continue;
      const neighborMass = massAt(neighbor), neighborIndex = neighbor.y * w.width + neighbor.x;
      if (neighborMass > mass || (neighborMass === mass && (tieAt(neighbor) > tie || (tieAt(neighbor) === tie && neighborIndex < index)))) return false;
    }
    return true;
  }

export function isBushAnchor(w, tile, plantId) {
    if (!w || !tile || tile.terrain === 'water' || tile.cropFieldId != null
        || !['berry', 'browse'].includes(plantId)) return false;
    const plant = PLANTS.findIndex(candidate => candidate.id === plantId);
    if (plant < 0 || (tile.plants[plant] || 0) < 18) return false;
    const hiddenUntilField = plantId === 'browse' ? 'browseBushHiddenUntilDay' : 'berryBushHiddenUntilDay';
    if ((tile[hiddenUntilField] ?? -1) >= w.day) return false;

    // Keep one visible, reachable shrub per local patch. The hash matches the
    // renderer's previous tie-break so the chosen harvest tile is the sprite.
    const salt = plantId === 'browse' ? 2503 : 1907;
    const tieAt = candidate => ((candidate.x * 92821 + candidate.y * 68917 + (w.seed + salt) * 283) >>> 0) % 11;
    const mass = tile.plants[plant], tie = tieAt(tile), index = tile.y * w.width + tile.x;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const neighbor = cellAt(w, tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain === 'water') continue;
      if ((neighbor[hiddenUntilField] ?? -1) >= w.day) return false;
      const otherMass = neighbor.plants[plant], otherIndex = neighbor.y * w.width + neighbor.x;
      if (otherMass > mass || (otherMass === mass && (tieAt(neighbor) > tie || (tieAt(neighbor) === tie && otherIndex < index)))) return false;
    }
    return true;
  }

function spreadWildPlants(w, day) {
    const seedlings = [];
    for (const tile of w.tiles) {
      if (tile.cropFieldId != null || tile.terrain !== 'land') continue;
      const pressure = resourceUsePressure(tile);
      if (pressure > .28 || isRoadTile(tile)) continue;
      const moisture = clamp(tile.soilWaterMm / Math.max(1, tile.soilCapacityMm), 0, 1);
      for (let i = 0; i < PLANTS.length; i++) {
        const profile = PLANTS[i], bit = 1 << i;
        if (!DISPERSING_PLANTS.has(profile.id) || profile.cultivatedOnly || (tile.plantResourceMask & bit)) continue;
        const suitability = plantSuitability(profile, tile, tile.temperatureC, moisture);
        if (suitability < .18) continue;
        const radius = profile.id === 'broadleaf' || profile.id === 'conifer' ? 3 : 2;
        const sourceFloor = radius === 3 ? 240 : Math.max(24, profile.max * .14);
        let hasNearbySource = false;
        for (let dy = -radius; dy <= radius && !hasNearbySource; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (!dx && !dy || Math.hypot(dx, dy) > radius) continue;
          const x = tile.x + dx, y = tile.y + dy;
          if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
          const source = w.tiles[y * w.width + x];
          if (source && (source.plants[i] || 0) >= sourceFloor) { hasNearbySource = true; break; }
        }
        if (!hasNearbySource) continue;
        const seedChance = profile.id === 'broadleaf' || profile.id === 'conifer' ? .012 : .055;
        const roll = hash01(w.seed + day * 101 + i * 137, tile.x, tile.y);
        if (roll >= seedChance * suitability * (1 - pressure)) continue;
        const amount = radius === 3
          ? 90 + hash01(w.seed + day * 211 + i * 31, tile.x, tile.y) * 30
          : 16 + hash01(w.seed + day * 211 + i * 31, tile.x, tile.y) * 20;
        seedlings.push({ tile, i, amount });
      }
    }
    for (const { tile, i, amount } of seedlings) {
      tile.plants[i] = amount;
      tile.plantResourceMask |= 1 << i;
    }
  }

export function updatePlants(w, day) {
    if (day % RESOURCE_REGEN_INTERVAL_DAYS !== 0) return;
    invalidateNavigation(w);
    w.ecologyFlows ||= {};
    w.ecologyFlows.humanFoodRegrowth ||= 0;
    w.ecologyFlows.humanFoodNaturalLoss ||= 0;
    w.ecologyFlows.humanFoodSettlementLoss ||= 0;
    w.ecologyFlows.humanFoodEcologicalLoss ||= 0;
    w.ecologyFlows.humanFoodCultivatedRegrowth ||= 0;
    const cropFields = new Map((w.structures || []).filter(structure => structure.type === 'roça'
      && structure.complete && structure.destroyedDay == null && structure.integrity !== 0).map(structure => [structure.id, structure]));
    const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
    for (const field of cropFields.values()) {
      const tileCount = (field.fieldTileIndices || []).filter(index => w.tiles[index]?.cropFieldId === field.id).length;
      const standing = cultivatedFieldStandingBiomass(w, field);
      const seedMass = Math.max(0, Number(field.cropSeededBiomass) || Number(field.seedMass) || 0);
      if (!Number.isFinite(field.cropYieldTarget) || field.cropYieldTarget <= 0) {
        const legacyHarvested = Math.max(0, Number(field.cropHarvested) || 0);
        field.cropYieldTarget = Math.max(cultivatedFieldYieldTarget(seedMass, tileCount), legacyHarvested + standing);
      }
      if (!Number.isFinite(field.cropGrowthGenerated)) {
        field.cropGrowthGenerated = Math.min(field.cropYieldTarget, Math.max(seedMass, standing + (Number(field.cropHarvested) || 0)));
      }
      if (!Number.isFinite(field.cropHarvestedThisCycle)) field.cropHarvestedThisCycle = Math.max(0, Number(field.cropHarvested) || 0);
      if (!field.cropCycleState) field.cropCycleState = field.cropGrowthGenerated >= field.cropYieldTarget - .01 ? 'ready' : 'growing';
      if (field.cropCycleState === 'ready' && field.cropHarvestedThisCycle >= field.cropYieldTarget - .01 && standing <= .01) {
        field.cropCycleState = 'spent';
      }
      field.cropTileCapacity = tileCount ? field.cropYieldTarget / tileCount : 0;
    }
    for (const t of w.tiles) {
      for (let i = 0; i < PLANTS.length; i++) {
        const p = PLANTS[i];
        if (!(t.plantResourceMask & (1 << i))) continue;
        if (t.cropFieldId != null && !p.cultivatedOnly) continue;
        if (p.cultivatedOnly ? t.cropFieldId == null : p.habitat === 'water'
            ? t.terrain !== 'water' : p.habitat === 'shore'
              ? t.soilType !== 'riparian' : t.terrain !== 'land') continue;
        const b = t.plants[i];
        const cropField = p.cultivatedOnly ? cropFields.get(t.cropFieldId) : null;
        if (p.cultivatedOnly && (!cropField || cropField.cropCycleState !== 'growing')) continue;
        if (p.id === 'broadleaf' || p.id === 'conifer') {
          const blockedByStructure = b < 150 && (w.structures || []).some(structure =>
            Math.abs(t.x - structure.x) <= (structure.radius || 1.5)
            && Math.abs(t.y - structure.y) <= (structure.radius || 1.5));
          if (b < 150 && (isRoadTile(t) || blockedByStructure)) continue;
        }
        const capacity = p.cultivatedOnly ? Math.min(p.max, cropField.cropTileCapacity) : p.max;
        const cropBudget = p.cultivatedOnly ? Math.max(0, cropField.cropYieldTarget - cropField.cropGrowthGenerated) : Infinity;
        const recoveryInLowUseAreas = p.cultivatedOnly ? 1 : 1 + (1 - resourceUsePressure(t)) * .45;
        const actual = Math.min(cropBudget, Math.max(0, capacity - b), p.growth * RESOURCE_REGEN_FACTOR
          * RESOURCE_REGEN_INTERVAL_DAYS
          * Math.max(0, 1 - b / capacity) * recoveryInLowUseAreas);
        if (actual <= 0) continue;
        if (p.foodFor === 'people') {
          w.ecologyFlows.humanFoodRegrowth += actual;
          if (p.cultivatedOnly && t.cropFieldId != null) w.ecologyFlows.humanFoodCultivatedRegrowth += actual;
        }
        t.plants[i] = b + actual;
        if (p.cultivatedOnly) {
          cropField.cropGrowthGenerated += actual;
          if (cropField.cropGrowthGenerated >= cropField.cropYieldTarget - .01) cropField.cropCycleState = 'ready';
        }
      }
    }
    for (const field of cropFields.values()) {
      if (field.cropCycleState !== 'growing'
          || field.cropGrowthGenerated < field.cropYieldTarget - Math.max(1, field.cropYieldTarget * .01)) continue;
      let remaining = Math.max(0, field.cropYieldTarget - field.cropGrowthGenerated);
      for (const index of field.fieldTileIndices || []) {
        if (remaining <= .001) break;
        const tile = w.tiles[index];
        if (!tile || tile.cropFieldId !== field.id) continue;
        const capacity = Math.min(PLANTS[cropIndex].max, field.cropTileCapacity);
        const amount = Math.min(remaining, Math.max(0, capacity - tile.plants[cropIndex]));
        if (amount <= 0) continue;
        tile.plants[cropIndex] += amount;
        tile.plantResourceMask |= 1 << cropIndex;
        field.cropGrowthGenerated += amount;
        remaining -= amount;
        w.ecologyFlows.humanFoodRegrowth += amount;
        w.ecologyFlows.humanFoodCultivatedRegrowth += amount;
      }
      if (field.cropGrowthGenerated >= field.cropYieldTarget - .01) {
        field.cropGrowthGenerated = field.cropYieldTarget;
        field.cropCycleState = 'ready';
      }
    }
    spreadWildPlants(w, day);
  }

export function eatPlants(w, tile, diet, amount) {
    let left = amount, eaten = 0;
    const candidates = diet.map(id => ({ id, i: PLANTS.findIndex(p => p.id === id) })).filter(p => p.i >= 0).sort((a, b) => tile.plants[b.i] - tile.plants[a.i]);
    for (const c of candidates) {
      if (left <= .02) break;
      const profile = PLANTS[c.i];
      const rootReserve = profile.cultivatedOnly && tile.cropFieldId != null ? (profile.rootReserve || 0) : 0;
      const take = Math.min(left, Math.max(0, tile.plants[c.i] - rootReserve));
      tile.plants[c.i] -= take; left -= take; eaten += take;
      tile.detritusGPerM2 += take * .035;
    }
    return eaten;
  }

export function collectCommunityFieldSeeds(w, structure) {
    if (!w || !structure || structure.type !== 'roça') return 0;
    const seedMass = Math.max(0, Number(structure.seedMass) || 0);
    const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
    const tiles = (structure.fieldTileIndices || []).map(index => w.tiles[index]).filter(Boolean)
      .sort((a, b) => b.plants[berryIndex] - a.plants[berryIndex] || a.i - b.i);
    if (!seedMass || berryIndex < 0 || tiles.reduce((sum, tile) => sum + tile.plants[berryIndex], 0) + .001 < seedMass) return 0;
    let remaining = seedMass;
    for (const tile of tiles) {
      const take = Math.min(remaining, tile.plants[berryIndex]);
      tile.plants[berryIndex] -= take;
      remaining -= take;
      if (remaining <= .001) break;
    }
    structure.cropSeedStored = seedMass;
    w.ecologyFlows.humanFoodCultivationSeeded = (w.ecologyFlows.humanFoodCultivationSeeded || 0) + seedMass;
    return seedMass;
  }

export function sowCommunityField(w, structure) {
    if (!w || !structure || structure.type !== 'roça') return 0;
    const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
    if (cropIndex < 0) return 0;
    if (structure.cropCycleState !== 'spent' && cultivatedFieldStandingBiomass(w, structure) > .01) return 0;
    const tiles = (structure.fieldTileIndices || []).map(index => w.tiles[index])
      .filter(tile => tile && tile.terrain === 'land' && (tile.cropFieldId == null || tile.cropFieldId === structure.id));
    if (!tiles.length) return 0;
    const seedMass = Math.max(0, Number(structure.cropSeedStored) || 0);
    if (!seedMass) return 0;
    const perTile = seedMass / tiles.length;
    for (const tile of tiles) {
      tile.cropFieldId = structure.id;
      tile.plants.fill(0);
      tile.plants[cropIndex] = perTile;
      tile.plantResourceMask = 1 << cropIndex;
      tile.stoneDeposit = 0;
      tile.goldOre = 0;
      tile.stump = null;
      tile.roadWear = 0;
    }
    structure.fieldTileIndices = tiles.map(tile => tile.i);
    structure.cropSeedStored = 0;
    structure.cropSeededBiomass = seedMass;
    structure.cropYieldTarget = cultivatedFieldYieldTarget(seedMass, tiles.length);
    structure.cropGrowthGenerated = seedMass;
    structure.cropHarvestedThisCycle = 0;
    structure.cropCycleState = 'growing';
    structure.cropCycleStartedDay = w.day;
    structure.cropTileCapacity = structure.cropYieldTarget / tiles.length;
    structure.cropHarvested = structure.cropHarvested || 0;
    invalidateNavigation(w);
    return seedMass;
  }

export function decompose(w) {
    for (const t of w.tiles) {
      const moisture = t.terrain === 'water' ? 1 : t.soilWaterMm / t.soilCapacityMm;
      const warmth = clamp((t.temperatureC + 4) / 24, .05, 1);
      const rate = .0035 * warmth * clamp(moisture * 1.3, .05, 1);
      const decayed = t.detritusGPerM2 * rate;
      t.detritusGPerM2 -= decayed;
      t.organicMatterGPerM2 += decayed * .38;
      t.mineralNitrogenGPerM2 = clamp(t.mineralNitrogenGPerM2 + decayed * .0018 - .001, .05, 18);
    }
  }

export function updateLooseLogs(w) {
    for (const item of w.logs || []) {
      if (!item.available) continue;
      if (w.day - item.createdDay <= 180 && item.amount > .05) continue;
      const tile = cellAt(w, item.x, item.y);
      const amount = item.amount;
      if (!Number.isFinite(amount) || amount < 0) { item.available = false; continue; }
      if (tile) tile.detritusGPerM2 += amount * 22;
      spendResource(item, { amount });
      item.available = false;
    }
  }
