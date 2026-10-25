import { clamp, hash01, spatialNoise } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';
import { cellAt } from '../world/spatial.js';
import { spendResource } from '../economy/inventories.js';
import { seasonIndex } from './climate.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';

const RESOURCE_REGEN_INTERVAL_DAYS = 7;
const RESOURCE_REGEN_FACTOR = .3;
const FOREST_PATCH_SIZE = 18;

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

export function updatePlants(w, day) {
    if (day % RESOURCE_REGEN_INTERVAL_DAYS !== 0) return;
    invalidateNavigation(w);
    w.ecologyFlows ||= {};
    w.ecologyFlows.humanFoodRegrowth ||= 0;
    w.ecologyFlows.humanFoodNaturalLoss ||= 0;
    w.ecologyFlows.humanFoodSettlementLoss ||= 0;
    w.ecologyFlows.humanFoodEcologicalLoss ||= 0;
    w.ecologyFlows.humanFoodCultivatedRegrowth ||= 0;
    const season = seasonIndex(day);
    for (const t of w.tiles) {
      for (let i = 0; i < PLANTS.length; i++) {
        const p = PLANTS[i];
        if (!(t.plantResourceMask & (1 << i))) continue;
        if (t.cropFieldId != null && !p.cultivatedOnly) continue;
        if (p.cultivatedOnly ? t.cropFieldId == null : p.habitat === 'water'
            ? t.terrain !== 'water' : p.habitat === 'shore'
              ? t.soilType !== 'riparian' : t.terrain !== 'land') continue;
        const b = t.plants[i];
        if (p.id === 'broadleaf' || p.id === 'conifer') {
          const blockedByStructure = b < 150 && (w.structures || []).some(structure =>
            Math.abs(t.x - structure.x) <= (structure.radius || 1.5)
            && Math.abs(t.y - structure.y) <= (structure.radius || 1.5));
          if (b < 150 && ((t.roadWear || 0) > .01 || blockedByStructure)) continue;
        }
        const capacity = p.max;
        const actual = Math.min(Math.max(0, capacity - b), p.growth * RESOURCE_REGEN_FACTOR
          * RESOURCE_REGEN_INTERVAL_DAYS * (p.seasonalGrowth?.[season] ?? 1)
          * Math.max(0, 1 - b / capacity));
        if (actual <= 0) continue;
        if (p.foodFor === 'people') {
          w.ecologyFlows.humanFoodRegrowth += actual;
          if (p.cultivatedOnly && t.cropFieldId != null) w.ecologyFlows.humanFoodCultivatedRegrowth += actual;
        }
        t.plants[i] = b + actual;
      }
    }
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
    const tiles = (structure.fieldTileIndices || []).map(index => w.tiles[index])
      .filter(tile => tile && tile.terrain === 'land' && tile.cropFieldId == null);
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
