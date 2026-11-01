import { transferablesForFieldTileDelta } from './field-delta.js';
// JUL-277 — sparse tile-column transport. Pure packing and validation, with
// no side effects on the authoritative simulation or render projection.
export const TILE_DELTA_SCHEMA = 1;
const columnNames = ['scalars','ids','types','plants'];

function fieldsPerTile(columns, key) {
  return columns[key].length / columns.tileCount;
}
export function tileColumnBytes(columns) {
  return columnNames.reduce((sum,key)=>sum+columns[key].byteLength,0);
}
export function copyTileColumns(columns) {
  return {
    tileCount:columns.tileCount,plantCount:columns.plantCount,
    ...Object.fromEntries(columnNames.map(key=>[key,columns[key].slice()]))
  };
}
function compatible(next,previous) {
  return !!previous && next.tileCount===previous.tileCount
    && next.plantCount===previous.plantCount
    && columnNames.every(key=>next[key].constructor===previous[key].constructor
      && next[key].length===previous[key].length
      && Number.isSafeInteger(fieldsPerTile(next,key)));
}
export function createTileColumnDelta(next,previous,{maxChangedFraction=.35}={}) {
  if(!compatible(next,previous))return null;
  const total=next.tileCount,changes=[];
  for(let i=0;i<total;i++){
    let changed=false;
    for(const key of columnNames) {
      const span=fieldsPerTile(next,key),start=i*span;
      for(let j=0;j<span;j++)if(!Object.is(next[key][start+j],previous[key][start+j])){
        changed=true;break;
      }
      if(changed)break;
    }
    if(changed) {
      changes.push(i);
      if(changes.length>Math.ceil(total*maxChangedFraction))return null;
    }
  }
  const indices=Uint32Array.from(changes);
  const data={schemaVersion:TILE_DELTA_SCHEMA,tileCount:total,plantCount:next.plantCount,
    indices};
  for(const key of columnNames){
    const span=fieldsPerTile(next,key);
    const packed=new next[key].constructor(changes.length*span);
    for(let j=0;j<changes.length;j++){
      const index=changes[j];
      packed.set(next[key].subarray(index*span,(index+1)*span),j*span);
    }
    data[key]=packed;
  }
  return data;
}
export function transferablesForTileDelta(delta) {
  const d=delta?.tileColumns;
  if (d?.schemaVersion === 2) return transferablesForFieldTileDelta(d);
  return d?[d.indices.buffer,d.scalars.buffer,d.ids.buffer,d.types.buffer,d.plants.buffer]:[];
}
export function validTileColumnDelta(delta, tileCount, plantCount) {
  if(!delta || delta.schemaVersion!==TILE_DELTA_SCHEMA || delta.tileCount!==tileCount
      || delta.plantCount!==plantCount || !(delta.indices instanceof Uint32Array))return false;
  const n=delta.indices.length;
  let last=-1;
  for(const index of delta.indices){
    if(index>=tileCount||index<=last)return false;
    last=index;
  }
  return columnNames.every((key)=>delta[key] &&
    ArrayBuffer.isView(delta[key]) &&
    delta[key].length===n*(key==='plants'?plantCount:
       key==='scalars'?25:key==='ids'?7:3));
}
