import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { buildingCard } from '../src/ui/building-card.js';

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
  assert.match(card, /Comida potencial ainda está no campo, não no estoque/);
  assert.match(card, /Colhido até hoje é histórico, não inventário/);
  assert.doesNotMatch(card, /Colheita acumulada/);
});
