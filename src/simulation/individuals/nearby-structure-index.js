// Daily, read-only broad-phase of fixed-position structure anchors.
// Mutable completion, destruction, type and community membership are checked
// against the LIVE structure at query time. Newly created structures are
// appended before every query. Reset/array replacement rebuilds the index.
export function createNearbyStructureIndex(world, chunkSize = 8) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
    throw new Error('Invalid structure query cell size');
  const bins = new Map();
  let indexedArray = world.structures || [], nextIndex = 0;
  let queryCount = 0, examined = 0;
  function clear() { bins.clear(); nextIndex = 0; }
  function add(structure) {
    if (!structure || !Number.isFinite(structure.x) || !Number.isFinite(structure.y)) return;
    const key = Math.floor(structure.x / chunkSize)+':'+Math.floor(structure.y / chunkSize);
    let bucket = bins.get(key);
    if (!bucket) bins.set(key,bucket=[]);
    bucket.push(structure);
  }
  function ensure() {
    const source = world.structures || [];
    if (source !== indexedArray || source.length < nextIndex) {
      clear(); indexedArray = source;
    }
    while (nextIndex < source.length) add(source[nextIndex++]);
  }
  function hasShelterNearby(person, community, radius = 4) {
    if (!community || !person || !Number.isFinite(person.x) || !Number.isFinite(person.y))
      return false;
    ensure();
    queryCount++;
    for(let cy=Math.floor((person.y-radius)/chunkSize);cy<=Math.floor((person.y+radius)/chunkSize);cy++)
      for(let cx=Math.floor((person.x-radius)/chunkSize);cx<=Math.floor((person.x+radius)/chunkSize);cx++){
        for(const s of bins.get(cx+':'+cy)||[]){
          examined++;
          if (s.complete && s.type === 'abrigo' && person.communityId === s.communityId
            && Math.hypot(person.x-s.x,person.y-s.y) <= radius)
            return true;
        }
      }
    return false;
  }
  return { hasShelterNearby, stats:()=>({queries:queryCount,examined,indexed:nextIndex,bins:bins.size}) };
}
