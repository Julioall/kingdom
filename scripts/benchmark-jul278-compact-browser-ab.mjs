// JUL-278: same-browser full/compact A/B: frame pacing, Worker request
// round-trips, main-thread JS heap and a renderer-identification signal.
// Run --headful=1 on the player's GPU for acceptance. Headless/SwiftShader
// remains a CI diagnostic only, never proof of GPU/frame improvement.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, platform } from 'node:os';

const opts=Object.fromEntries(process.argv.slice(2)
  .filter(s=>s.startsWith('--')&&s.includes('='))
  .map(s=>{const i=s.indexOf('=');return [s.slice(2,i),s.slice(i+1)];}));
const port=Number(opts.port||5214),seed=Number(opts.seed||42);
const durationMs=Number(opts.duration||4500),repeats=Number(opts.repeats||2);
const headful=opts.headful==='1',gpuRequired=opts.requireGpu==='1';
assert.ok(Number.isSafeInteger(seed)&&seed>0);
assert.ok(Number.isSafeInteger(durationMs)&&durationMs>=2000&&durationMs<=60000);
assert.ok(Number.isSafeInteger(repeats)&&repeats>=1&&repeats<=5);
if(gpuRequired&&!headful)throw Error('--requireGpu=1 requires --headful=1.');
const url='http://127.0.0.1:'+port+'/';
const out=resolve(opts.output||'out/jul278-compact-browser-ab.json');
const report={schema:1,issue:'JUL-278',sourceSha:process.env.GITHUB_SHA||'local',
  seed,headful,repeats,durationMs,transportBaseline:'tile-delta in BOTH modes',
  environment:{platform:platform(),cpu:cpus()[0]?.model,node:process.version,
    browser:headful?'Chromium headful: renderer must be checked':'Chromium headless/SwiftShader'},
  samples:[],errors:[],
  methodology:'Two modes run sequentially in alternating order with identical seed and zoom; observe actual browser Worker request-to-reply latency, UI frame profiler, p95 frames and JS heap of main page. Includes a paused selection query after running. The CPU/GPU load, caches, JIT and browser process vary across runs.',
  limits:[
    'Worker round trip includes simulation CPU, queueing and structuredClone, not pure transport latency.',
    'performance.memory reports approximate MAIN PAGE JS heap only: not Worker heap, GPU memory or all browser allocations.',
    'Renderer identification from WebGL is a hint only; verify GPU acceleration independently in chrome://gpu / Windows Task Manager.',
    'FPS from requestAnimationFrame profiler cannot prove GPU present completion; use browser tracing or GPU profiling for acceptance.',
    'Only initial full base size and first day delta JSON proxies are sampled, not actual binary message wire bytes.'
  ]
};
const server=spawn(process.execPath,
  ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],
  {stdio:['ignore','pipe','pipe'],env:{...process.env,BROWSER:'none'}});
let serverLog='';
for(const stream of [server.stdout,server.stderr])
  stream.on('data',d=>{serverLog=(serverLog+d.toString()).slice(-4000);});
let browser;
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
const round=n=>typeof n==='number'&&Number.isFinite(n)?+n.toFixed(2):null;

