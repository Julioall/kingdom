import { PLANTS } from '../src/config/ecosystem.js';

function countCauses(entities) {
  const counts = {};
  for (const entity of entities) {
    if (entity?.alive !== false) continue;
    const cause = entity.deathCause || 'unattributed';
    counts[cause] = (counts[cause] || 0) + 1;
  }
  return counts;
}

export function summarizeCultivatedFields(world) {
  const rootIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const fields = (world?.structures || []).filter(structure => structure?.type === 'roça');
  const standingBiomass = field => (field.fieldTileIndices || []).reduce((sum, index) => {
    const tile = world?.tiles?.[index];
    return sum + (rootIndex >= 0 ? Number(tile?.plants?.[rootIndex]) || 0 : 0);
  }, 0);
  const summarize = field => ({
    id: field.id ?? null,
    communityId: field.communityId ?? null,
    complete: !!field.complete,
    destroyed: field.destroyedDay != null || field.integrity === 0,
    progress: Number(field.progress) || 0,
    required: Number(field.required) || 0,
    builtDay: Number.isFinite(field.builtDay) ? field.builtDay : null,
    fieldTileCount: (field.fieldTileIndices || []).length,
    standingBiomass: Number(standingBiomass(field).toFixed(2)),
    cropSeedStored: Number((Number(field.cropSeedStored) || 0).toFixed(2)),
    cropSeededBiomass: Number((Number(field.cropSeededBiomass) || 0).toFixed(2)),
    cropHarvested: Number((Number(field.cropHarvested) || 0).toFixed(2))
  });
  const rows = fields.map(summarize).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return {
    fieldCount: rows.length,
    completeFieldCount: rows.filter(field => field.complete && !field.destroyed).length,
    totalFieldTiles: rows.reduce((sum, field) => sum + field.fieldTileCount, 0),
    standingBiomass: Number(rows.reduce((sum, field) => sum + field.standingBiomass, 0).toFixed(2)),
    cropSeedStored: Number(rows.reduce((sum, field) => sum + field.cropSeedStored, 0).toFixed(2)),
    cropSeededBiomass: Number(rows.reduce((sum, field) => sum + field.cropSeededBiomass, 0).toFixed(2)),
    cropHarvested: Number(rows.reduce((sum, field) => sum + field.cropHarvested, 0).toFixed(2)),
    fields: rows
  };
}

export function summarizeFoodDeaths(world) {
  const deadPeople = (world?.people || []).filter(person => person?.alive === false);
  const deadAnimals = (world?.animals || []).filter(animal => animal?.alive === false);
  const domesticAnimals = deadAnimals.filter(animal => animal.herdCommunityId != null);
  const wildAnimals = deadAnimals.filter(animal => animal.herdCommunityId == null);
  return {
    people: { total: deadPeople.length, byCause: countCauses(deadPeople) },
    animals: { total: deadAnimals.length, byCause: countCauses(deadAnimals) },
    domesticatedAnimals: { total: domesticAnimals.length, byCause: countCauses(domesticAnimals) },
    wildAnimals: { total: wildAnimals.length, byCause: countCauses(wildAnimals) }
  };
}

export function summarizeCampaignFoodLogistics(world) {
  const sides = [];
  for (const campaign of world?.campaigns || []) for (const side of [campaign.attacker, campaign.defender]) {
    if (!side) continue;
    const ledger = side.supplyLedger;
    if (!ledger) {
      sides.push({ campaignId: campaign.id, kingdomId: side.kingdomId, role: side.role,
        status: campaign.status, ledgerPresent: false, fieldFoodBalance: null });
      continue;
    }
    const value = amount => Number.isFinite(Number(amount)) ? Number(amount) : 0;
    const deployed = value(ledger.deployment?.food);
    const treasury = value(ledger.resupplySources?.food?.treasury);
    const community = value(ledger.resupplySources?.food?.community);
    const recordedResupply = ledger.resupply?.food;
    const resupplied = Number.isFinite(Number(recordedResupply)) ? Number(recordedResupply) : treasury + community;
    const consumed = value(ledger.rationConsumptionFood);
    const returned = value(ledger.returned?.food);
    const endingStock = value(side.supply?.stock?.food);
    sides.push({ campaignId: campaign.id, kingdomId: side.kingdomId, role: side.role,
      status: campaign.status, ledgerPresent: true, fieldFoodDeployed: deployed,
      fieldFoodResupplied: resupplied, resupplyFromTreasury: treasury,
      resupplyFromCommunity: community, fieldFoodConsumed: consumed,
      personalReserveRationPoints: value(ledger.personalReserveRationPoints),
      fieldFoodReturned: returned, endingFieldFood: endingStock,
      resupplySourceDelta: Number((resupplied - treasury - community).toFixed(4)),
      fieldFoodBalance: Number((deployed + resupplied - consumed - returned - endingStock).toFixed(4)) });
  }
  const totals = {};
  for (const key of ['fieldFoodDeployed', 'fieldFoodResupplied', 'resupplyFromTreasury', 'resupplyFromCommunity',
    'fieldFoodConsumed', 'personalReserveRationPoints', 'fieldFoodReturned', 'endingFieldFood',
    'resupplySourceDelta', 'fieldFoodBalance']) {
    totals[key] = Number(sides.reduce((sum, side) => sum + (side.ledgerPresent ? side[key] || 0 : 0), 0).toFixed(4));
  }
  const sidesWithoutLedger = sides.filter(side => !side.ledgerPresent).length;
  const ledgerSides = sides.filter(side => side.ledgerPresent);
  const unbalancedSides = ledgerSides.filter(side => Math.abs(side.fieldFoodBalance) > .001).length;
  const resupplySourceMismatchSides = ledgerSides.filter(side => Math.abs(side.resupplySourceDelta) > .001).length;
  return { sideCount: sides.length, sidesWithoutLedger, ledgerCoverageComplete: sidesWithoutLedger === 0,
    unbalancedSides, resupplySourceMismatchSides,
    totals, sides };
}
