/* Adapted from Kingdom Debuff VFX v2, supplied by the user. MIT.
 * Canvas 2D runtime: native ESM, culling hooks and mutable emitter positions.
 * Original: integracao/kingdom-debuff-vfx.js, Copyright (c) 2026. */

 const PI=Math.PI, TAU=2*PI;
 const palettes={
  poison:{main:'#719f78',highlight:'#c0cba2',shadow:'#405c50'},
  curse:{main:'#9679ad',highlight:'#ceb2d5',shadow:'#5a496c'},
  slow:{main:'#7aa6bc',highlight:'#bed5da',shadow:'#4c7185'},
  weaken:{main:'#b49677',highlight:'#ddbf99',shadow:'#716378'},
  stun:{main:'#ceb15f',highlight:'#eee0ac',shadow:'#8b784a'},
  focus:{main:'#bc726f',highlight:'#e8a9a0',shadow:'#603e4e'}
 };
 const opts={kind:'curse',duration:Infinity,position:{x:0,y:0},ringRadius:43,flatten:0.53,ringCount:2,ringThickness:2,
   ringSegments:10,rotationSpeed:0.45,rotateSelection:true,ringPulse:0.08,ringOpacity:0.82,
   groundParticles:true,auraParticles:true,groundCount:22,auraCount:18,particleSize:2,
   particleSpeed:1.0,auraHeight:44,particleOpacity:0.8,particleMotion:'rise',
   unifyParticles:true,particleShape:'dot',groundParticleShape:'dot',auraParticleShape:'spark',
   colors:null,seed:37,scale:1,emissionStyle:'rise',heartScale:1,flameTurbulence:0.65,particleGlow:0};
 const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
 const frac=x=>x-Math.floor(x);
 const rand=(seed,i,j)=>frac(Math.sin(seed*0.001+i*127.1+j*311.7)*43758.5453);
 const alphaColors=new Map();
 const rgba=(hex,a)=>{a=Math.round(clamp(a,0,1)*48)/48;const key=hex+':'+a;if(alphaColors.has(key))return alphaColors.get(key);let s=hex.replace('#','');if(s.length===3)s=s.split('').map(v=>v+v).join('');
  const n=parseInt(s,16);const value=`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;if(alphaColors.size>4096)alphaColors.clear();alphaColors.set(key,value);return value};
 function validateColor(x,fallback){return typeof x==='string' && /^#[0-9a-f]{6}$/i.test(x)?x:fallback}
 function normalize(input){
  const c={...opts,...input}; c.position={x:Number(c.position?.x)||0,y:Number(c.position?.y)||0};
  c.ringRadius=clamp(Number(c.ringRadius)||43,4,500); c.flatten=clamp(Number(c.flatten)||.53,.15,1);
  c.scale=clamp(Number(c.scale)||1,.1,8); c.ringCount=clamp(Math.round(c.ringCount),1,5);
  c.ringSegments=clamp(Math.round(c.ringSegments),1,40);c.groundCount=clamp(Math.round(c.groundCount),0,200);
  c.auraCount=clamp(Math.round(c.auraCount),0,400);c.particleSize=clamp(Math.round(c.particleSize),1,12);
  c.particleSpeed=clamp(Number(c.particleSpeed)||0,0,15);
  c.auraHeight=clamp(Number(c.auraHeight),1,400);c.particleOpacity=clamp(Number(c.particleOpacity),0,1);
  c.ringOpacity=clamp(Number(c.ringOpacity),0,1);
  c.seed=Number.isFinite(+c.seed)?+c.seed:37;
  c.ringThickness=clamp(Number(c.ringThickness)||1,.25,10);
  c.rotationSpeed=Number(c.rotationSpeed)||0;
  c.ringPulse=clamp(Number(c.ringPulse)||0,0,1);
  c.particleMotion=['rise','orbit'].includes(c.particleMotion)?c.particleMotion:'rise';
  c.particleShape=['dot','spark','rune','shard'].includes(c.particleShape)?c.particleShape:'dot';
  c.emissionStyle=['rise','flame','heart'].includes(c.emissionStyle)?c.emissionStyle:'rise';
  c.heartScale=clamp(Number(c.heartScale)||1,.4,2.8);
  c.flameTurbulence=clamp(Number(c.flameTurbulence)||0,0,2);
  c.particleGlow=clamp(Number(c.particleGlow)||0,0,1);
  const palette=palettes[c.kind]||palettes.curse;
  c.colors={main:validateColor(c.colors?.main,palette.main),highlight:validateColor(c.colors?.highlight,palette.highlight),shadow:validateColor(c.colors?.shadow,palette.shadow)};
  return c;
 }
 // A map unit is much larger than a sprite pixel. Keep a twenty-four-times finer
 // raster for VFX instead of rounding every detail to an entire map pixel.
 const raster=x=>Math.round(x*24)/24;
 function drawBlock(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(raster(x),raster(y),Math.max(1/24,raster(w)),Math.max(1/24,raster(h)))}
 function drawParticle(ctx,x,y,s,kind,pal,alpha){
  if(alpha<.012)return;
  // Eighth-size particles, including outlines and highlights. Reducing only the
  // central size left the old one-map-pixel padding dominating the whole shape.
  s=Math.max(1/24,Math.round(s*3)/24);
  const pixel=.125,detail=1/24;
  const dark=rgba(pal.shadow,alpha),main=rgba(pal.main,alpha),light=rgba(pal.highlight,alpha);
  if(kind==='spark'){
   drawBlock(ctx,x-s,y,3*s,s,dark);drawBlock(ctx,x,y-s,s,3*s,dark);drawBlock(ctx,x-s+pixel,y,Math.max(detail,3*s-2*pixel),s,main);
   drawBlock(ctx,x,y-s+pixel,s,Math.max(detail,3*s-2*pixel),main);drawBlock(ctx,x,y,detail,detail,light);
  }else if(kind==='rune'){
   drawBlock(ctx,x-s,y-s,2*s+pixel,2*s+pixel,dark);drawBlock(ctx,x,y-s,s,s*2+pixel,main);drawBlock(ctx,x-s,y,s*2+pixel,s,light);
  }else if(kind==='shard'){
   drawBlock(ctx,x,y-s,Math.max(detail,s),3*s,dark);drawBlock(ctx,x,y-s,Math.max(detail,s-pixel),2*s,main);drawBlock(ctx,x,y-s,detail,s,light);
  }else{
   drawBlock(ctx,x-pixel,y-pixel,s+2*pixel,s+2*pixel,dark);drawBlock(ctx,x,y,s,s,main);
   drawBlock(ctx,x,y,detail,detail,light);
  }
 }
 const ringImages=new Map();
 let ringImagePixels=0;
 function drawEllipseRing(ctx,c,cx,cy,r,turn,t,idx){
  // Rasterize detailed rings once at 8x resolution. Rotate the cached top-down
  // image before flattening it, so the animation stays on the ground plane.
  if(typeof document!=='undefined'&&ctx.drawImage&&ctx.save&&ctx.scale){
   const rad=r*c.scale;
   const key=[rad,c.ringThickness,c.ringSegments,c.rotateSelection,c.magicPattern,c.circleStyle,c.glyphCount,c.centerSymbol,idx,
    c.colors.main,c.colors.highlight,c.colors.shadow].join(':');
   let cached=ringImages.get(key);
   if(!cached){
    const pad=Math.ceil(c.ringThickness+3),size=Math.ceil((rad+pad)*2),resolution=8;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size*resolution;
    const pixels=canvas.width*canvas.height;
    while(ringImages.size&&(ringImages.size>=64||ringImagePixels+pixels>16000000)){
     const oldest=ringImages.keys().next().value;const image=ringImages.get(oldest);
     ringImagePixels-=image.canvas.width*image.canvas.height;ringImages.delete(oldest);
    }
    const context=canvas.getContext('2d');context.scale(resolution,resolution);
    drawEllipseRingPixels(context,{...c,scale:1,flatten:1,ringOpacity:1,ringPulse:0},size/2,size/2,rad,0,0,idx);
    cached={canvas,size};ringImages.set(key,cached);ringImagePixels+=pixels;
   }
   ctx.save();ctx.translate(cx,cy);
   const visualScale=c.ringVisualScale||1;ctx.scale(visualScale,c.flatten*visualScale);
   if(c.rotateSelection)ctx.rotate(-turn);
   ctx.globalAlpha*=Math.min(1,c.ringOpacity*(1+c.ringPulse*Math.sin(t*TAU*1.2)));
   // Downsample the high-resolution seal with coverage filtering; nearest
   // sampling otherwise drops the thin rune strokes entirely at normal zoom.
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   ctx.drawImage(cached.canvas,-cached.size/2,-cached.size/2,cached.size,cached.size);
   if(c.lightIntensity>0){
    ctx.globalCompositeOperation='screen';ctx.globalAlpha*=Math.min(1,c.lightIntensity);
    ctx.drawImage(cached.canvas,-cached.size/2,-cached.size/2,cached.size,cached.size);
    if(c.lightIntensity>1){ctx.globalAlpha*=Math.min(1,c.lightIntensity-1);
     ctx.drawImage(cached.canvas,-cached.size/2,-cached.size/2,cached.size,cached.size);}
   }
   ctx.restore();return;
  }
  drawEllipseRingPixels(ctx,c,cx,cy,r,turn,t,idx);
 }
 function drawEllipseRingPixels(ctx,c,cx,cy,r,turn,t,idx){
  const rad=r*c.scale,ry=rad*c.flatten;
  const n=Math.max(1,c.ringSegments),points=Math.max(128,Math.round(rad*TAU*8));
  const full=c.magicPattern&&idx===0 || n===1&&!c.rotateSelection;
  const pulse=1+c.ringPulse*Math.sin(t*TAU*1.2);
  const alpha=c.ringOpacity*pulse;
  const color=c.colors;
  const dark=rgba(color.shadow,alpha),main=rgba(color.main,alpha),light=rgba(color.highlight,alpha);
  // Complete each color layer before the next; otherwise neighboring outline
  // samples paint over the colored core and make the entire ring look brown.
  for(let layer=0;layer<3;layer++)for(let j=0;j<points;j++){
   const a=j/points*TAU;
   let u=frac((a+(c.rotateSelection?turn:0))*n/TAU);
   const gap=c.circleStyle==='debuff'?.18:c.circleStyle==='rune'?.035:.07;
   if(!full && (u<gap||u>1-gap))continue;
   const x=cx+Math.cos(a)*rad, y=cy+Math.sin(a)*ry;
   const thickness=c.ringThickness;
   if(layer===0)drawBlock(ctx,x-thickness*.5,y-thickness*.5,thickness,thickness,dark);
   else if(layer===1)drawBlock(ctx,x-thickness*.25,y-thickness*.25,thickness*.75,thickness*.75,main);
   else if(idx%2===1||j%12<4)drawBlock(ctx,x,y,.25,.25,light);
  }
  // Rotating diamonds distinguish the energy circle from the old plain oval.
  for(let k=0;k<n;k++){
   const a=k/n*TAU-turn, x=cx+Math.cos(a)*rad,y=cy+Math.sin(a)*ry;
   const s=Math.min(1.1,Math.max(.5,rad*.045));
   drawBlock(ctx,x-s,y-.25,s*2,.5,dark);drawBlock(ctx,x-.25,y-s*.7,.5,s*1.4,dark);
   drawBlock(ctx,x-s*.6,y-.125,s*1.2,.25,main);drawBlock(ctx,x-.125,y-s*.45,.25,s*.9,light);
  }
  if(c.magicPattern&&idx===0){
   // Adapt the laboratory's named arcane/rune/summon/debuff seal families.
   // Their geometry is baked into the image cache, never rebuilt per frame.
   const point=(a,radius)=>[cx+Math.cos(a)*radius,cy+Math.sin(a)*radius*c.flatten];
   const line=(a,b,color)=>{const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*8));
    for(let i=0;i<=steps;i++){const f=i/steps;drawBlock(ctx,a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,.25,.25,color);}};
   const poly=(vertices,color=main)=>{for(let i=1;i<vertices.length;i++)line(vertices[i-1],vertices[i],color);};
   const local=(x,y,angle=0)=>[cx+(x*Math.cos(angle)-y*Math.sin(angle)),cy+(x*Math.sin(angle)+y*Math.cos(angle))*c.flatten];
   const q=rad*.28,angle=-turn;
   switch(c.centerSymbol){
    case 'triangles':
     for(let z=0;z<2;z++)poly(Array.from({length:4},(_,i)=>point(i*TAU/3-PI/2+z*PI+angle,rad*.52)));break;
    case 'cross':
     poly([local(0,-q,angle),local(0,q,angle)],light);poly([local(-q,0,angle),local(q,0,angle)],light);
     poly([local(0,-q*1.4,angle),local(q*1.4,0,angle),local(0,q*1.4,angle),local(-q*1.4,0,angle),local(0,-q*1.4,angle)]);break;
    case 'shield':
     poly([local(-q,-q,angle),local(q,-q,angle),local(q*.8,q*.4,angle),local(0,q*1.3,angle),local(-q*.8,q*.4,angle),local(-q,-q,angle)]);
     line(local(0,-q*.6,angle),local(0,q*.8,angle),light);break;
    case 'hourglass':
     poly([local(-q,-q,angle),local(q,-q,angle),local(-q,q,angle),local(q,q,angle),local(-q,-q,angle)]);break;
    case 'blade':
     poly([local(0,-q*1.5,angle),local(q*.35,0,angle),local(0,q*.65,angle),local(-q*.35,0,angle),local(0,-q*1.5,angle)],light);
     line(local(-q*.8,q*.55,angle),local(q*.8,q*.55,angle),main);line(local(0,q*.55,angle),local(0,q*1.3,angle),light);break;
    case 'sun':
     for(let k=0;k<8;k++)line(point(k*TAU/8+angle,q*.6),point(k*TAU/8+angle,q*1.5),light);break;
    case 'venom':
     poly([local(0,-q*1.4,angle),local(q,q*.25,angle),local(q*.6,q,angle),local(-q*.6,q,angle),local(-q,q*.25,angle),local(0,-q*1.4,angle)]);
     line(local(-q*.5,q*.25,angle),local(q*.5,q*.25,angle),light);break;
    case 'rune':
     poly([local(-q,-q*.5,angle),local(0,-q,angle),local(q,-q*.5,angle),local(0,q,angle),local(-q,-q*.5,angle)],light);
     line(local(-q,0,angle),local(q,0,angle),main);break;
    default:
     poly([local(0,-q,angle),local(q,0,angle),local(0,q,angle),local(-q,0,angle),local(0,-q,angle)]);
     line(local(-q*.6,0,angle),local(q*.6,0,angle),light);
   }
   const glyphs=c.glyphCount||12;
   const glyphShapes=[ [[-1,-1],[0,1],[1,-1]], [[0,-1],[1,0],[0,1],[-1,0],[0,-1]],
    [[-1,-1],[1,1],[1,-1],[-1,1]], [[0,-1],[0,1],[-1,0],[1,0]],
    [[-1,-.5],[0,-1],[1,-.5],[0,1],[-1,-.5]], [[-1,-1],[-1,1],[1,-1],[1,1]] ];
   for(let k=0;k<glyphs;k++){
    const a=k*TAU/glyphs-turn,center=point(a,rad*.85),size=Math.max(.3,rad*.04);
    const shape=glyphShapes[k%glyphShapes.length].map(([x,y])=>[
     center[0]+(x*Math.cos(a)-y*Math.sin(a))*size,
     center[1]+(x*Math.sin(a)+y*Math.cos(a))*size*c.flatten]);
    poly(shape,k%3===0?light:main);
    line(point(a,rad*.96),point(a,rad*.91),light);
   }
  }
 }
 const particleScratch={x:0,y:0,phase:0};
 function particleBase(c,i,total,t,kind){
  const a=TAU*(i/Math.max(1,total)+rand(c.seed,i,7)*.13+t*c.particleSpeed*.035*(i%2?1:-1));
  const phase=frac(rand(c.seed,i,3)+t*c.particleSpeed*(.28+rand(c.seed,i,4)*.35));
  const r=c.ringRadius*c.scale;
  particleScratch.phase=phase;
  if(kind==='ground'){particleScratch.x=Math.cos(a)*r*(.84+rand(c.seed,i,5)*.24);particleScratch.y=Math.sin(a)*r*c.flatten*(.84+rand(c.seed,i,6)*.24);}
  else {particleScratch.x=Math.cos(a)*(5+rand(c.seed,i,2)*r*.45);particleScratch.y=Math.sin(a)*(3+rand(c.seed,i,9)*r*.18);}
  return particleScratch;
 }
 function drawGroundParticles(ctx,c,cx,cy,t){
  if(!c.groundParticles)return;
  const count=c.groundCount, pal=c.colors;
  for(let i=0;i<count;i++){
   const p=particleBase(c,i,count,t,'ground');
   const alpha=c.particleOpacity*(.3+.7*Math.sin(PI*p.phase));
   drawParticle(ctx,cx+p.x,cy+p.y,c.particleSize*c.scale,
     c.unifyParticles?c.particleShape:c.groundParticleShape,pal,alpha*.8);
  }
 }
 // Pixel-only emitters: inspired by CSS rise/keyframes, not a DOM particle per sprite.
 // Ground particles climb from an isometric ellipse; actor particles rise around the sprite.
 function drawRisingParticles(ctx,c,cx,cy,t,emitter){
  const isGround=emitter==='ground',count=isGround?c.groundCount:c.auraCount;
  if(isGround&&!c.groundParticles||!isGround&&!c.auraParticles)return;
  const isFire=c.emissionStyle==='flame';
  const r=c.ringRadius*c.scale;
  for(let i=0;i<count;i++){
   const p=particleBase(c,i,count,t,emitter);
   const v=p.phase;
   const upward=c.auraHeight*c.scale*(isGround?.65:1);
   const swell=Math.sin(PI*v);
   const turbulence=isFire?c.flameTurbulence:0.22;
   const sway=Math.sin(t*5.7+i*2.8)*turbulence*5*c.scale*(.2+v);
   const x=cx+p.x+sway;
   const y=cy+p.y-upward*v;
   const alpha=c.particleOpacity*(isFire?Math.pow(swell,.95):Math.pow(swell,.7));
   const shape=c.unifyParticles?c.particleShape:(isGround?c.groundParticleShape:c.auraParticleShape);
   const sz=c.particleSize*c.scale*(i%9===0?1.3:1)*(isFire?(1-v*.78):1);
   if(c.particleGlow>0)drawBlock(ctx,x-2*sz,y-2*sz,5*sz,5*sz,rgba(c.colors.main,alpha*c.particleGlow*.14));
   drawParticle(ctx,x,y,sz,shape,c.colors,alpha);
  }
 }
 // A volumetric-looking heart, formed exclusively from many independent sprites.
 // The surface follows a parametric heart. Interior points and pulsing depth create volume.
 function drawHeartParticles(ctx,c,cx,cy,t){
  if(!c.auraParticles)return;
  const count=Math.min(400,Math.max(1,c.auraCount));
  const rad=Math.max(8,c.ringRadius*c.heartScale*c.scale*.93);
  const pulse=1+.035*Math.sin(t*4.3);
  const centerY=cy-c.auraHeight*c.scale*.95;
  const period=Math.max(.4,3.6/Math.max(.2,c.particleSpeed));
  for(let i=0;i<count;i++){
   const a=TAU*rand(c.seed,i,19);
   const shell=rand(c.seed,i,21)>.34;
   const depth=shell ? (0.80+rand(c.seed,i,25)*.2) : Math.sqrt(rand(c.seed,i,25))*.84;
   const hx=16*Math.sin(a)**3 / 18;
   const hy=-(13*Math.cos(a)-5*Math.cos(2*a)-2*Math.cos(3*a)-Math.cos(4*a))/18;
   const phase=frac(rand(c.seed,i,30)+t/period);
   const scatter=(phase>.76? ((phase-.76)/.24)*6:0);
   const dx=Math.sin(t*3+i*7.3)*scatter;
   const dy=Math.cos(t*4+i*9.4)*scatter;
   const x=cx+hx*rad*depth*pulse+dx;
   const y=centerY+hy*rad*depth*pulse*.78+dy-3*Math.sin(t*2);
   const alpha=c.particleOpacity*(.25+.75*Math.abs(Math.sin(t*3.3+i*1.53)))*(phase>.78?(1-phase)/.22:1);
   const sz=c.particleSize*c.scale*(.6+rand(c.seed,i,27)*.8);
   if(c.particleGlow>0)drawBlock(ctx,x-2*sz,y-2*sz,5*sz,5*sz,rgba(c.colors.main,alpha*c.particleGlow*.16));
   const shape=c.unifyParticles?c.particleShape:c.auraParticleShape;
   drawParticle(ctx,x,y,sz,shape,c.colors,alpha);
  }
 }
 class DebuffSystem{
  constructor(){this.effects=new Map();this.nextId=1;}
  apply(entityId,params={}){
   if(entityId===undefined||entityId===null)throw new Error('entityId obrigatório');
   const id=this.nextId++;
   const c=normalize(params);
   this.effects.set(id,{id,entityId,config:c,age:0});return id;
  }
  setConfig(effectId,changes){const item=this.effects.get(effectId);if(!item)return false;
   item.config=normalize({...item.config,...changes,colors:{...item.config.colors,...changes?.colors}});return true;}
  remove(effectId){return this.effects.delete(effectId)}
  clearEntity(entityId){for(const [k,v] of this.effects)if(v.entityId===entityId)this.effects.delete(k)}
  clear(){this.effects.clear()}
  update(dt,getPosition){
   const step=clamp(Number(dt)||0,0,.15);
   for(const [id,e] of this.effects){
    e.age+=step;
    if(e.age>=e.config.duration){this.effects.delete(id);continue}
    if(getPosition){const pos=getPosition(e.entityId);if(pos){e.config.position.x=pos.x;e.config.position.y=pos.y;}}
   }
  }
  drawGround(ctx,worldToScreen=p=>p){
   for(const e of this.effects.values()){
    const c=e.config;if(c.enabled===false)continue;const p=worldToScreen(c.position);
    if(!p)continue;const x=p.x,y=p.y;
    if(c.ringOpacity>.001)for(let n=0;n<c.ringCount;n++)drawEllipseRing(ctx,c,x,y,c.ringRadius*(1-n*.13),e.age*c.rotationSpeed*TAU,e.age,n);
    if(c.particleMotion==='orbit'&&!c.unifyParticles)drawGroundParticles(ctx,c,x,y,e.age);
   }
  }
  drawAura(ctx,worldToScreen=p=>p){
   for(const e of this.effects.values()){
    const c=e.config;if(c.enabled===false)continue;const p=worldToScreen(c.position);if(!p)continue;
    if(c.particleMotion==='rise'||c.unifyParticles)drawRisingParticles(ctx,c,p.x,p.y,e.age,'ground');
    if(c.emissionStyle==='heart')drawHeartParticles(ctx,c,p.x,p.y,e.age);
    else drawRisingParticles(ctx,c,p.x,p.y,e.age,'aura');
   }
  }
  serialize(){return [...this.effects.values()].map(e=>({entityId:e.entityId,config:{...e.config},age:e.age}))}
 }

export { DebuffSystem, normalize, drawEllipseRing, opts as DEFAULTS, palettes as PRESETS };
