// Counts the typed-array payload crossing Worker/UI. Does not claim to
// measure structuredClone of the full object graph or transport overhead.
export function tileTransportBytes(response) {
  if (response?.type === 'snapshot') {
    const c=response.snapshot?.tileColumns;
    if(!c)return 0;
    return c.scalars.byteLength+c.ids.byteLength+c.types.byteLength+c.plants.byteLength;
  }
  if (response?.type !== 'world-delta')return 0;
  const c=response.delta?.tileColumns;
  if(!c)return 0;
  if(c.schemaVersion===1)return c.indices.byteLength+
    c.scalars.byteLength+c.ids.byteLength+c.types.byteLength+c.plants.byteLength;
  if(c.schemaVersion===2) {
    let sum=0;
    for(const entries of Object.values(c.fields||{}))for(const entry of entries) {
      sum+=entry.values.byteLength+(entry.indices?.byteLength||0);
    }
    return sum;
  }
  return 0;
}
export function createTransportDiagnostics() {
  const state={fullSnapshots:0,rowDeltas:0,fieldDeltas:0,
    invalidDeltas:0,resyncRequests:0,typedBytes:0,
    applyDurationMs:0,lastApplyMs:0,maxApplyMs:0};
  return {
    record(response,elapsed) {
      if(response?.type==='snapshot')state.fullSnapshots++;
      else if(response?.type==='world-delta') {
        if(response.delta?.tileColumns?.schemaVersion===2)state.fieldDeltas++;
        else if(response.delta?.tileColumns?.schemaVersion===1)state.rowDeltas++;
      }
      state.typedBytes+=tileTransportBytes(response);
      const ms=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
      state.applyDurationMs+=ms;
      state.lastApplyMs=ms;
      state.maxApplyMs=Math.max(state.maxApplyMs,ms);
    },
    invalid() {state.invalidDeltas++;},
    resync() {state.resyncRequests++;},
    snapshot() {
      const count=state.fullSnapshots+state.fieldDeltas+state.rowDeltas;
      return {...state,packets:count,meanApplyMs:count?state.applyDurationMs/count:0};
    }
  };
}
