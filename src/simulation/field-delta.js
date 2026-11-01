// JUL-277 — Column-oriented field deltas. Natural for worlds where a few
// climatic/resource properties change across most tiles while others do not.
export const FIELD_DELTA_SCHEMA = 2;
const KEYS=['scalars','ids','types','plants'];
const fieldsPerTile=(columns,key)=>columns[key].length/columns.tileCount;
const validIndex=(v,last,total)=>Number.isSafeInteger(v)&&v>last&&v<total;
export function createFieldTileDelta(next,previous,{maxBytesFraction=.8}={}){
  if(!previous||next.tileCount!==previous.tileCount
    ||next.plantCount!==previous.plantCount)return null;
  const tileCount=next.tileCount,fields={};
  let totalBytes=0;
  for(const key of KEYS){
    if(!next[key]||!previous[key]||next[key].constructor!==previous[key].constructor
       ||next[key].length!==previous[key].length)return null;
    const span=fieldsPerTile(next,key);
    if(!Number.isSafeInteger(span))return null;
    const entries=[];
    for(let field=0;field<span;field++){
      const changed=[];
      for(let i=0;i<tileCount;i++){
        const offset=i*span+field;
        if(!Object.is(next[key][offset],previous[key][offset]))changed.push(i);
      }
      if(!changed.length)continue;
      const Value=next[key].constructor,bytesPerValue=next[key].BYTES_PER_ELEMENT;
      const dense=changed.length*(bytesPerValue+4)>=tileCount*bytesPerValue;
      const values=new Value(dense?tileCount:changed.length);
      const entry={field,values};
      if(dense){
        for(let i=0;i<tileCount;i++)values[i]=next[key][i*span+field];
      }else{
        entry.indices=Uint32Array.from(changed);
        for(let i=0;i<changed.length;i++)values[i]=next[key][changed[i]*span+field];
        totalBytes+=entry.indices.byteLength;
      }
      totalBytes+=values.byteLength;
      entries.push(entry);
    }
    fields[key]=entries;
  }
  const full=KEYS.reduce((sum,key)=>sum+next[key].byteLength,0);
  if(totalBytes>=full*maxBytesFraction)return null;
  return {
    schemaVersion:FIELD_DELTA_SCHEMA,
    tileCount,plantCount:next.plantCount,
    scalarFields:fieldsPerTile(next,'scalars'),
    idFields:fieldsPerTile(next,'ids'),
    typeFields:fieldsPerTile(next,'types'),
    fields
  };
}
export function fieldTileDeltaBytes(delta){
  return KEYS.reduce((sum,key)=>sum+(delta?.fields?.[key]||[]).reduce(
    (total,e)=>total+e.values.byteLength+(e.indices?.byteLength||0),0),0);
}
export function transferablesForFieldTileDelta(delta){
  const transfer=[];
  for(const key of KEYS)for(const entry of delta.fields[key]||[]){
    transfer.push(entry.values.buffer);
    if(entry.indices)transfer.push(entry.indices.buffer);
  }
  return transfer;
}
export function validFieldTileDelta(delta, expected) {
  if(!delta||delta.schemaVersion!==FIELD_DELTA_SCHEMA
    ||delta.tileCount!==expected.tileCount
    ||delta.plantCount!==expected.plantCount
    ||delta.scalarFields!==expected.scalarFields
    ||delta.idFields!==expected.idFields
    ||delta.typeFields!==expected.typeFields)return false;
  const spans={scalars:delta.scalarFields,ids:delta.idFields,types:delta.typeFields,
    plants:delta.plantCount};
  for(const key of KEYS){
    const group=delta.fields?.[key];
    if(!Array.isArray(group))return false;
    let prevField=-1;
    const Type=key==='scalars'||key==='plants'?Float32Array:key==='ids'?Int32Array:Uint8Array;
    for(const entry of group){
      if(!Number.isSafeInteger(entry?.field)||entry.field<=prevField||
        entry.field>=spans[key]||!(entry.values instanceof Type))return false;
      prevField=entry.field;
      if(entry.indices==null){
        if(entry.values.length!==delta.tileCount)return false;
      }else{
        if(!(entry.indices instanceof Uint32Array)||
           entry.values.length!==entry.indices.length)return false;
        let previous=-1;
        for(const i of entry.indices){
          if(!validIndex(i,previous,delta.tileCount))return false;
          previous=i;
        }
      }
    }
  }
  return true;
}
