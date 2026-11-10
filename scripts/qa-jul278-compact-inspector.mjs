// JUL-278: browser parity proof for FULL vs opt-in compact render actors.
// Both modes use the real Vite game, Worker, selection handlers and inspector.
// This is headless software rendering, NOT the final GPU FPS acceptance.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const port=5209,base='http://127.0.0.1:'+port+'/';
const report={schema:1,issue:'JUL-278',seed:42,samples:[],errors:[],
  limits:'Chromium headless/SwiftShader, not RTX GPU acceptance or FPS benchmark.'};
const server=spawn(process.execPath,
  ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],
  {stdio:['ignore','pipe','pipe']});
let serverLog='';
for(const stream of [server.stdout,server.stderr])
  stream.on('data',d=>{serverLog=(serverLog+d.toString()).slice(-4000);});
let browser;
try {
  let ready=false;
  for(let attempt=0;attempt<160;attempt++){
    if(server.exitCode!==null)throw Error('Vite exited: '+serverLog);
    try {if((await fetch(base)).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  if(!ready)throw Error('Vite did not start: '+serverLog);
  browser=await chromium.launch({headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']});
  for(const compact of [false,true]){
    const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    page.on('pageerror',error=>report.errors.push(String(error)));
    await page.addInitScript(()=>{
      const Original=window.Worker;
      window.__jul278Messages=[];
      window.Worker=class ObservedWorker extends Original {
        constructor(...args){
          super(...args);
          this.addEventListener('message',event=>{
            const r=event.data;
            if(r?.type==='snapshot'&&r.snapshot?.base?.people?.length){
              const p=r.snapshot.base.people[0],a=r.snapshot.base.animals[0];
              window.__jul278Actors={personId:p.id,animalId:a.id,
                compact:!Object.hasOwn(p,'perception'),
                actorBrainAction:p.brain?.lastAction,animalBrainAction:a.brain?.lastAction};
            }
            if(r?.type==='query'&&r.result?.actorId!==undefined)
              window.__jul278Messages.push({type:r.result.kind,id:r.result.actorId,
                epoch:r.epoch,revision:r.revision,hasFullPerception:Object.hasOwn(r.result.actor||{},'perception')});
          });
        }
      };
    });
    const suffix=compact?'&compactActors=1':'';
    await page.goto(base+'?seed=42&paused=1&inspectorQA=1'+suffix,
      {waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>!!window.__kingdomInspectorQA
      && !!window.__jul278Actors && document.querySelector('.app')?.inert===false,
      null,{timeout:150000,polling:200});
    const ids=await page.evaluate(()=>window.__jul278Actors);
    assert.equal(ids.compact,compact,'Worker sent wrong actor transport mode');
    assert.ok(ids.personId>0&&ids.animalId>0);
    const selection={};
    for(const [kind,id] of [['person',ids.personId],['animal',ids.animalId]]){
      await page.evaluate(([k,actorId])=>window.__kingdomInspectorQA.open(k,actorId),[kind,id]);
      await page.waitForFunction(({kind,id})=>{
        const state=window.__kingdomInspectorQA?.state();
        return state?.selection?.kind===kind && state.selection.id===id
          && state.detail.completedKey!=null && state.detail.pendingKey==null;
      },{kind,id},{timeout:40000,polling:100});
      selection[kind]=await page.evaluate(()=>({
        eyebrow:document.querySelector('#inspectEyebrow')?.textContent,
        title:document.querySelector('#inspectTitle')?.textContent,
        inspector:document.querySelector('#inspector')?.innerText,
        detail:window.__kingdomInspectorQA.state().detail,
        messageCount:window.__jul278Messages.length
      }));
      assert.ok(selection[kind].inspector?.length>20,
        'inspector did not render live '+kind);
      assert.ok(!selection[kind].inspector.includes('Consultando os detalhes'),
        'inspector still waiting after Worker response');
    }
    const messages=await page.evaluate(()=>window.__jul278Messages);
    assert.ok(messages.some(m=>m.type==='person'&&m.id===ids.personId&&m.hasFullPerception));
    assert.ok(messages.some(m=>m.type==='animal'&&m.id===ids.animalId&&m.hasFullPerception));
    report.samples.push({compact,ids,selection,messages,errors:report.errors.slice()});
    await page.close();
  }
  assert.equal(report.errors.length,0,'Unhandled browser errors');
  const [full,compact]=report.samples;
  for(const kind of ['person','animal']){
    assert.equal(compact.selection[kind].eyebrow,full.selection[kind].eyebrow);
    assert.equal(compact.selection[kind].title,full.selection[kind].title);
    assert.equal(compact.selection[kind].inspector,full.selection[kind].inspector,
      'Compact and normal modes must display identical complete inspector for '+kind);
  }
  console.log('JUL278-INSPECTOR-PARITY',JSON.stringify({
    personId:full.ids.personId,animalId:full.ids.animalId,
    fullQueries:full.messages.length,compactQueries:compact.messages.length,
    exactInspectorText:true,pageErrors:report.errors.length
  }));
  console.log('PASSED JUL-278 real browser full-versus-compact person and animal inspector parity');
}finally{
  if(browser)await browser.close().catch(()=>{});
  server.kill('SIGTERM');
  const out=resolve(process.argv[2]||'out/jul278-browser-inspector.json');
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2));
}
