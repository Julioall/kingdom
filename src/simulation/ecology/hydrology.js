import { canopyAt, plantBiomass } from './plants.js';
import { clamp } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { REGION_SIDE } from '../../config/ecosystem.js';

export function updateSoilAndWater(w) {
    const runoff = new Float32Array(w.tiles.length);
    for (const t of w.tiles) {
      if (t.terrain === 'water') { t.surfaceWaterMm = 24; t.soilWaterMm = t.soilCapacityMm; continue; }
      const canopy = canopyAt(t);
      const infiltration = t.soilType === 'sandy' ? .72 : t.soilType === 'shallow' ? .54 : .82;
      const rainToSoil = t.rainfallMm * infiltration;
      const evaporativeDemand = Math.max(.14, (.11 + Math.max(-2, t.temperatureC) * .009) * (1 - canopy * .35));
      const transpiration = canopy * .24 + plantBiomass(t, ['grass', 'berry', 'reed']) * .00055;
      const raw = t.soilWaterMm + rainToSoil;
      const overflow = Math.max(0, raw - t.soilCapacityMm) * .55 + t.rainfallMm * (1 - infiltration);
      t.soilWaterMm = clamp(raw - evaporativeDemand - transpiration, 0, t.soilCapacityMm);
      const loss = Math.max(0, raw - t.soilWaterMm - evaporativeDemand - transpiration);
      const out = overflow + loss * .16;
      if (out > .1) {
        const dest = lowestNeighbor(w, t);
        if (dest) runoff[dest.i] += out * .5;
      }
      if (t.surfaceWaterMm > 0) t.surfaceWaterMm = Math.max(0, t.surfaceWaterMm - .8);
    }
    for (const t of w.tiles) {
      if (t.terrain === 'water' || runoff[t.i] <= .01) continue;
      const accepted = Math.min(t.soilCapacityMm - t.soilWaterMm, runoff[t.i]);
      t.soilWaterMm += accepted;
      t.surfaceWaterMm = clamp(t.surfaceWaterMm + runoff[t.i] - accepted, 0, 26);
    }
    for (const r of w.regions) {
      let amount = 0, count = 0;
      const regionsWide = w.width / REGION_SIDE;
      const sx = (r.id % regionsWide) * REGION_SIDE, sy = Math.floor(r.id / regionsWide) * REGION_SIDE;
      for (let y = sy; y < sy + REGION_SIDE; y++) for (let x = sx; x < sx + REGION_SIDE; x++) {
        const t = cellAt(w, x, y);
        if (t.terrain !== 'water') { amount += t.soilWaterMm / t.soilCapacityMm; count++; }
      }
      r.meanMoisture = count ? amount / count : 0;
    }
  }

export function lowestNeighbor(w, tile) {
    let best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = cellAt(w, tile.x + dx, tile.y + dy);
      if (n && (!best || n.heightM < best.heightM)) best = n;
    }
    return best && best.heightM <= tile.heightM + 2 ? best : null;
  }

export function drinkWater(w, agent, tile, amount) {
    if (!tile || (tile.terrain !== 'water' && (tile.surfaceWaterMm || 0) < 1.5)) return false;
    const hydration = Math.max(1, amount || 28);
    if (tile.terrain !== 'water') {
      const usedMm = Math.min(tile.surfaceWaterMm, hydration / 12);
      tile.surfaceWaterMm = Math.max(0, tile.surfaceWaterMm - usedMm);
      agent.hydration = clamp(agent.hydration + usedMm * 12, 0, 100);
    } else agent.hydration = clamp(agent.hydration + hydration, 0, 100);
    return true;
  }
