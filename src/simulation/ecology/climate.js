import { HEIGHT, REGION_SIDE, WIDTH } from '../../config/ecosystem.js';
import { cellAt } from '../world/spatial.js';
import { rand } from '../core/random.js';
import { clamp, hash01 } from '../core/math.js';
import { log } from '../core/events.js';

export const CALENDAR_DAYS_PER_YEAR = 365;
export const SEASON_LENGTHS = [91, 91, 92, 91];
const MEAN_ANNUAL_TEMPERATURE_C = 20;
// Solves the old seasonal rule's weighted annual expected rain while keeping
// its daily random event and magnitude variation: p * E[amount] = .19*f*(2+8.5*f).
const MEAN_ANNUAL_RAIN_FACTOR = 1.0109;

export function calendarDate(day) {
    const absoluteDay = Math.max(0, Math.floor(Number(day) || 0));
    const year = absoluteDay === 0 ? 1 : Math.floor((absoluteDay - 1) / CALENDAR_DAYS_PER_YEAR) + 1;
    const dayOfYear = absoluteDay === 0 ? 0 : ((absoluteDay - 1) % CALENDAR_DAYS_PER_YEAR) + 1;
    let season = 0, seasonStart = 1;
    if (dayOfYear > 0) {
      for (let i = 0; i < SEASON_LENGTHS.length; i++) {
        const seasonEnd = seasonStart + SEASON_LENGTHS[i] - 1;
        if (dayOfYear <= seasonEnd) { season = i; break; }
        seasonStart = seasonEnd + 1;
      }
    }
    const daysInSeason = SEASON_LENGTHS[season];
    const dayOfSeason = dayOfYear === 0 ? 0 : dayOfYear - seasonStart + 1;
    return {
      day: absoluteDay, year, dayOfYear, season, dayOfSeason, daysInSeason,
      daysUntilNextSeason: dayOfYear === 0 ? daysInSeason + 1 : daysInSeason - dayOfSeason + 1,
      nextSeason: (season + 1) % SEASON_LENGTHS.length
    };
  }

export function seasonIndex(day) { return calendarDate(day).season; }

export function updateClimate(w, day) {
    const season = seasonIndex(day);
    let wetRegions = 0, dryRegions = 0, rainMean = 0;
    for (const r of w.regions) {
      const cx = (r.id % (WIDTH / REGION_SIDE)) * REGION_SIDE + 4;
      const cy = Math.floor(r.id / (WIDTH / REGION_SIDE)) * REGION_SIDE + 4;
      const altitude = cellAt(w, cx, cy).heightM;
      const lat = (cy / HEIGHT - .5) * 3.8;
      const event = rand(w);
      const baseRain = event < .19 * MEAN_ANNUAL_RAIN_FACTOR
        ? (2 + rand(w) * 17 * MEAN_ANNUAL_RAIN_FACTOR) : 0;
      const severity = day <= (w.droughtUntil || 0) ? clamp(w.droughtSeverity || 0, 0, .95) : 0;
      const rain = baseRain * (1 - severity);
      r.temperatureC = MEAN_ANNUAL_TEMPERATURE_C - lat - altitude * .0065 + (rand(w) - .5) * 2.2;
      r.rainfallMm = rain;
      r.humidity = clamp(.32 + rain / 30 + r.meanMoisture * .5, .12, .99);
      r.weather = rain > 1 ? 'rain' : r.meanMoisture < .18 ? 'dry' : 'stable';
      r.dryDays = rain < .4 && r.meanMoisture < .24 ? r.dryDays + 1 : Math.max(0, r.dryDays - 2);
      if (rain > 1) wetRegions++;
      if (r.dryDays > 16) dryRegions++;
      rainMean += rain;
    }
    for (const t of w.tiles) {
      const r = w.regions[t.regionId];
      t.temperatureC = r.temperatureC - Math.max(0, t.heightM - 300) * .0065;
      t.rainfallMm = r.rainfallMm * (.86 + hash01(w.seed + day, t.x, t.y) * .28);
    }
    if (wetRegions >= 18 && day - w.lastWeatherEvent > 9) {
      log(w, 'Uma frente úmida alcançou ' + wetRegions + ' regiões; a água volta a infiltrar no solo.');
      w.lastWeatherEvent = day; w.rainEvents++;
    } else if (dryRegions >= 5 && day - w.lastWeatherEvent > 9) {
      log(w, 'A baixa umidade persiste em ' + dryRegions + ' regiões; plantas e animais passam a disputar água.');
      w.lastWeatherEvent = day;
    }
    return { season, wetRegions, dryRegions, meanRain: rainMean / w.regions.length };
  }

export function triggerDrought(w, durationDays, severity) {
    const duration = Math.max(1, Math.floor(durationDays || 90));
    w.droughtSeverity = clamp(severity === undefined ? .82 : severity, .1, .95);
    w.droughtUntil = Math.max(w.droughtUntil || 0, w.day + duration);
    log(w, 'Intervenção experimental: precipitação reduzida em ' + Math.round(w.droughtSeverity * 100) + '% por ' + duration + ' dias. As respostas do solo, da vegetação, das populações e das comunidades não são pré-definidas.');
    return w.droughtUntil;
  }
