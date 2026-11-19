import { HUMAN_ADOLESCENT_AGE_DAYS } from '../individuals/human-age.js';

export const CIVILIZATION_LEVELS = Object.freeze([
  'sobrevivencia', 'individuo', 'familia', 'comunidade', 'reino', 'defesa_organizada'
]);
const WORK_KINDS = new Set(['harvest', 'forage', 'fish', 'hunt', 'chop', 'mine', 'build', 'repair']);
const FOOD_KINDS = new Set(['harvest', 'forage', 'fish', 'hunt']);
const EVIDENCE_WINDOW_DAYS = 30;

// A short, auditable record of performed livelihood actions; no birthday,
// census size or sovereign command can certify a pawn as independent.
export function recordIndividualLivelihood(world, day) {
  for (const person of world.people || []) {
    if (!person.alive || person.ageDays < HUMAN_ADOLESCENT_AGE_DAYS) continue;
    const evidence = person.livelihoodEvidence || (person.livelihoodEvidence = { days: [] });
    if (evidence.days.some(record => record.day === day)) continue;
    const visibleKind = person.visualActivity?.day === day ? person.visualActivity.kind : null;
    // Community rations are valid social care, but they do not certify
    // *individual* self-provisioning. Read the actual cumulative meal ledger.
    const sharedMeals = Number.isFinite(person.sharedMeals) ? person.sharedMeals : 0;
    const subsidizedToday = sharedMeals > (evidence.lastSharedMeals ?? sharedMeals) + .001;
    evidence.lastSharedMeals = sharedMeals;
    evidence.days.push({
      day,
      healthy: person.health >= 45 && person.foodReserve >= 22 && person.hydration >= 25
        && !subsidizedToday,
      worked: WORK_KINDS.has(visibleKind),
      provisioned: FOOD_KINDS.has(visibleKind),
      sold: person.lastPersonalSaleDay === day,
      boughtFood: person.lastPersonalFoodPurchaseDay === day
    });
    evidence.days = evidence.days.filter(record => day - record.day < EVIDENCE_WINDOW_DAYS);
    const viable = evidence.days.filter(record => record.healthy);
    const productive = evidence.days.filter(record => record.worked);
    const provisioned = evidence.days.filter(record => record.provisioned);
    const sales = evidence.days.filter(record => record.sold);
    const purchases = evidence.days.filter(record => record.boughtFood);
    evidence.healthyDays = viable.length;
    evidence.workDays = productive.length;
    evidence.provisionDays = provisioned.length;
    evidence.sales = sales.length;
    evidence.foodPurchases = purchases.length;
    evidence.selfReliant = person.role !== 'soldier' && viable.length >= 20
      && productive.length >= 4
      && (provisioned.length >= 3 || sales.length >= 1 && purchases.length >= 1);
    if (evidence.selfReliant && evidence.firstProvenDay == null) evidence.firstProvenDay = day;
  }
}

function realHouseholds(world, peopleById) {
  const households = [];
  for (const home of world.structures || []) {
    if (!home.complete || !['casa', 'abrigo'].includes(home.type)
      || home.destroyedDay != null || home.integrity === 0) continue;
    const members = (home.residentIds || []).map(id => peopleById.get(id))
      .filter(person => person && person.homeId === home.id);
    const parents = members.filter(person => person.ageDays >= HUMAN_ADOLESCENT_AGE_DAYS
      && person.partnerId != null);
    const pair = parents.find(person => parents.some(other => other.id === person.partnerId
      && other.partnerId === person.id && person.id < other.id));
    if (!pair) continue;
    const partner = parents.find(person => person.id === pair.partnerId);
    const children = members.filter(child => Array.isArray(child.parents)
      && child.parents.includes(pair.id) && child.parents.includes(partner.id));
    if (!children.length) continue;
    households.push({
      homeId: home.id, communityId: pair.communityId,
      parentIds: [pair.id, partner.id], childIds: children.map(child => child.id),
      selfSupportingParents: !!pair.livelihoodEvidence?.selfReliant
        && !!partner.livelihoodEvidence?.selfReliant
    });
  }
  return households.sort((a, b) => a.homeId - b.homeId);
}

// Observation only. A prebuilt castle is explicitly NOT evidence that a
// community evolved into a kingdom. Future institution formation must write
// an audited civicCharter after consent, finances and governance are resolved.
export function assessCivilizationProgress(world) {
  const alive = (world.people || []).filter(person => person.alive);
  const peopleById = new Map(alive.map(person => [person.id, person]));
  const capable = alive.filter(person => person.ageDays >= HUMAN_ADOLESCENT_AGE_DAYS
    && person.livelihoodEvidence?.selfReliant);
  const homes = realHouseholds(world, peopleById);
  const supportingFamilies = homes.filter(home => home.selfSupportingParents);
  const validCommunities = (world.communities || []).filter(group => !group.dissolved
    && group.leaderId != null && (group.tradeCount || 0) > 0
    && (group.stores?.food || 0) > 0
    && supportingFamilies.filter(home => home.communityId === group.id).length >= 2);
  const institutions = (world.kingdoms || []).filter(kingdom => {
    const charter = kingdom.civicCharter;
    return charter && charter.foundingCommunityIds?.length >= 1
      && charter.acceptedDay != null
      && charter.foundingCommunityIds.some(id => validCommunities.some(group => group.id === id));
  });
  const defense = institutions.filter(kingdom => {
    const structures = (world.structures || []).filter(structure => structure.kingdomId === kingdom.id
      && structure.complete && structure.destroyedDay == null);
    return structures.some(s => s.type === 'centro_militar')
      && structures.some(s => s.type === 'torre')
      && alive.some(person => person.kingdomId === kingdom.id && person.role === 'soldier'
        && person.militaryCenterId != null);
  });
  const unlocked = [
    true,
    capable.length >= 1,
    capable.length >= 2 && supportingFamilies.length >= 1,
    validCommunities.length >= 1,
    institutions.length >= 1,
    defense.length >= 1
  ];
  let levelIndex = 0;
  for (let i = 1; i < unlocked.length && unlocked[i]; i++) levelIndex = i;
  return {
    level: CIVILIZATION_LEVELS[levelIndex],
    reached: Object.fromEntries(CIVILIZATION_LEVELS.map((label, i) => [label, i <= levelIndex])),
    evidence: {
      livingPawns: alive.length,
      independentlyProvisioning: capable.length,
      livingFamilies: homes.length,
      selfSupportingFamilies: supportingFamilies.length,
      communitiesWithProductionAndTrade: validCommunities.length,
      legitimateNewKingdoms: institutions.length,
      trainedDefenseNetworks: defense.length,
      prebuiltKingdomsWithoutCharter: (world.kingdoms || []).length - institutions.length
    },
    nextRequirement: CIVILIZATION_LEVELS[levelIndex + 1] || null
  };
}
