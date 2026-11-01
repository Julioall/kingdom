import engine from './engine.js';
import { validTileColumnDelta } from './tile-delta.js';
import { validFieldTileDelta } from './field-delta.js';

const SCALAR_FIELDS = [
  'heightM', 'slope', 'soilCapacityMm', 'soilWaterMm', 'roadWear',
  'mineralNitrogenGPerM2', 'stoneDeposit', 'goldOre', 'copperOre', 'silverOre', 'ironOre',
  'surfaceWaterMm', 'shade',
  'temperatureC', 'rainfallMm', 'waterDist', 'nearbyHuntableAnimals', 'nearbyFish',
  'huntingSuitability', 'fishingSuitability', 'elevationLevel', 'autoTileVariant',
  'rampSide', 'rampLevel', 'rampSegment'
];
const ID_FIELDS = ['regionId', 'kingdomId', 'lakeId', 'cropFieldId', 'stumpUntilDay',
  'berryBushHiddenUntilDay', 'browseBushHiddenUntilDay'];
const STUMP_ID_INDEX = ID_FIELDS.indexOf('stumpUntilDay');
const TYPE_FIELDS = ['terrain', 'soilType', 'waterKind'];
const TYPE_VALUES = [
  ['land', 'water', 'rock'],
  ['loam', 'shallow', 'sandy', 'riparian', 'water'],
  ['', 'lake', 'river', 'spring', 'ocean']
];

function typeCode(fieldIndex, value) {
  const values = TYPE_VALUES[fieldIndex];
  const code = values.indexOf(value == null ? '' : value);
  if (code < 0) throw new Error('Valor de ' + TYPE_FIELDS[fieldIndex] + ' não representado no snapshot: ' + value);
  return code;
}

export function createWorldSnapshot(world, { reset = false } = {}) {
  const tileCount = world.tiles.length;
  const plantCount = engine.plants.length;
  const scalars = new Float32Array(tileCount * SCALAR_FIELDS.length);
  const ids = new Int32Array(tileCount * ID_FIELDS.length);
  const types = new Uint8Array(tileCount * TYPE_FIELDS.length);
  const plants = new Float32Array(tileCount * plantCount);

  for (let index = 0; index < tileCount; index++) {
    const tile = world.tiles[index], scalarOffset = index * SCALAR_FIELDS.length;
    const idOffset = index * ID_FIELDS.length, typeOffset = index * TYPE_FIELDS.length;
    for (let field = 0; field < SCALAR_FIELDS.length; field++) scalars[scalarOffset + field] = tile[SCALAR_FIELDS[field]] || 0;
    for (let field = 0; field < ID_FIELDS.length; field++) {
      const value = field === STUMP_ID_INDEX ? tile.stump?.untilDay : tile[ID_FIELDS[field]];
      ids[idOffset + field] = Number.isInteger(value) ? value : -1;
    }
    for (let field = 0; field < TYPE_FIELDS.length; field++) types[typeOffset + field] = typeCode(field, tile[TYPE_FIELDS[field]]);
    plants.set(tile.plants, index * plantCount);
  }

  const { tiles: _tiles, waterTiles: _waterTiles, events, logs, ...base } = world;
  return {
    base,
    tileColumns: { scalars, ids, types, plants, tileCount, plantCount },
    stats: engine.snapshot(world),
    // Events are a short, newest-first ring. Loose logs can change after they
    // are created, so both lists are sent as authoritative small collections.
    events: (events || []).slice(),
    logs: (logs || []).slice(),
    reset
  };
}

/**
 * @param {import('./protocol').WorldSnapshot} snapshot
 * @param {import('./protocol').WorldView | null} [previous]
 * @returns {import('./protocol').WorldView}
 */
export function applyWorldSnapshot(snapshot, previous = null) {
  const { base, tileColumns } = snapshot;
  const sameGrid = !snapshot.reset && previous && previous.width === base.width && previous.height === base.height
    && previous.tiles.length === tileColumns.tileCount;
  const view = sameGrid ? previous : {
    ...base,
    tiles: new Array(tileColumns.tileCount),
    waterTiles: [],
    events: [],
    logs: []
  };
  Object.assign(view, base);
  if (snapshot.reset || !sameGrid) { view.events = []; view.logs = []; }

  for (let index = 0; index < tileColumns.tileCount; index++) {
    let tile = view.tiles[index];
    if (!tile) {
      tile = { plants: new Float32Array(tileColumns.plantCount) };
      view.tiles[index] = tile;
    }
    const scalarOffset = index * SCALAR_FIELDS.length;
    const idOffset = index * ID_FIELDS.length;
    const typeOffset = index * TYPE_FIELDS.length;
    tile.i = index;
    tile.x = index % view.width;
    tile.y = Math.floor(index / view.width);
    for (let field = 0; field < SCALAR_FIELDS.length; field++) tile[SCALAR_FIELDS[field]] = tileColumns.scalars[scalarOffset + field];
    for (let field = 0; field < ID_FIELDS.length; field++) {
      if (field === STUMP_ID_INDEX) continue;
      const value = tileColumns.ids[idOffset + field];
      tile[ID_FIELDS[field]] = value < 0 ? null : value;
    }
    const stumpUntilDay = tileColumns.ids[idOffset + STUMP_ID_INDEX];
    tile.stump = stumpUntilDay < 0 ? null : { untilDay: stumpUntilDay };
    for (let field = 0; field < TYPE_FIELDS.length; field++) {
      tile[TYPE_FIELDS[field]] = TYPE_VALUES[field][tileColumns.types[typeOffset + field]] || null;
    }
    tile.plants.set(tileColumns.plants.subarray(index * tileColumns.plantCount, (index + 1) * tileColumns.plantCount));
  }

  if (!sameGrid) view.waterTiles = view.tiles.filter(tile => tile.terrain === 'water');
  view.events.splice(0, view.events.length, ...snapshot.events);
  view.logs.splice(0, view.logs.length, ...snapshot.logs);
  view.stats = snapshot.stats;
  return view;
}

