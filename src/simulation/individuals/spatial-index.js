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
