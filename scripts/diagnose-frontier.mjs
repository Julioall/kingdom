import Sim from '../src/simulation/engine.js';

const seeds = (process.env.FRONTIER_SEEDS || '1,42,987,2026').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.FRONTIER_DAYS || 365)));

function diagnose(seed) {
  const world = Sim.createWorld(seed);
  const entries = [];
  const events = [];
  const latestEntryByPerson = new Map();
  const entryKey = (personId, ownerId) => personId + ':' + ownerId;
  const entryRecorder = record => {
    entries.push(record);
    latestEntryByPerson.set(entryKey(record.personId, record.ownerId), record);
  };
  const incidents = [];
  world.borderIncidentDiagnosticRecorder = incident => {
    const entry = latestEntryByPerson.get(entryKey(incident.personId, incident.hostId));
    incidents.push({ ...incident, entryReason: entry?.entryReason ?? 'entry-not-recorded' });
  };

  // Preserve causal events beyond the live 64-entry chronicle window.
  const nativeUnshift = world.events.unshift;
  Object.defineProperty(world.events, 'unshift', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(...items) {
      for (const event of items) {
        if (/descoberto|invas[aã]o territorial/i.test(event?.text || '')) events.push(event);
      }
      return nativeUnshift.apply(this, items);
    }
  });

  for (let day = 0; day < days; day++) {
    for (const person of world.people) person.territoryEntryDiagnosticRecorder = entryRecorder;
    Sim.stepDay(world, null, { includeSnapshot: false });
  }
  delete world.events.unshift;

  const invasionDeaths = world.people.filter(person => !person.alive && person.deathCause === 'invasion')
    .map(person => {
      const ownerId = person.territoryExposure?.ownerId;
      const entry = ownerId == null ? null : latestEntryByPerson.get(person.id + ':' + ownerId);
      return {
        id: person.id,
        roleAtDeath: person.role,
        homeKingdomId: person.kingdomId,
        hostKingdomId: ownerId ?? null,
        deathDay: person.deathDay,
        enteredDay: entry?.day ?? null,
        daysExposedBeforeDeath: entry ? person.deathDay - entry.day : null,
        entryReason: entry?.entryReason ?? 'entry-not-recorded',
        warningActive: entry?.warningActive ?? null,
        foodReserveAtEntry: entry?.foodReserve ?? null,
        hydrationAtEntry: entry?.hydration ?? null
      };
    });
  const otherDeaths = world.people.filter(person => !person.alive && person.deathCause !== 'invasion')
    .map(person => ({
      id: person.id,
      name: person.name,
      role: person.role,
      cause: person.deathCause,
      deathDay: person.deathDay,
      injury: Number((person.injury || 0).toFixed(2)),
      health: Number((person.health || 0).toFixed(2)),
      foodReserve: Number((person.foodReserve || 0).toFixed(2)),
      hydration: Number((person.hydration || 0).toFixed(2)),
      territoryExposure: person.territoryExposure ? { ...person.territoryExposure } : null,
      territoryAwareness: person.territoryAwareness ? { ...person.territoryAwareness } : null,
      campaignId: person.campaignId ?? null,
      recentTerritoryEntries: entries.filter(entry => entry.personId === person.id).slice(-8),
      borderIncidentHistory: incidents.filter(incident => incident.personId === person.id).slice(-12)
    }));
  const detectedExpulsions = events.filter(event => /foi descoberto e expulso/i.test(event.text));
  const attemptedEntries = Object.groupBy(entries, entry => entry.entryReason);
  const groupedDeaths = Object.groupBy(invasionDeaths, death => death.entryReason);
  const incidentProfiles = Object.groupBy(incidents, incident => [
    incident.relationStatus,
    incident.entryReason,
    incident.guard.soldiers + ' soldados/' + incident.guard.posts + ' postos'
  ].join(' | '));
  const summarizeIncidents = items => ({
    checks: items.length,
    deaths: items.filter(incident => incident.killed).length,
    deathRate: Number((items.filter(incident => incident.killed).length / items.length).toFixed(3)),
    meanDetectionChance: Number((items.reduce((sum, incident) => sum + incident.detectionChance, 0) / items.length).toFixed(3)),
    meanDeathChance: Number((items.reduce((sum, incident) => sum + incident.deathChance, 0) / items.length).toFixed(3)),
    meanExposureDays: Number((items.reduce((sum, incident) => sum + incident.exposureDays, 0) / items.length).toFixed(1))
  });

  return {
    seed,
    days,
    peopleAlive: world.people.filter(person => person.alive).length,
    deathsByCause: { ...(world.deathsByCause || {}) },
    entries: entries.length,
    entriesByReason: Object.fromEntries(Object.entries(attemptedEntries)
      .map(([reason, items]) => [reason, items.length])),
    detectedExpulsions: detectedExpulsions.length,
    detectedIncidents: incidents.length,
    detectedIncidentsByContext: Object.fromEntries(Object.entries(incidentProfiles)
      .map(([context, items]) => [context, summarizeIncidents(items)])),
    invasionDeathCount: invasionDeaths.length,
    otherDeaths,
    invasionDeathsByEntryReason: Object.fromEntries(Object.entries(groupedDeaths)
      .map(([reason, items]) => [reason, items.length])),
    invasionDeathDetails: invasionDeaths.map(({ id, ...death }) => death),
    deathsMissingEntryContext: invasionDeaths.filter(death => death.enteredDay == null).length
  };
}

console.log(JSON.stringify({ runtime: process.version, results: seeds.map(diagnose) }, null, 2));