/** Apply a sparse tile-only update with the SAME field semantics as a full
 * WorldSnapshot. The caller must verify epoch/baseRevision first.
 * @param {import('./protocol').WorldTileDelta} delta
 * @param {import('./protocol').WorldView} previous
 * @returns {import('./protocol').WorldView}
 */
function applyWorldFieldTileDelta(delta, previous) {
  const fields = delta?.tileColumns;
  if (!previous || !delta || delta.reset || !delta.base ||
      previous.width !== delta.base.width || previous.height !== delta.base.height ||
      !validFieldTileDelta(fields, {
        tileCount: previous.tiles.length, plantCount: engine.plants.length,
        scalarFields: SCALAR_FIELDS.length, idFields: ID_FIELDS.length,
        typeFields: TYPE_FIELDS.length
      })) throw new Error('O delta de campos não corresponde ao estado atual.');
  Object.assign(previous, delta.base);
  let waterChanged = false;
  const eachValue = (entries, apply) => {
    for (const entry of entries) {
      const positions = entry.indices;
      for (let row = 0; row < entry.values.length; row++) {
        const index = positions ? positions[row] : row;
        const tile = previous.tiles[index];
        if (!tile || !tile.plants || tile.plants.length !== fields.plantCount)
          throw new Error('Tile ausente no delta de campos.');
        apply(tile, entry.field, entry.values[row]);
      }
    }
  };
  eachValue(fields.fields.scalars, (tile, field, value) => {
    tile[SCALAR_FIELDS[field]] = value;
  });
  eachValue(fields.fields.ids, (tile, field, value) => {
    if (field === STUMP_ID_INDEX) tile.stump = value < 0 ? null : { untilDay: value };
    else tile[ID_FIELDS[field]] = value < 0 ? null : value;
  });
  eachValue(fields.fields.types, (tile, field, value) => {
    const key = TYPE_FIELDS[field];
    const next = TYPE_VALUES[field][value] || null;
    if (field === 0 && tile.terrain !== next) waterChanged = true;
    tile[key] = next;
  });
  eachValue(fields.fields.plants, (tile, field, value) => {
    tile.plants[field] = value;
  });
  if (waterChanged) previous.waterTiles = previous.tiles.filter(tile => tile.terrain === 'water');
  previous.events.splice(0, previous.events.length, ...delta.events);
  previous.logs.splice(0, previous.logs.length, ...delta.logs);
  previous.stats = delta.stats;
  return previous;
}

export function applyWorldTileDelta(delta, previous) {
  if (delta?.tileColumns?.schemaVersion === 2) return applyWorldFieldTileDelta(delta, previous);
  if (!previous || !delta || delta.reset || !delta.base ||
      previous.width !== delta.base.width || previous.height !== delta.base.height ||
      !validTileColumnDelta(delta.tileColumns, previous.tiles.length, engine.plants.length)) {
    throw new Error('O delta de tiles não corresponde ao estado atual.');
  }
  const { base, tileColumns } = delta;
  Object.assign(previous, base);
  let waterChanged = false;
  for (let row = 0; row < tileColumns.indices.length; row++) {
    const index = tileColumns.indices[row];
    const tile = previous.tiles[index];
    if (!tile || !tile.plants || tile.plants.length !== tileColumns.plantCount) {
      throw new Error('Tile inexistente ou incompatível no delta.');
    }
    const oldTerrain = tile.terrain;
    const scalarOffset = row * SCALAR_FIELDS.length;
    const idOffset = row * ID_FIELDS.length;
    const typeOffset = row * TYPE_FIELDS.length;
    for (let field = 0; field < SCALAR_FIELDS.length; field++)
      tile[SCALAR_FIELDS[field]] = tileColumns.scalars[scalarOffset + field];
    for (let field = 0; field < ID_FIELDS.length; field++) {
      if (field === STUMP_ID_INDEX) continue;
      const value = tileColumns.ids[idOffset + field];
      tile[ID_FIELDS[field]] = value < 0 ? null : value;
    }
    const stumpUntilDay = tileColumns.ids[idOffset + STUMP_ID_INDEX];
    tile.stump = stumpUntilDay < 0 ? null : { untilDay: stumpUntilDay };
    for (let field = 0; field < TYPE_FIELDS.length; field++)
      tile[TYPE_FIELDS[field]] = TYPE_VALUES[field][tileColumns.types[typeOffset + field]] || null;
    tile.plants.set(tileColumns.plants.subarray(row * tileColumns.plantCount,
      (row + 1) * tileColumns.plantCount));
    if (oldTerrain !== tile.terrain) waterChanged = true;
  }
  if (waterChanged) previous.waterTiles = previous.tiles.filter(tile => tile.terrain === 'water');
  previous.events.splice(0, previous.events.length, ...delta.events);
  previous.logs.splice(0, previous.logs.length, ...delta.logs);
  previous.stats = delta.stats;
  return previous;
}

export function transferablesForSnapshot(snapshot) {
  const columns = snapshot?.tileColumns;
  return columns ? [columns.scalars.buffer, columns.ids.buffer, columns.types.buffer, columns.plants.buffer] : [];
}
