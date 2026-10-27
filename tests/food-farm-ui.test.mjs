import test from 'node:test';
import assert from 'node:assert/strict';
import { MEAT_NUTRITIONAL_VALUE, PLANTS } from '../src/config/ecosystem.js';
import { buildingCard, kingdomOverview } from '../src/ui/building-card.js';

test('farm inspector separates standing crop, historical harvest, and seed reserve from stored food', () => {
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const world = {
    kingdoms: [],
    communities: [],
    people: [],
    structures: [],
    tiles: [{ plants: PLANTS.map(plant => plant.id === 'cultivated-root' ? 4.5 : 0) }]
  };
  const farm = { type: 'roça', complete: true, fieldTileIndices: [0], cropHarvested: 12.5, cropSeedStored: 3 };
  const card = buildingCard(world, farm);

  assert.ok(cropIndex >= 0);
  assert.match(card, /Comida potencial no campo/);
  assert.match(card, /Colhido até hoje \(histórico\)/);
  assert.match(card, /Sementes reservadas para plantio/);
  assert.match(card, /O potencial ainda está no campo, não no estoque/);
  assert.match(card, /colhido até hoje é histórico, não inventário/);
  assert.match(card, /3,3 dias de alimento potenciais/);
  assert.match(card, /12,5 dias de alimento/);
  assert.doesNotMatch(card, /Colheita acumulada/);
});

test('market, shelter and kingdom totals show one day per food unit and ten per meat unit', () => {
  const kingdom = { id: 1, memberIds: [], homeIds: [], towerIds: [], treasury: { stock: { food: 300 } },
    market: { stock: { food: 1000, meat: 4, gold: 10, wood: 4, stone: 3 }, prices: { food: 2 } } };
  const community = { id: 2, stores: { food: 0, meat: 4, wood: 0, stone: 0 }, dissolved: false };
  const world = { kingdoms: [kingdom], communities: [community], people: [], structures: [], kingdomRelations: {} };
  const market = buildingCard(world, { type: 'mercado', complete: true, kingdomId: kingdom.id });
  const shelter = buildingCard(world, { type: 'abrigo', complete: true, residentIds: [], fruitStored: 12, meatStored: 4 });
  const sharedStores = buildingCard(world, { type: 'vila', complete: true, communityId: community.id });
  const overview = kingdomOverview(world, kingdom);

  assert.match(market, /1\.000 dias alimentares/);
  assert.match(market, /ouro\/dia alimentar/);
  assert.match(shelter, /12 dias de alimento/);
  assert.match(market, /4 un\. · 40 dias alimentares/);
  assert.match(shelter, /4 un\. · 40 dias de alimento/);
  assert.match(sharedStores, /4 un\. · 40 dias de alimento/);
  assert.match(shelter, /já fazem parte do estoque comunitário/);
  assert.match(overview, /dias equivalentes/);
  assert.match(overview, /uma unidade de comida vegetal vale um dia e uma unidade física de carne vale 10 dias/);
  assert.equal(MEAT_NUTRITIONAL_VALUE, 10);
});
