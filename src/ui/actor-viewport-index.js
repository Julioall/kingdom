// Snapshot-scoped spatial broad-phase for actors. The authoritative world and
// movement interpolator are not mutated. Every point in a retained movement
// segment is included, so stale/lagged interpolation cannot lose a visible actor.
export function createActorViewportIndex(world, getSweptBounds, chunkSize = 12) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw Error('Invalid actor viewport chunk size');
  const types = {person: world.people || [], animal: world.animals || []};
  const bins = {person: new Map(), animal: new Map()};
  const globalActors = {person: [], animal: []};
  let lastExamined = 0, lastReturned = 0;
  for (const [kind, actors] of Object.entries(types)) {
    actors.forEach((actor, order) => {
      if (!actor.alive) return;
      const movement = getSweptBounds?.(kind, actor);
      const xmin = Math.min(actor.x, movement?.minX ?? actor.x) - 3;
      const xmax = Math.max(actor.x, movement?.maxX ?? actor.x) + 3;
      const ymin = Math.min(actor.y, movement?.minY ?? actor.y) - 3;
      const ymax = Math.max(actor.y, movement?.maxY ?? actor.y) + 3;
      const record = {actor, order, xmin, xmax, ymin, ymax};
      // Combat position can be animated independently from interpolation.
      // Indexing every combat trajectory is fragile; keep it in the global
      // candidate list instead of accidentally culling it during an attack.
      if (!Number.isFinite(xmin + xmax + ymin + ymax)
          || (kind === 'person' && (actor.playerControlled || actor.combatAction
            || actor.combatLaunch || actor.combatDefense))
          || (Math.floor(xmax / chunkSize) - Math.floor(xmin / chunkSize) + 1)
             * (Math.floor(ymax / chunkSize) - Math.floor(ymin / chunkSize) + 1) > 48) {
        globalActors[kind].push(record); return;
      }
      for(let y=Math.floor(ymin/chunkSize);y<=Math.floor(ymax/chunkSize);y++)
        for(let x=Math.floor(xmin/chunkSize);x<=Math.floor(xmax/chunkSize);x++){
          const key=x+':'+y;
          let bucket=bins[kind].get(key);
          if (!bucket) bins[kind].set(key,bucket=[]);
          bucket.push(record);
        }
    });
  }
  function query(kind, bounds) {
    const all=types[kind];
    if (!all) throw Error('Unsupported actor kind');
    if (!bounds || ![bounds.minX,bounds.maxX,bounds.minY,bounds.maxY].every(Number.isFinite))
      return [];
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return [];
    // Full-world zoom already has all actors in insertion order.
    if (bounds.minX <= 0 && bounds.maxX >= world.width-1
        && bounds.minY <= 0 && bounds.maxY >= world.height-1) {
      lastExamined = all.length; lastReturned = all.length;
      return all;
    }
    const touched=new Set(),records=[];
    function consider(record, force = false) {
      if (touched.has(record)) return;
      touched.add(record);
      if (force || (record.xmax >= bounds.minX && record.xmin <= bounds.maxX
          && record.ymax >= bounds.minY && record.ymin <= bounds.maxY)) records.push(record);
    }
    // Combat presentation and player prediction can move independently from
    // snapshot interpolation. Never broad-phase-cull these actors.
    for (const record of globalActors[kind]) consider(record, true);
    for (let y=Math.floor(bounds.minY/chunkSize);y<=Math.floor(bounds.maxY/chunkSize);y++)
      for (let x=Math.floor(bounds.minX/chunkSize);x<=Math.floor(bounds.maxX/chunkSize);x++){
        const recordsInBin=bins[kind].get(x+':'+y);
        if (recordsInBin) for(const record of recordsInBin) consider(record);
      }
    records.sort((a,b)=>a.order-b.order);
    lastExamined = touched.size; lastReturned = records.length;
    return records.map(record=>record.actor);
  }
  return {query, stats:()=>({
    people:types.person.length,animals:types.animal.length,
    bins:bins.person.size+bins.animal.size,
    global:globalActors.person.length+globalActors.animal.length,
    lastExamined,lastReturned
  })};
}
