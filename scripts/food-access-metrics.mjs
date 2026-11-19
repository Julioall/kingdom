// Observational metrics only: recorded inventory does not imply that an NPC can
// reach it, afford it or receive a ration. No world state is changed here.
const ADULT_AGE_DAYS = 12 * 365;
const CRITICAL_RESERVE_DAYS = 20;

// Match the world generator's explicit limits; preserve legacy defaults when
// neither flag is supplied, so historical replays remain comparable.
export function foodAuditWorldOptions(rawPopulation, rawMilitaryShare) {
  const options = {};
  if (rawPopulation !== undefined) {
    const population = Number(rawPopulation);
    if (!Number.isSafeInteger(population) || population < 96 || population > 5000) {
      throw new RangeError('--population deve ser um inteiro entre 96 e 5000');
    }
    options.initialPopulation = population;
  }
  if (rawMilitaryShare !== undefined) {
    const share = Number(rawMilitaryShare);
    if (share !== 0.8) throw new RangeError('--military-share deve ser 0.8');
    options.initialMilitaryShare = share;
  }
  return options;
}

function groupOf(person) {
  return {
    kingdomId: person.deathKingdomId ?? person.kingdomId ?? null,
    cohort: person.role === 'soldier' ? 'military' : 'non-military'
  };
}

function groupRow(tracker, person) {
  const { kingdomId, cohort } = groupOf(person);
  const key = String(kingdomId ?? 'none') + ':' + cohort;
  if (!tracker.has(key)) tracker.set(key, {
    kingdomId, cohort, observedAdultDays: 0, criticalAdultDays: 0,
    invalidReserveAdultDays: 0, criticalWithCommunityStock: 0,
    criticalWithTreasuryStock: 0, criticalWithMarketStock: 0,
    criticalWithAnyRecordedStock: 0, criticalWithoutRecordedStock: 0
  });
  return tracker.get(key);
}

function positiveStock(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function observeFoodAccessDay(tracker, world) {
  const kingdoms = new Map((world.kingdoms || []).map(kingdom => [kingdom.id, kingdom]));
  const communities = new Map((world.communities || []).map(community => [community.id, community]));
  for (const person of world.people || []) {
    if (!person.alive || !(person.ageDays >= ADULT_AGE_DAYS)) continue;
    const row = groupRow(tracker, person);
    row.observedAdultDays++;
    if (typeof person.foodReserve !== 'number' || !Number.isFinite(person.foodReserve)) {
      row.invalidReserveAdultDays++;
      continue;
    }
    if (person.foodReserve >= CRITICAL_RESERVE_DAYS) continue;
    row.criticalAdultDays++;
    const kingdom = kingdoms.get(person.kingdomId);
    const community = communities.get(person.communityId);
    const communityStock = positiveStock(community?.stores?.food);
    const treasuryStock = positiveStock(kingdom?.treasury?.stock?.food);
    const marketStock = positiveStock(kingdom?.market?.stock?.food);
    if (communityStock) row.criticalWithCommunityStock++;
    if (treasuryStock) row.criticalWithTreasuryStock++;
    if (marketStock) row.criticalWithMarketStock++;
    if (communityStock || treasuryStock || marketStock) row.criticalWithAnyRecordedStock++;
    else row.criticalWithoutRecordedStock++;
  }
}

export function summarizeFoodAccess(tracker, world) {
  // Copy rows so calculating a report twice never changes observed exposure.
  const rows = new Map([...tracker].map(([key, row]) => [key, {
    ...row, starvationDeathsAllAges: 0, starvationDeathsAdults: 0
  }]));
  for (const person of world.people || []) {
    if (person.alive !== false || person.deathCause !== 'starvation') continue;
    const { kingdomId, cohort } = groupOf(person);
    const key = String(kingdomId ?? 'none') + ':' + cohort;
    if (!rows.has(key)) {
      const empty = groupRow(new Map(), person);
      rows.set(key, { ...empty, starvationDeathsAllAges: 0, starvationDeathsAdults: 0 });
    }
    const row = rows.get(key);
    row.starvationDeathsAllAges++;
    if (person.ageDays >= ADULT_AGE_DAYS) row.starvationDeathsAdults++;
  }
  return [...rows.values()].map(row => ({
    ...row,
    criticalAdultDayRate: row.observedAdultDays > 0
      ? Number((row.criticalAdultDays / row.observedAdultDays).toFixed(6)) : null
  })).sort((a, b) => String(a.kingdomId).localeCompare(String(b.kingdomId), undefined, { numeric: true })
    || a.cohort.localeCompare(b.cohort));
}
