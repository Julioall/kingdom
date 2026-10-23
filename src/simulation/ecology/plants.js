import { clamp, hash01 } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';
import { seasonIndex } from './climate.js';
import { rand } from '../core/random.js';
import { cellAt } from '../world/spatial.js';
import { roadPressure } from '../world/roads.js';

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
    for (const t of w.tiles) {
      const moisture = clamp(t.soilWaterMm / t.soilCapacityMm, 0, 1);
      for (let n = 0; n < PLANTS.length; n++) {
        const p = PLANTS[n], suitability = plantSuitability(p, t, 18 - t.heightM * .006, moisture);
        const patchNoise = hash01(w.seed + n * 137, t.x, t.y);
        if (p.id === 'grass' && t.terrain === 'land') t.plants[n] = (7 + patchNoise * 35) * Math.max(.12, suitability);
        else if (p.id === 'algae' && t.terrain === 'water' && patchNoise > .16) t.plants[n] = 24 + patchNoise * 90;
        else if (p.id === 'reed' && t.soilType === 'riparian' && patchNoise > .39) t.plants[n] = 35 + patchNoise * 105;
        else if (p.id === 'berry' && t.terrain === 'land' && suitability > .2 && patchNoise > .58) t.plants[n] = 16 + patchNoise * 54;
        else if (p.id === 'browse' && t.terrain === 'land' && suitability > .15 && patchNoise > .72) t.plants[n] = 12 + patchNoise * 34;
        else if (p.id === 'broadleaf' && t.terrain === 'land' && suitability > .17 && patchNoise > .71) t.plants[n] = 120 + patchNoise * 330;
        else if (p.id === 'conifer' && t.terrain === 'land' && suitability > .13 && patchNoise > .74) t.plants[n] = 130 + patchNoise * 280;
        if ((p.id === 'berry' || p.id === 'browse') && t.terrain === 'land' && suitability > .18) {
          t.seedBank[n] = .8 + hash01(w.seed + n * 619, t.x, t.y) * 4.2;
        } else if ((p.id === 'broadleaf' || p.id === 'conifer') && t.terrain === 'land' && suitability > .08) {
          // Trees keep a local seed reserve so a poor season does not erase a forest permanently.
          t.seedBank[n] = .5 + hash01(w.seed + n * 619, t.x, t.y) * 2.5;
        }
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
    if (!w || !tile || tile.terrain === 'water') return false;
    const broadleaf = PLANTS.findIndex(plant => plant.id === 'broadleaf');
    const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
    const massAt = candidate => Math.max(candidate.plants[broadleaf] || 0, candidate.plants[conifer] || 0);
    const mass = massAt(tile);
    if (mass < 150) return false;
    const tieAt = candidate => ((candidate.x * 92821 + candidate.y * 68917 + (w.seed + 431) * 283) >>> 0) % 11;
    const tie = tieAt(tile), index = tile.y * w.width + tile.x, spacing = 4;
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
    const season = seasonIndex(day);
    for (const t of w.tiles) {
      const moisture = t.terrain === 'water' ? 1 : clamp(t.soilWaterMm / t.soilCapacityMm, 0, 1);
      const shade = canopyAt(t);
      const disturbance = Math.max(roadPressure(t), t.civilizationPressure || 0);
      for (let i = 0; i < PLANTS.length; i++) {
        const p = PLANTS[i], b = t.plants[i];
        const dormantShrub = b <= .01 && (p.id === 'berry' || p.id === 'browse');
        const dormantTree = b < 100 && (p.id === 'broadleaf' || p.id === 'conifer');
        const dormantSeed = dormantShrub || dormantTree;
        if (b <= .01 && (!dormantSeed || !t.seedBank || t.seedBank[i] <= .02)) continue;
        const tempSuit = clamp((t.temperatureC - p.temp[0]) / 7, 0, 1) * clamp((p.temp[1] - t.temperatureC) / 7, 0, 1);
        const waterSuit = clamp(moisture / Math.max(.05, p.water[0]), 0, 1) * (moisture > p.water[1] && p.habitat !== 'water' ? clamp((1 - moisture) / .2, 0, 1) : 1);
        const nSuit = clamp(t.mineralNitrogenGPerM2 / 3.5, .08, 1);
        const light = p.id === 'broadleaf' || p.id === 'conifer' ? 1 - shade * .42 : 1 - shade * .72;
        const habitatSuit = (p.habitat === 'water' && t.terrain === 'water') || (p.habitat === 'shore' && t.soilType === 'riparian')
          || (p.habitat !== 'water' && p.habitat !== 'shore' && t.terrain === 'land') ? 1 : .12;
        const seasonalGrowth = p.seasonalGrowth ? p.seasonalGrowth[season] : 1;
        const suitability = tempSuit * waterSuit * nSuit * light * habitatSuit;
        const isTree = p.id === 'broadleaf' || p.id === 'conifer';
        const isShrub = p.id === 'berry' || p.id === 'browse';
        const trampling = 1 - disturbance * (isTree ? .92 : isShrub ? .82 : .14);
        const growth = Math.max(0, p.growth * seasonalGrowth * suitability * (1 - b / p.max) * trampling);
        const waterCost = growth * .012;
        const germinationSeason = dormantTree ? season === 0 : seasonalGrowth > 1;
        const germination = dormantSeed && germinationSeason && moisture > p.water[0]
          ? Math.min(dormantTree ? .28 : 1.1, t.seedBank[i] * (dormantTree ? .035 : .08)) * suitability * trampling : 0;
        const actual = dormantShrub || (dormantTree && b <= .01) ? germination
          : t.terrain === 'water' ? growth : Math.min(growth, Math.max(0, t.soilWaterMm * .12) / .012) + (dormantTree ? germination : 0);
        const stressMortality = p.id === 'broadleaf' || p.id === 'conifer' ? .00008 : .00065;
        const landUseMortality = isTree ? .0008 : isShrub ? .008 : 0;
        const naturalLoss = (1 - suitability) * b * stressMortality;
        const settlementLoss = b * disturbance * landUseMortality;
        t.plants[i] = Math.max(0, b + actual - naturalLoss - settlementLoss);
        if (dormantSeed && t.seedBank) t.seedBank[i] = Math.max(0, t.seedBank[i] - actual * (dormantTree ? .08 : .16));
        if (t.terrain !== 'water') t.soilWaterMm = Math.max(0, t.soilWaterMm - Math.min(t.soilWaterMm, waterCost));
        t.mineralNitrogenGPerM2 = Math.max(.05, t.mineralNitrogenGPerM2 - actual * .0005);
        t.detritusGPerM2 += Math.max(0, b - t.plants[i]) * .14;
        if (actual > .5 && day % 9 === 0 && rand(w) < .018 + suitability * .02) {
          const dx = Math.floor(rand(w) * 5) - 2, dy = Math.floor(rand(w) * 5) - 2;
          const target = cellAt(w, t.x + dx, t.y + dy);
          if (target && target.terrain === t.terrain && target.plants[i] < p.max * .28) target.seedBank[i] = Math.min(8, (target.seedBank[i] || 0) + .45);
        }
      }
    }
  }

export function eatPlants(w, tile, diet, amount) {
    let left = amount, eaten = 0;
    const candidates = diet.map(id => ({ id, i: PLANTS.findIndex(p => p.id === id) })).filter(p => p.i >= 0).sort((a, b) => tile.plants[b.i] - tile.plants[a.i]);
    for (const c of candidates) {
      if (left <= .02) break;
      const take = Math.min(left, tile.plants[c.i]);
      tile.plants[c.i] -= take; left -= take; eaten += take;
      tile.detritusGPerM2 += take * .035;
      if (tile.seedBank && (c.id === 'berry' || c.id === 'browse')) tile.seedBank[c.i] = Math.min(8, tile.seedBank[c.i] + take * .0025);
    }
    return eaten;
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
      if (tile) tile.detritusGPerM2 += item.amount * 22;
      item.amount = 0; item.available = false;
    }
  }