function reportModeName(mode){return mode==='compact'?'compact':'full';}
async function profileMode(mode,roundIndex){
  const page=await browser.newPage({viewport:{width:1440,height:900},
    deviceScaleFactor:1,reducedMotion:'reduce'});
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.addInitScript(()=>{
    const Original=window.Worker,pending=new Map(),records=[];
    const capture=[];
    window.Worker=class RecordedWorker extends Original {
      constructor(...args){
        super(...args);
        this.addEventListener('message',event=>{
          const msg=event.data||{};
          const sent=pending.get(msg.requestId);
          if(sent!==undefined)pending.delete(msg.requestId);
          if(records.length>=500)records.shift();
          records.push({type:msg.type,epoch:msg.epoch,revision:msg.revision,
            roundTripMs:sent===undefined?null:performance.now()-sent,
            personCount:msg.type==='snapshot'?msg.snapshot?.base?.people?.length
              :msg.type==='world-delta'?msg.delta?.base?.people?.length:null});
          if((msg.type==='snapshot'||msg.type==='world-delta')&&capture.length<2){
            const base=msg.type==='snapshot'?msg.snapshot?.base:msg.delta?.base;
            if(base){
              const start=performance.now();
              capture.push({type:msg.type,day:base.day,
                personId:base.people?.[0]?.id??null,
                animalId:base.animals?.[0]?.id??null,
                jsonBaseBytes:new TextEncoder().encode(JSON.stringify(base)).byteLength,
                estimatedMs:performance.now()-start,
                compact:!Object.hasOwn(base.people?.[0]||{},'perception')});
            }
          }
        });
      }
      postMessage(msg,...args){
        if(Number.isInteger(msg?.requestId))pending.set(msg.requestId,performance.now());
        return super.postMessage(msg,...args);
      }
    };
    window.__jul278AB={
      records:()=>records.slice(),payloads:()=>capture.slice(),
      reset:()=>{records.length=0;}
    };
  });
  const q='?seed='+seed+'&paused=1&profile=1&effects=fixed&inspectorQA=1&tileDeltaQA=1'
    +(mode==='compact'?'&compactActors=1':'');
  try {
    await page.goto(url+q,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(()=>!!window.kingdomProfiler&&!!window.__kingdomInspectorQA
      &&document.querySelector('.app')?.inert===false
      &&window.__jul278AB?.payloads().length>0,
      null,{timeout:150000,polling:200});
    const renderer=await page.evaluate(()=>{
      const out={};
      try {
        const gl=document.createElement('canvas').getContext('webgl2');
        const ext=gl?.getExtension('WEBGL_debug_renderer_info');
        out.webglRenderer=gl?.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)||null;
        out.webglVendor=gl?.getParameter(ext?.UNMASKED_VENDOR_WEBGL||gl.VENDOR)||null;
      }catch(e){out.webglError=String(e);}
      out.gpuApiAvailable=!!navigator.gpu;
      out.visible=document.visibilityState;
      return out;
    });
    const reportHardware=String(renderer.webglRenderer||'').toLowerCase();
    const software=/swiftshader|llvmpipe|softpipe|software/i.test(reportHardware);
    if(gpuRequired&&(software||!renderer.webglRenderer))
      throw Error('GPU renderer unavailable or software-only: '+renderer.webglRenderer);
    await page.waitForTimeout(650);
    const before=await page.evaluate(()=>performance.memory?.usedJSHeapSize??null);
    await page.locator('#toggle').click(); // unpause for the measured time window
    await page.evaluate(()=>{window.kingdomProfiler.reset();window.__jul278AB.reset();});
    await page.waitForTimeout(durationMs);
    const measured=await page.evaluate(()=>({
      profiler:window.kingdomProfiler.snapshot(),
      worker:window.__jul278AB.records(),
      payloads:window.__jul278AB.payloads(),
      day:window.__kingdomInspectorQA.state().day,
      heap:performance.memory?.usedJSHeapSize??null,
      heapLimit:performance.memory?.jsHeapSizeLimit??null,
      visibility:document.visibilityState
    }));
    await page.locator('#toggle').click(); // pause before querying inspector
    const personId=measured.payloads.find(row=>Number.isSafeInteger(row.personId))?.personId;
    assert.ok(Number.isSafeInteger(personId),'No person captured from live Worker');
    // Real selection and detailed Worker query (same path as the player).
    await page.evaluate(id=>window.__kingdomInspectorQA.open('person',id),personId);
    await page.waitForFunction(id=>{
      const state=window.__kingdomInspectorQA.state();
      return state?.selection?.kind==='person'&&state.selection.id===id
        && state.detail.completedKey!=null && state.detail.pendingKey==null;
    },personId,{timeout:45000,polling:100});
    const inspector=await page.evaluate(()=>({
      state:window.__kingdomInspectorQA.state(),
      text:document.querySelector('#inspector')?.innerText,
      records:window.__jul278AB.records().filter(r=>r.type==='query')
    }));
    assert.ok(inspector.text?.length>20,'On-demand inspector did not render');
    const inspectorTrips=inspector.records.map(r=>r.roundTripMs)
      .filter(n=>Number.isFinite(n));
    assert.ok(inspectorTrips.length>0,'No inspector Worker query observed');
    const chosen={day:inspector.state.day,epoch:inspector.state.epoch,
      revision:inspector.state.materializedRevision};
    const records=measured.worker;
    const trip=records.filter(r=>r.roundTripMs!=null
      &&['snapshot','world-delta','player-update'].includes(r.type))
      .map(r=>r.roundTripMs);
    const frames=measured.profiler.frames;
    assert.ok(frames.samples>=8,'Not enough visible frames for '+mode+' round '+roundIndex);
    const sample={mode,roundIndex,renderer,softwareRenderer:software,
      fps:round(frames.fps),frameP50Ms:round(frames.p50Ms),
      frameP95Ms:round(frames.p95Ms),frameSamples:frames.samples,
      mapP95Ms:round(measured.profiler.map?.p95Ms),
      heapStartBytes:before,heapEndBytes:measured.heap,
      heapDeltaBytes:before==null||measured.heap==null?null:measured.heap-before,
      heapLimitBytes:measured.heapLimit,
      workerMessages:records.length,workerSimResponses:trip.length,
      workerRoundTripP50Ms:round(percentile(trip,.5)),
      workerRoundTripP95Ms:round(percentile(trip,.95)),
      inspectorQueryP95Ms:round(percentile(inspectorTrips,.95)),
      inspectorPersonId:personId,
      capturedBaseJson:measured.payloads,
      finalDay:measured.day,selectionRevision:chosen.revision,
      visibility:measured.visibility,
      errors:pageErrors.slice()};
    report.samples.push(sample);
    console.log('JUL278-BROWSER-SAMPLE',JSON.stringify(sample));
    assert.equal(pageErrors.length,0,'Unhandled JS errors in '+mode);
    if(sample.visibility!=='visible')
      report.errors.push(mode+' round '+roundIndex+' ran in a non-visible tab');
    return sample;
  }finally{
    await page.close();
  }
}

