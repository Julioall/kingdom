import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot} from '../src/simulation/render-snapshot.js';
import {tileColumnBytes} from '../src/simulation/tile-delta.js';
const w=Sim.createWorld(42);
let before=createWorldSnapshot(w);
const changes=[];
for(let day=1;day<=2;day++) {
  Sim.stepDay(w,{includeSnapshot:false});
  const after=createWorldSnapshot(w),byGroup={};
  for(const kind of ['scalars','ids','types','plants']){
    const span=after.tileColumns[kind].length / after.tileColumns.tileCount;
    byGroup[kind]=[];
    for(let field=0;field<span;field++){
      let changed=0;
      for(let tile=0;tile<after.tileColumns.tileCount;tile++) {
        const index=tile*span+field;
        if(!Object.is(after.tileColumns[kind][index],before.tileColumns[kind][index]))changed++;
      }
      if(changed)byGroup[kind].push({field,changed,
        percent:+(changed/after.tileColumns.tileCount*100).toFixed(2)});
    }
  }
  const summary={day,fullTileBytes:tileColumnBytes(after.tileColumns),byGroup};
  changes.push(summary);
  console.log('DIRTY_FIELDS',JSON.stringify(summary));
  before=after;
}
