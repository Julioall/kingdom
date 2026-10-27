import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
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

test('market, shelter and kingdom totals label food in adult-days and meat by physical unit', () => {
  const kingdom = { id: 1, memberIds: [], homeIds: [], towerIds: [], treasury: { stock: { food: 300 } },
    market: { stock: { food: 1000, meat: 0, gold: 10, wood: 4, stone: 3 }, prices: { food: 2 } } };
  const world = { kingdoms: [kingdom], communities: [], people: [], structures: [], kingdomRelations: {} };
  const market = buildingCard(world, { type: 'mercado', complete: true, kingdomId: kingdom.id });
  const shelter = buildingCard(world, { type: 'abrigo', complete: true, residentIds: [], fruitStored: 12, meatStored: 4 });
  const overview = kingdomOverview(world, kingdom);

  assert.match(market, /1\.000 dias alimentares/);
  assert.match(market, /ouro\/dia alimentar/);
  assert.match(shelter, /12 dias de alimento/);
  assert.match(shelter, /4 un\. físicas · 2,5 dias\/un\./);
  assert.match(shelter, /já fazem parte do estoque comunitário/);
  assert.match(overview, /dias equivalentes/);
  assert.match(overview, /cada unidade de comida vale um dia adulto/);
});
