const DEFAULT_CELL_SIZE = 8;

function bucketKey(x, y, cellSize) {
  return Math.floor(x / cellSize) + ',' + Math.floor(y / cellSize);
}

export function createPersonSpatialIndex(people, cellSize = DEFAULT_CELL_SIZE) {
  const buckets = new Map();
  const records = new Map();

  function add(record) {
    let bucket = buckets.get(record.key);
    if (!bucket) buckets.set(record.key, bucket = new Set());
    bucket.add(record);
  }

  let order = 0;
  for (const person of people || []) {
    const currentOrder = order++;
    if (!person?.alive) continue;
    const record = { person, order: currentOrder, key: bucketKey(person.x, person.y, cellSize) };
    records.set(person, record);
    add(record);
  }

  return {
    query(x, y, radius) {
      const minX = Math.floor((x - radius) / cellSize), maxX = Math.floor((x + radius) / cellSize);
      const minY = Math.floor((y - radius) / cellSize), maxY = Math.floor((y + radius) / cellSize);
      const found = [];
      for (let bucketY = minY; bucketY <= maxY; bucketY++) {
        for (let bucketX = minX; bucketX <= maxX; bucketX++) {
          const bucket = buckets.get(bucketX + ',' + bucketY);
          if (bucket) for (const record of bucket) found.push(record);
        }
      }
      found.sort((a, b) => a.order - b.order);
      return found.map(record => record.person);
    },
    // Equivalent to query(...).find(predicate) for pure predicates, but
    // avoids sorting/allocating a candidate array for occupancy probes.
    // The minimum original order preserves the deterministic world.people
    // tie-break even after actors move between hash buckets.
    findFirst(x, y, radius, predicate) {
      const minX = Math.floor((x - radius) / cellSize), maxX = Math.floor((x + radius) / cellSize);
      const minY = Math.floor((y - radius) / cellSize), maxY = Math.floor((y + radius) / cellSize);
      let first = null;
      for (let bucketY = minY; bucketY <= maxY; bucketY++) {
        for (let bucketX = minX; bucketX <= maxX; bucketX++) {
          const bucket = buckets.get(bucketX + ',' + bucketY);
          if (!bucket) continue;
          for (const record of bucket) {
            if ((!first || record.order < first.order) && predicate(record.person))
              first = record;
          }
        }
      }
      return first ? first.person : undefined;
    },
    move(person) {
      const record = records.get(person);
      if (!record) return;
      const nextKey = bucketKey(person.x, person.y, cellSize);
      if (record.key === nextKey) return;
      const previousBucket = buckets.get(record.key);
      previousBucket?.delete(record);
      if (previousBucket?.size === 0) buckets.delete(record.key);
      record.key = nextKey;
      add(record);
    }
  };
}

export function peopleNear(world, x, y, radius) {
  return world.peopleSpatialIndex
    ? world.peopleSpatialIndex.query(x, y, radius)
    : world.people || [];
}

/** Query a single actor without a sorted candidate array when indexed. */
export function firstPersonNear(world, x, y, radius, predicate) {
  return typeof world.peopleSpatialIndex?.findFirst === 'function'
    ? world.peopleSpatialIndex.findFirst(x, y, radius, predicate)
    : peopleNear(world, x, y, radius).find(predicate);
}