try{
  let ready=false;
  for(let i=0;i<200;i++){
    if(server.exitCode!==null)throw Error('Vite exited: '+serverLog);
    try{if((await fetch(url)).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  if(!ready)throw Error('Vite did not start: '+serverLog);
  const options={headless:!headful,args:['--no-sandbox','--disable-dev-shm-usage',
    '--enable-precise-memory-info']};
  if(!headful)options.args.push('--use-gl=angle','--use-angle=swiftshader');
  const chrome=opts.chrome||process.env.CHROME_PATH;
  if(chrome){
    if(!existsSync(chrome))throw Error('Chrome path not found: '+chrome);
    options.executablePath=chrome;
  }
  browser=await chromium.launch(options);
  for(let i=0;i<repeats;i++){
    const order=i%2===0?['full','compact']:['compact','full'];
    for(const mode of order)await profileMode(reportModeName(mode),i+1);
    const pair=report.samples.filter(s=>s.roundIndex===i+1);
    const [a,b]=pair;
    const aUpdate=a?.capturedBaseJson?.find(row=>row.day>0)?.type;
    const bUpdate=b?.capturedBaseJson?.find(row=>row.day>0)?.type;
    assert.equal(aUpdate,bUpdate,'Full/compact A/B must use the SAME tile packet type');
    if(aUpdate!=='world-delta')
      report.errors.push('Pair '+(i+1)+' lacks a comparable tile-delta: '+aUpdate);
  }
  const grouped=Object.fromEntries(['full','compact'].map(mode=>{
    const rows=report.samples.filter(r=>r.mode===mode);
    return [mode,{
      n:rows.length,meanFps:round(rows.reduce((s,r)=>s+r.fps,0)/rows.length),
      meanFrameP95Ms:round(rows.reduce((s,r)=>s+r.frameP95Ms,0)/rows.length),
      meanWorkerP95Ms:round(rows.filter(r=>r.workerRoundTripP95Ms!=null)
        .reduce((s,r)=>s+r.workerRoundTripP95Ms,0)/
        (rows.filter(r=>r.workerRoundTripP95Ms!=null).length||1)),
      meanHeapDeltaMB:round(rows.filter(r=>r.heapDeltaBytes!=null)
        .reduce((s,r)=>s+r.heapDeltaBytes/1048576,0)/
        (rows.filter(r=>r.heapDeltaBytes!=null).length||1)),
      meanInspectorQueryP95Ms:round(rows.reduce((s,r)=>s+r.inspectorQueryP95Ms,0)/rows.length)
    }];
  }));
  report.summary=grouped;
  console.log('JUL278-BROWSER-SUMMARY',JSON.stringify(grouped));
  console.log('PASSED JUL-278 browser A/B collection (NOT an FPS acceptance pass)');
}finally{
  if(browser)await browser.close().catch(()=>{});
  server.kill('SIGTERM');
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2));
}
