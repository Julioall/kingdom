// JUL-277: experimental lossless *resource perception rows* diff codec.
// Not yet wired into Worker transport. Test it against actual game perceptions
// and measure benefits/CPU before enabling in production.
//
// Row identities come from tileIndex, which the perception engine emits once
// per cell. Patches are immutable and validate the whole collection before
// returning a replacement array. Anything unsupported fails closed.
const forbidden = new Set(['__proto__','constructor','prototype']);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const validId = id => Number.isSafeInteger(id) && id >= 0;
function safeValue(value, visiting=new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value,-0);
  if (!value || typeof value !== 'object' || visiting.has(value)) return false;
  visiting.add(value);
  let safe = false;
  if (Array.isArray(value)) {
    safe = Object.keys(value).length === value.length
      && value.every(item=>safeValue(item,visiting));
  } else if (plain(value)) {
    safe = !Object.getOwnPropertySymbols(value).length
      && Object.keys(value).every(k=>!forbidden.has(k)&&safeValue(value[k],visiting));
  }
  visiting.delete(value);
  return safe;
}
function indexRows(rows) {
  if (!Array.isArray(rows)) throw Error('Resources must be an array.');
  const map=new Map(),order=[];
  for(const row of rows) {
    if (!plain(row) || !validId(row.tileIndex) || map.has(row.tileIndex) || !safeValue(row))
      throw Error('Invalid/duplicate perception resource row.');
    map.set(row.tileIndex,row);
    order.push(row.tileIndex);
  }
  return {map,order};
}
const equalOrder=(a,b)=>a.length===b.length&&a.every((id,i)=>id===b[i]);

/** Returns null if a full replacement is cheaper or records cannot be safely
 * diffed. maxFraction=0.9 means a patch must save >=10% of JSON payload bytes.
 * JSON size is only a proxy for structuredClone bytes, not real wire size.
 */
export function diffPerceptionResourceRows(before, after, { maxFraction=.9, force=false }={}) {
  if (!Number.isFinite(maxFraction) || maxFraction<=0 || maxFraction>1)
    throw RangeError('Invalid maxFraction for resource delta.');
  let oldRows,nextRows;
  try {
    oldRows=indexRows(before);
    nextRows=indexRows(after);
  } catch {return null;}
  const added=[],updated=[],removed=[];
  for (const id of oldRows.map.keys()) if(!nextRows.map.has(id)) removed.push(id);
  for (const row of after) {
    const original=oldRows.map.get(row.tileIndex);
    if (!original) { added.push(row); continue; }
    const unset=[],set=Object.create(null);
    for (const key of Object.keys(original))
      if (!own(row,key)) unset.push(key);
    for (const [key,value] of Object.entries(row)) {
      if (!own(original,key) || JSON.stringify(original[key]) !== JSON.stringify(value))
        set[key]=value;
    }
    if (unset.length || Object.keys(set).length)
      updated.push({tileIndex:row.tileIndex,set,unset});
  }
  const patch = {schemaVersion:1,beforeCount:before.length,afterCount:after.length,
    added,updated,removed,
    ...(!equalOrder(oldRows.order,nextRows.order)?{order:nextRows.order}:{})};
  const bytes=JSON.stringify(patch).length;
  const fullBytes=JSON.stringify(after).length;
  if (!force && bytes >= fullBytes * maxFraction) return null;
  return patch;
}

/** Validate and reconstruct without mutating *any* existing resource row. */
export function applyPerceptionResourceRowsPatch(before, patch) {
  if (!plain(patch) || patch.schemaVersion!==1 || !Number.isSafeInteger(patch.beforeCount)
    || !Number.isSafeInteger(patch.afterCount) || patch.beforeCount<0||patch.afterCount<0
    || !Array.isArray(patch.added)||!Array.isArray(patch.updated)||!Array.isArray(patch.removed))
    throw Error('Invalid resource delta schema.');
  const previous=indexRows(before);
  if(patch.beforeCount!==before.length) throw Error('Resource delta base count mismatch.');
  const next=new Map(previous.map),removed=new Set(),changed=new Set();
  for(const id of patch.removed){
    if(!validId(id)||removed.has(id)||!previous.map.has(id))
      throw Error('Invalid/duplicate resource removal.');
    removed.add(id);next.delete(id);
  }
  for(const update of patch.updated){
    if(!plain(update)||!validId(update.tileIndex)||changed.has(update.tileIndex)
      ||removed.has(update.tileIndex)||!previous.map.has(update.tileIndex)
      ||!plain(update.set)||!Array.isArray(update.unset))
      throw Error('Invalid resource update.');
    changed.add(update.tileIndex);
    const old=previous.map.get(update.tileIndex);
    const row={...old},touched=new Set();
    for(const key of update.unset){
      if(typeof key!=='string'||forbidden.has(key)||key==='tileIndex'
          ||touched.has(key)||!own(old,key))throw Error('Invalid resource field removal.');
      touched.add(key);delete row[key];
    }
    for(const [key,value] of Object.entries(update.set)){
      if(forbidden.has(key)||key==='tileIndex'||touched.has(key)||!safeValue(value))
        throw Error('Invalid resource field update.');
      touched.add(key);row[key]=value;
    }
    if(row.tileIndex!==update.tileIndex)throw Error('Resource identity mutated.');
    next.set(update.tileIndex,row);
  }
  const addedIds=[];
  for(const row of patch.added){
    if(!plain(row)||!validId(row.tileIndex)||previous.map.has(row.tileIndex)
      ||next.has(row.tileIndex)||!safeValue(row))throw Error('Invalid/duplicate resource addition.');
    next.set(row.tileIndex,row);addedIds.push(row.tileIndex);
  }
  if(next.size!==patch.afterCount)throw Error('Resource count mismatch.');
  const order=patch.order===undefined
    ? [...previous.order.filter(id=>!removed.has(id)),...addedIds]
    : patch.order;
  if(!Array.isArray(order)||order.length!==next.size)throw Error('Resource order length mismatch.');
  const seen=new Set();
  const result=order.map(id=>{
    if(!validId(id)||seen.has(id)||!next.has(id))
      throw Error('Invalid resource patch order.');
    seen.add(id);
    return next.get(id);
  });
  return result;
}
