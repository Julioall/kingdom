import test from 'node:test';
import assert from 'node:assert/strict';
import { paintMinimap } from '../src/ui/render/minimap.js';

function recorder() {
  const calls = [];
  let fillStyle, strokeStyle, lineWidth;
  const map = {
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    fillRect(...args) { calls.push(['fillRect', fillStyle, ...args]); },
    strokeRect(...args) { calls.push(['strokeRect', strokeStyle, lineWidth, ...args]); },
    set fillStyle(value) { fillStyle = value; },
    set strokeStyle(value) { strokeStyle = value; },
    set lineWidth(value) { lineWidth = value; }
  };
  return { map, calls };
}

test('pure minimap renderer retains tile/actor/viewport drawing order and sizes', () => {
  const { map, calls } = recorder();
  const tiles = [
    { terrain: 'water', kingdomId: null, plants: [] },
    { terrain: 'land', kingdomId: 1, plants: [] },
    { terrain: 'land', kingdomId: null, plants: [60, 25] },
    { terrain: 'land', kingdomId: null, plants: [1, 2] }
  ];
  const world = {
    structures: [{ x: 1, y: 1, kingdomId: 1 }],
    people: [
      { x: 1, y: 0, kingdomId: 1, alive: true, restingStructureId: null },
      { x: 0, y: 1, kingdomId: 1, alive: true, restingStructureId: 22 }
    ],
    animals: [{ x: .5, y: 1.5, alive: true }, { x: 1, y: 1, alive: false }]
  };
  paintMinimap({ map, width: 20, height: 20, W: 2, H: 2, world,
    cell: (x, y) => tiles[y * 2 + x],
    getKingdom: id => id === 1 ? { palette: 'red' } : null,
    view: { x: 10, y: 20, width: 30, height: 40 }, LOGICAL_SIZE: 100 });
  assert.deepEqual(calls, [
    ['clearRect', 0, 0, 20, 20],
    ['fillRect', '#3995a8', 0, 0, 10.1, 10.1],
    ['fillRect', '#b74f45', 10, 0, 10.1, 10.1],
    ['fillRect', '#78934e', 0, 10, 10.1, 10.1],
    ['fillRect', '#958751', 10, 10, 10.1, 10.1],
    ['fillRect', '#b74f45', .4, .4, 1.4, 1.4],
    ['fillRect', '#b74f45', .65, -.35, .8, .8],
    ['fillRect', '#fff1d0', .2, 1.2, .7, .7],
    ['strokeRect', '#fff4ce', 1.25, 2.5, 4.5, 5, 7]
  ]);
});
