// Actor index browser A/B. Headless Chromium is not player GPU acceptance.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const opts=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith('--')&&s.includes('='))
  .map(s=>{const n=s.indexOf('=');return [s.slice(2,n),s.slice(n+1)];}));
const port=Number(opts.port||5327), duration=Number(opts.duration||3500);
const headful=opts.headful==='1', repeats=Number(opts.repeats||1);
const out=resolve(opts.output||'out/actor-culling-browser-ab.json');
assert.ok(Number.isInteger(port)&&port>0&&Number.isInteger(duration)&&duration>=2000
  &&duration<=30000&&Number.isInteger(repeats)&&repeats>=1&&repeats<=5);
const base='http://127.0.0.1:'+port+'/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',
  '--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe']});
let log='';for(const stream of [server.stdout,server.stderr])
  stream.on('data',chunk=>{log=(log+chunk.toString()).slice(-3000);});
const report={schema:1,sourceCommit:process.env.GITHUB_SHA||'local',
  browser:headful?'headful Chromium (GPU validation still manual)':'headless Chromium (software renderer)',
  duration,repeats,seed:42,zoom:'five zoom-in clicks',modes:[],errors:[],
  caveats:['RAF is not GPU completion','No hardware GPU acceptance',
    'A short software-rendered sample does not prove a universal FPS gain']};
let browser;
try {
  let ready=false;
  for(let i=0;i<200;i++){
    if(server.exitCode!==null)throw Error('Vite exited: '+log);
    try{if((await fetch(base)).ok){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,150));
  }
  if(!ready)throw Error('Vite not ready: '+log);
  browser=await chromium.launch({headless:!headful,
    args:['--no-sandbox','--disable-dev-shm-usage',...(headful?[]:['--use-gl=angle','--use-angle=swiftshader'])]});
  for(let pair=0;pair<repeats;pair++){
    const modes=pair%2===0?['baseline','indexed']:['indexed','baseline'];
    for(const mode of modes){
      const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,
        reducedMotion:'reduce'});
      const errors=[];page.on('pageerror',error=>errors.push(String(error)));
      try {
        const url=base+'?seed=42&paused=1&profile=1&effects=fixed&actorCulling='+(mode==='baseline'?'0':'1');
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
        await page.waitForFunction(()=>{
          const perf=window.kingdomProfiler?.snapshot();
          return document.querySelector('.app')?.inert===false&&perf?.frames.samples>=12
            &&perf?.context?.peopleTotal===96&&perf.context.animalsTotal===24;
        },null,{timeout:150000});
        for(let i=0;i<5;i++) await page.locator('#mapZoomIn').click();
        await page.waitForTimeout(900);
        const start=await page.evaluate(()=>window.kingdomProfiler.snapshot());
        assert.equal(start.context.actorCulling,mode!=='baseline','actor-culling switch mismatch');
        assert.ok(start.context.zoom>.5,'zoom must create a partial viewport');
        await page.evaluate(()=>window.kingdomProfiler.reset());
        await page.waitForTimeout(duration);
        const observed=await page.evaluate(()=>window.kingdomProfiler.snapshot());
        const c=observed.context,frames=observed.frames,map=observed.map;
        if(mode==='indexed'){
          assert.ok(c.actorViewport,'missing viewport index diagnostics');
          assert.equal(c.actorViewport.people,96);
          assert.equal(c.actorViewport.animals,24);
          assert.ok(c.actorViewport.lastReturned<=c.actorViewport.lastExamined);
        }
        if(errors.length)throw Error('Browser errors: '+errors.join(' | '));
        const record={pair:pair+1,mode,frames:frames.samples,fps:frames.fps,
          frameP95Ms:frames.p95Ms,mapMeanMs:map.meanMs,mapP95Ms:map.p95Ms,
          zoom:c.zoom,viewport:c.viewport,actorViewport:c.actorViewport||null,errors};
        report.modes.push(record);
        console.log('ACTOR-CULLING-AB',JSON.stringify(record));
      }catch(error){report.errors.push({mode,pair,error:String(error),browserErrors:errors});throw error;}
      finally{await page.close();}
    }
  }
} finally {
  await browser?.close().catch(()=>{});
  server.kill('SIGTERM');
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(report,null,2));
}
