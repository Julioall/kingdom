// JUL-278: verify the actual inspector uses Worker actor queries in Chromium.
// The flag-gated selector exists only in Vite DEV with inspectorQA=1.
// Headless SwiftShader is not local GPU/FPS certification.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const port=Number(process.env.JUL278_PORT||5205);
const compactActors=process.env.JUL278_COMPACT_ACTORS==='1';
const base='http://127.0.0.1:'+port+'/';
const server=spawn(process.execPath,
  ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],
  {stdio:['ignore','pipe','pipe'],env:{...process.env,BROWSER:'none'}});
let serverLog='';
for(const stream of [server.stdout,server.stderr])
  stream.on('data',buf=>{serverLog=(serverLog+buf.toString()).slice(-5000);});
let browser;
const report={schema:1,issue:'JUL-278',browser:'Chromium headless/SwiftShader (not GPU QA)',
  sourceSha:process.env.GITHUB_SHA||'unknown',compactActors,
  responses:[],errors:[],success:false};
try {
  let ready=false;
  for(let i=0;i<180;i++){
    if(server.exitCode!=null)throw Error('Vite exited: '+serverLog);
    try {if((await fetch(base)).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  assert.ok(ready,'Vite did not start: '+serverLog);
  const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage',
    '--use-gl=angle','--use-angle=swiftshader']};
  if(process.env.CHROME_PATH&&existsSync(process.env.CHROME_PATH))
    options.executablePath=process.env.CHROME_PATH;
  browser=await chromium.launch(options);
  const page=await browser.newPage({viewport:{width:1440,height:900},
    deviceScaleFactor:1,reducedMotion:'reduce'});
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker,requests=new Map(),records=[];
    const packetTypes=Object.create(null);
    let initial=null;
    class ProbeWorker extends NativeWorker{
      constructor(...args){
        super(...args);
        this.addEventListener('message',event=>{
          const packet=event.data||{};
          packetTypes[packet.type]=(packetTypes[packet.type]||0)+1;
          if(packet.type==='snapshot'&&packet.snapshot?.base&&!initial){
            initial={people:packet.snapshot.base.people.slice(0,2).map(p=>({id:p.id,name:p.name})),
              animal:packet.snapshot.base.animals[0]?.id,
              hasPersonFullBrain:Object.hasOwn(packet.snapshot.base.people[0]?.brain||{},'updates'),
              hasAnimalFullBrain:Object.hasOwn(packet.snapshot.base.animals[0]?.brain||{},'updates'),
              personRenderAction:packet.snapshot.base.people[0]?.brain?.lastAction,
              animalRenderAction:packet.snapshot.base.animals[0]?.brain?.lastAction};
          }
          const pending=requests.get(packet.requestId);
          if(pending){
            requests.delete(packet.requestId);
            records.push({kind:pending.type,id:pending.id,requestId:packet.requestId,
              type:packet.type,epoch:packet.epoch,revision:packet.revision,
              resultActorId:packet.result?.actorId,day:packet.result?.day,
              durationMs:performance.now()-pending.at});
          }
        });
      }
      postMessage(message,...args){
        if(message?.type==='inspect-person'||message?.type==='inspect-animal'){
          requests.set(message.requestId,{
            type:message.type,id:message.personId??message.animalId,at:performance.now()
          });
        }
        return super.postMessage(message,...args);
      }
    }
    window.Worker=ProbeWorker;
    window.__jul278Probe={initial:()=>initial,records:()=>records.slice(),
      packetTypes:()=>({...packetTypes})};
  });
  await page.goto(base+'?seed=42&paused=1&inspectorQA=1&profile=1&effects=fixed'
    +(compactActors?'&compactActors=1':''),
    {waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>
    document.querySelector('.app')?.inert===false
      && !!window.__kingdomInspectorQA
      && !!window.__jul278Probe.initial()?.animal,
  null,{timeout:150000,polling:250});
  const first=await page.evaluate(()=>window.__jul278Probe.initial());
  assert.ok(first.people.length===2&&first.people[0].id!==first.people[1].id);
  assert.equal(first.hasPersonFullBrain,!compactActors,
    'legacy must include cognition, compact must defer it to the Worker');
  assert.equal(first.hasAnimalFullBrain,!compactActors,
    'legacy must include animal brain, compact must defer it');
  assert.equal(await page.evaluate(()=>window.__kingdomInspectorQA.state().compactActors),
    compactActors,'UI must negotiate the expected snapshot mode');
  async function open(kind,id){
    await page.evaluate(({kind,id})=>window.__kingdomInspectorQA.open(kind,id),{kind,id});
    await page.waitForFunction(({kind,id})=>{
      const q=window.__kingdomInspectorQA?.state();
      return q?.detail?.completedKey?.endsWith(':'+kind+':'+id);
    },{kind,id},{timeout:30000,polling:100});
    const observed=await page.evaluate(({kind,id})=>({
      title:document.querySelector('#inspectTitle')?.textContent,
      eyebrow:document.querySelector('#inspectEyebrow')?.textContent,
      content:document.querySelector('#inspector')?.textContent,
      state:window.__kingdomInspectorQA.state(),
      records:window.__jul278Probe.records().filter(r=>r.kind==='inspect-'+kind&&r.id===id)
    }),{kind,id});
    assert.equal(observed.records.length,1,'exactly one query per active selection');
    assert.equal(observed.records[0].type,'query');
    assert.equal(observed.records[0].resultActorId,id);
    assert.equal(observed.records[0].day,observed.state.day);
    assert.ok(observed.title?.length>0);
    if(kind==='person'){
      assert.ok(observed.content.includes('Decisão e aprendizado'),
        'Worker details must render the cognition section');
      assert.ok(observed.content.includes('Caminhos aprendidos'),
        'Worker detail must render learned routes');
    }else assert.ok(observed.content.includes('Perfil funcional'),
      'Animal profile must be rendered from the fetched detail');
    report.responses.push({kind,id,title:observed.title,
      durationMs:observed.records[0].durationMs,
      day:observed.state.day,revision:observed.records[0].revision});
  }
  await open('person',first.people[0].id);
  // Repeated clicks on the selected actor may cause renders, not query storms.
  await page.evaluate(id=>{
    for(let i=0;i<4;i++)window.__kingdomInspectorQA.open('person',id);
  },first.people[0].id);
  const repeat=await page.evaluate(id=>window.__jul278Probe.records()
    .filter(r=>r.kind==='inspect-person'&&r.id===id).length,first.people[0].id);
  assert.equal(repeat,1,'Repeated inspector renders must coalesce requests');
  await open('animal',first.animal);
  await open('person',first.people[1].id);
  if(compactActors){
    const before=await page.evaluate(()=>window.__kingdomInspectorQA.state());
    await page.locator('#step').click();
    await page.waitForFunction(({id,oldRev})=>{
      const qa=window.__kingdomInspectorQA?.state();
      return qa?.day===1 && qa?.materializedRevision>oldRev
        && qa?.detail?.completedKey?.endsWith(':person:'+id);
    },{id:first.people[1].id,oldRev:before.materializedRevision},
      {timeout:45000,polling:100});
    const after=await page.evaluate(id=>({
      state:window.__kingdomInspectorQA.state(),
      packetTypes:window.__jul278Probe.packetTypes(),
      selectedQueries:window.__jul278Probe.records()
        .filter(r=>r.kind==='inspect-person'&&r.id===id),
      detail:document.querySelector('#inspector')?.textContent
    }),first.people[1].id);
    assert.ok((after.packetTypes['world-delta']||0)>=1,
      'Daily compact actor advancement must retain the delta transport');
    assert.equal(after.selectedQueries.length,2,
      'Selected NPC detail must refresh after a materialized day advance');
    assert.ok(after.detail?.includes('Decisão e aprendizado'),
      'Selected NPC must still show cognitive detail after a daily delta');
    report.dayAdvance={day:after.state.day,
      revision:after.state.materializedRevision,
      deltaMessages:after.packetTypes['world-delta'],
      personQueries:after.selectedQueries.length};
  }
  assert.deepEqual(report.errors,[],'Unexpected JS errors while inspecting actors');
  report.success=true;
  await page.close();
}finally{
  if(browser)await browser.close().catch(()=>{});
  server.kill('SIGTERM');
  const out=resolve(process.argv[2]||'out/jul278-inspector-browser.json');
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2));
  console.log('JUL278-INSPECTOR-BROWSER',JSON.stringify(report));
}
if(!report.success)throw Error('Browser inspector integration did not complete.');
console.log('PASSED JUL-278 selected human/animal inspector queries in Chromium');
