import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFormation, formationSlot, measureFormation, recordFormationBlockedMove,
  setFormationState, setFormationType
} from '../../src/simulation/kingdoms/formations.js';

test('line and column formations give stable, spaced positions along their heading', () => {
  const formation = createFormation({ campaignId: 8, kingdomId: 1, role: 'attacker',
    memberIds: [11, 12, 13, 14], origin: { x: 0, y: 0 }, destination: { x: 10, y: 0 }, day: 1 });
  const column = formation.memberIds.map(id => formationSlot(formation, id));
  assert.deepEqual(column.map(slot => Number(slot.x.toFixed(2))), [10, 8, 6, 4]);
  assert.ok(column.every(slot => slot.y === 0));

  assert.equal(setFormationType(formation, 'line', 2, 'campo aberto'), true);
  const line = formation.memberIds.map(id => formationSlot(formation, id));
  assert.ok(line.every(slot => Math.abs(slot.x - 10) < .001));
  const expectedOffsets = [-3, -1, 1, 3];
  for (let index = 0; index < line.length; index++) assert.ok(Math.abs(line[index].y - expectedOffsets[index]) < .001);
  assert.equal(setFormationType(formation, 'line', 3, 'sem mudança'), false);
});

test('formation states record explicit transitions and reject unknown states', () => {
  const formation = createFormation({ campaignId: 2, kingdomId: 3, role: 'defender',
    memberIds: [5, 6], origin: { x: 4, y: 4 }, destination: { x: 8, y: 4 }, day: 10 });
  assert.equal(setFormationState(formation, 'marching', 12, 'mobilização concluída'), true);
  assert.equal(setFormationState(formation, 'maintaining', 14, 'manter a frente'), true);
  assert.equal(setFormationState(formation, 'unrestricted_attack', 15, 'inválido'), false);
  assert.deepEqual(formation.transitions.map(item => item.to), ['forming', 'marching', 'maintaining']);
  assert.equal(formation.orderVersion, 2);
});

test('formation metrics measure spacing, exposed posts and blocked movement', () => {
  const formation = createFormation({ campaignId: 4, kingdomId: 2, role: 'attacker',
    memberIds: [21, 22], origin: { x: 0, y: 0 }, destination: { x: 10, y: 0 }, day: 1 });
  const members = [
    { id: 21, alive: true, x: 10, y: 0 },
    { id: 22, alive: true, x: 8, y: 0 }
  ];
  assert.equal(measureFormation(formation, members, 2).cohesion, 1);
  members[1].x = 4;
  const degraded = measureFormation(formation, members, 3);
  assert.ok(degraded.cohesion < 1);
  assert.equal(degraded.outsideSlots, 1);
  recordFormationBlockedMove(formation);
  assert.equal(formation.metrics.blockedMoves, 1);
});
