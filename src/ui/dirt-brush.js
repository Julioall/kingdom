/**
 * Kingdom Dirt Brush 1.0.0
 * Pincel procedural de solo exposto para jogos 2D. Sem dependências.
 * Canvas transparente: apenas a terra é desenhada; nada é pintado fora das manchas.
 *
 * @license MIT
 */

export const SOIL_PALETTE = Object.freeze({
  base: '#AA764A',       // mancha de terra da imagem de referência
  light: '#BF9767',      // areia/solo iluminado da imagem
  highlight: '#B68455',  // variação discreta dentro do solo
  dark: '#98643F',       // pequenas regiões compactadas
  speckle: '#D0A67B'     // poeira / grãos ocasionais
});

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const createCanvas = (w, h) => { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; };

function hash(x, y, seed = 0) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = smooth(x - ix), ty = smooth(y - iy);
  const a = lerp(hash(ix,iy,seed),hash(ix+1,iy,seed),tx);
  const b = lerp(hash(ix,iy+1,seed),hash(ix+1,iy+1,seed),tx);
  return lerp(a,b,ty);
}
function hexRgb(hex) {
  const s = String(hex).replace('#','');
  const value = s.length === 3 ? s.split('').map(c=>c+c).join('') : s;
  const n = parseInt(value,16);
  if (!Number.isFinite(n)) return [170,118,74];
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function colorMix(a,b,t) { return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]; }

function stamp(ctx, x, y, radius, roughness, seed) {
  const points = 28;
  const phase1 = hash(seed,1,13) * TAU;
  const phase2 = hash(seed,2,37) * TAU;
  const phase3 = hash(seed,3,67) * TAU;
  const pts = [];
  for (let i=0;i<points;i++) {
    const a = i/points*TAU;
    const jitter = Math.sin(a*3+phase1)*0.095 + Math.sin(a*6+phase2)*0.062
      + Math.sin(a*11+phase3)*0.024;
    const r = radius * (1 + jitter * roughness * 1.9);
    pts.push([x + Math.cos(a)*r, y + Math.sin(a)*r]);
  }
  ctx.beginPath();
  const last=pts[points-1], first=pts[0];
  ctx.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
  for (let i=0;i<points;i++) {
    const p=pts[i], next=pts[(i+1)%points];
    ctx.quadraticCurveTo(p[0],p[1],(p[0]+next[0])/2,(p[1]+next[1])/2);
  }
  ctx.closePath();
  ctx.fill();
}
function drawStroke(ctx, stroke) {
  const pts=stroke.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation=stroke.erase?'destination-out':'source-over';
  ctx.fillStyle='#fff';
  if (pts.length===1) {
    stamp(ctx,pts[0].x,pts[0].y,stroke.size*0.5*clamp(pts[0].p,.25,2.3),stroke.irregularity,stroke.id*937);
    ctx.restore();return;
  }
  // Uma forma contínua, em vez de dezenas de círculos sobrepostos.
  // Amostra o caminho, cria duas margens ruidosas e fecha as extremidades.
  const step=Math.max(3.5,stroke.size*0.105);
  const samples=[{...pts[0],dist:0}];
  let last=pts[0], traveled=0, next=step;
  for(let i=1;i<pts.length;i++) {
    const pt=pts[i], seg=Math.hypot(pt.x-last.x,pt.y-last.y);
    if(seg<.01){last=pt;continue;}
    while(next<=traveled+seg) {
      const t=(next-traveled)/seg;
      samples.push({x:lerp(last.x,pt.x,t),y:lerp(last.y,pt.y,t),p:lerp(last.p,pt.p,t),dist:next});
      next+=step;
    }
    traveled+=seg;last=pt;
  }
  if(traveled<.01) {
    stamp(ctx,last.x,last.y,stroke.size*.5,stroke.irregularity,stroke.id*937);
    ctx.restore();return;
  }
  if(Math.abs(traveled-samples.at(-1).dist)>.5) samples.push({x:last.x,y:last.y,p:last.p,dist:traveled});
  const left=[],right=[];
  for(let i=0;i<samples.length;i++){
    const p=samples[i];
    const before=samples[Math.max(0,i-2)],after=samples[Math.min(samples.length-1,i+2)];
    const theta=Math.atan2(after.y-before.y,after.x-before.x);
    const nx=-Math.sin(theta),ny=Math.cos(theta);
    const d=p.dist;
    const shape=(side,offset)=> {
      const broad=noise(d/71,offset,stroke.id*29+83);
      const mid=noise(d/21,offset+5,stroke.id*29+33);
      const fine=noise(d/6.3,offset+11,stroke.id*29+77);
      return 1+stroke.irregularity*((broad-.5)*.66+(mid-.5)*.34+(fine-.5)*.16);
    };
    const r=stroke.size*.5*clamp(p.p,.25,2.3);
    const a=r*shape('left',1.4),b=r*shape('right',14.2);
    left.push({x:p.x+nx*a,y:p.y+ny*a});
    right.push({x:p.x-nx*b,y:p.y-ny*b});
  }
  const fst=samples[0],lst=samples.at(-1);
  const startAngle=Math.atan2(samples[1].y-fst.y,samples[1].x-fst.x);
  const endAngle=Math.atan2(lst.y-samples.at(-2).y,lst.x-samples.at(-2).x);
  const r0=stroke.size*.5*clamp(fst.p,.25,2.3);
  const r1=stroke.size*.5*clamp(lst.p,.25,2.3);
  ctx.beginPath();ctx.moveTo(left[0].x,left[0].y);
  for(let i=1;i<left.length;i++)ctx.lineTo(left[i].x,left[i].y);
  ctx.quadraticCurveTo(lst.x+Math.cos(endAngle)*r1*1.1,lst.y+Math.sin(endAngle)*r1*1.1,right.at(-1).x,right.at(-1).y);
  for(let i=right.length-2;i>=0;i--)ctx.lineTo(right[i].x,right[i].y);
  ctx.quadraticCurveTo(fst.x-Math.cos(startAngle)*r0*1.1,fst.y-Math.sin(startAngle)*r0*1.1,left[0].x,left[0].y);
  ctx.closePath();ctx.fill();ctx.restore();
}

/** @typedef {{x:number,y:number,p?:number}} SoilPoint */
/**
 * API:
 * new DirtBrush({canvas, size:70, irregularity:.8, palette:SOIL_PALETTE, autoBind:true})
 * beginStroke(x,y,pressure?,erase?) → addPoint(x,y,pressure?) → endStroke()
 * paint([{x,y}, ...], {size,irregularity,erase})
 * appendPaths([{key, points, options}]) → adiciona pontos a caminhos persistentes sem redesenhar o histórico
 * undo(), redo(), clear(), setOptions({...}), resize(w,h), toDataURL(), download(), destroy()
 */
export class DirtBrush {
  constructor(options={}) {
    if(!options.canvas || !(options.canvas instanceof HTMLCanvasElement))
      throw new Error('DirtBrush: informe um canvas HTML na opção {canvas}.');
    this.canvas=options.canvas;
    this.ctx=this.canvas.getContext('2d', {alpha:true});
    if(!this.ctx) throw new Error('DirtBrush: Canvas 2D indisponível.');
    this.size=clamp(Number(options.size ?? 72),5,300);
    this.irregularity=clamp(Number(options.irregularity ?? .77),0,1);
    this.palette={...SOIL_PALETTE,...(options.palette||{})};
    this.seed=Number(options.seed ?? 24801)|0;
    this.history=[];
    this.redoStack=[];
    this.pathStrokes=new Map();
    this.current=null;
    this.strokeId=1;
    this._boundHandlers=[];
    this.mask=createCanvas(1,1);this.maskCtx=this.mask.getContext('2d');
    this.texture=createCanvas(1,1);this.textureCtx=this.texture.getContext('2d',{willReadFrequently:true});
    this.layer=createCanvas(1,1);this.layerCtx=this.layer.getContext('2d');
    this.resize(Number(options.width || this.canvas.width || this.canvas.clientWidth || 980),
      Number(options.height || this.canvas.height || this.canvas.clientHeight || 600));
    if(options.autoBind !== false) this.bindPointer();
  }
  resize(width,height) {
    this.width=Math.max(1,Math.round(width));this.height=Math.max(1,Math.round(height));
    for(const c of [this.canvas,this.mask,this.texture,this.layer]) {c.width=this.width;c.height=this.height;}
    this._makeTexture();this.render();
    return this;
  }
  _makeTexture() {
    const w=this.width,h=this.height;
    const rgb={};for(const [k,v] of Object.entries(this.palette))rgb[k]=hexRgb(v);
    const img=this.textureCtx.createImageData(w,h),data=img.data;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const n=noise(x/92,y/92,this.seed)*.54
        + noise(x/31,y/31,this.seed+17)*.32
        + noise(x/9,y/9,this.seed+39)*.14;
      const tiny=noise(x/3,y/3,this.seed+97)-.5;
      const bright=clamp((n-.485)*8.0,0,.64);
      const shaded=clamp((.44-n)*7.2,0,.58);
      let c=colorMix(rgb.base,rgb.light,bright);
      c=colorMix(c,rgb.dark,shaded);
      const dust=hash(Math.floor(x/3),Math.floor(y/3),this.seed+87);
      if(dust>.995 && n>.43) c=colorMix(c,rgb.speckle,.34);
      const o=(y*w+x)*4;
      for(let k=0;k<3;k++)data[o+k]=clamp(c[k]+tiny*5,0,255)|0;
      data[o+3]=255;
    }
    this.textureCtx.putImageData(img,0,0);
    // Pedaços minúsculos e faixas orgânicas, sem repetir sprites externos.
    const ctx=this.textureCtx;
    for(let i=0;i<Math.ceil(w*h/1350);i++) {
      const x=hash(i,4,this.seed)*w,y=hash(i,7,this.seed)*h;
      const r=.55+hash(i,8,this.seed)*2.1;
      ctx.globalAlpha=.12+hash(i,9,this.seed)*.16;
      ctx.fillStyle=i%3===0?this.palette.light:this.palette.dark;
      ctx.beginPath();ctx.ellipse(x,y,r,r*(.32+hash(i,10,this.seed)*.4),hash(i,11,this.seed)*TAU,0,TAU);ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  bindPointer() {
    const canvas=this.canvas;
    canvas.style.touchAction='none';
    const coords=e=>{
      const r=canvas.getBoundingClientRect();
      return [(e.clientX-r.left)*this.width/(r.width||1),(e.clientY-r.top)*this.height/(r.height||1)];
    };
    const down=e=>{
      if(e.button!==undefined&&e.button!==0&&e.pointerType!=='touch')return;
      e.preventDefault();canvas.setPointerCapture?.(e.pointerId);
      const [x,y]=coords(e);
      this.beginStroke(x,y,e.pressure&&e.pressure!==.5?e.pressure*1.5:1,this.eraser||e.altKey);
    };
    const move=e=>{
      if(!this.current)return;e.preventDefault();
      for(const item of (e.getCoalescedEvents?.() || [e])) {
        const [x,y]=coords(item);
        this.addPoint(x,y,item.pressure&&item.pressure!==.5?item.pressure*1.5:1);
      }
    };
    const up=()=>{if(this.current)this.endStroke();};
    for(const [name,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up]]) {
      canvas.addEventListener(name,fn);this._boundHandlers.push([name,fn]);
    }
    return this;
  }
  setOptions(options={}) {
    if(options.size!==undefined)this.size=clamp(Number(options.size),5,300);
    if(options.irregularity!==undefined)this.irregularity=clamp(Number(options.irregularity),0,1);
    if(options.eraser!==undefined)this.eraser=!!options.eraser;
    if(options.palette) {this.palette={...this.palette,...options.palette};this._makeTexture();}
    if(options.seed!==undefined) {this.seed=options.seed|0;this._makeTexture();}
    this.render();return this;
  }
  beginStroke(x,y,pressure=1,erase=false) {
    if(this.current)this.endStroke();
    this.current={id:this.strokeId++,size:this.size,irregularity:this.irregularity,
      erase:!!erase,points:[{x,y,p:pressure}]};
    this.render();return this;
  }
  addPoint(x,y,pressure=1) {
    if(!this.current)return this;
    const p=this.current.points.at(-1);
    if(Math.hypot(p.x-x,p.y-y)<1.1)return this;
    this.current.points.push({x,y,p:pressure});
    this.render();return this;
  }
  endStroke() {
    if(this.current) {this.history.push(this.current);this.current=null;this.redoStack=[];this.render();}
    return this;
  }
  paint(points,options={}) {
    if(!Array.isArray(points)||!points.length)return this;
    const stroke={id:this.strokeId++,size:clamp(Number(options.size??this.size),5,300),
      irregularity:clamp(Number(options.irregularity??this.irregularity),0,1),
      erase:!!options.erase,points:points.map(p=>({x:p.x,y:p.y,p:p.p??1}))};
    this.history.push(stroke);this.redoStack=[];this.render();return this;
  }
  appendPaths(entries) {
    if(!Array.isArray(entries)||!entries.length)return this;
    let changed=false;
    for(const entry of entries) {
      if(entry?.key==null||!Array.isArray(entry.points)||!entry.points.length)continue;
      const key=String(entry.key);
      let stroke=this.pathStrokes.get(key);
      if(!stroke) {
        const options=entry.options||{};
        stroke={id:this.strokeId++,pathKey:key,size:clamp(Number(options.size??this.size),5,300),
          irregularity:clamp(Number(options.irregularity??this.irregularity),0,1),erase:false,points:[]};
        this.pathStrokes.set(key,stroke);this.history.push(stroke);
      }
      const added=[];
      for(const point of entry.points) {
        if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))continue;
        const next={x:point.x,y:point.y,p:point.p??1};
        const last=added.at(-1)||stroke.points.at(-1);
        if(last&&Math.hypot(last.x-next.x,last.y-next.y)<1.1)continue;
        added.push(next);
      }
      if(!added.length)continue;
      const last=stroke.points.at(-1);
      drawStroke(this.maskCtx,{...stroke,points:last?[last,...added]:added});
      stroke.points.push(...added);
      changed=true;
    }
    if(changed) {this.redoStack=[];this._composeLayer();}
    return this;
  }
  undo() {
    if(this.current)this.endStroke();
    if(this.history.length) {
      const stroke=this.history.pop();
      if(stroke.pathKey!=null)this.pathStrokes.delete(stroke.pathKey);
      this.redoStack.push(stroke);
    }
    this.render();return this;
  }
  redo() {
    if(this.redoStack.length) {
      const stroke=this.redoStack.pop();this.history.push(stroke);
      if(stroke.pathKey!=null)this.pathStrokes.set(stroke.pathKey,stroke);
    }
    this.render();return this;
  }
  clear() {this.history=[];this.redoStack=[];this.pathStrokes.clear();this.current=null;this.render();return this;}
  _composeLayer() {
    const l=this.layerCtx;
    l.clearRect(0,0,this.width,this.height);
    l.globalCompositeOperation='source-over';l.drawImage(this.texture,0,0);
    l.globalCompositeOperation='destination-in';l.drawImage(this.mask,0,0);
    l.globalCompositeOperation='source-over';
    this.ctx.clearRect(0,0,this.width,this.height);
    this.ctx.drawImage(this.layer,0,0);
  }
  render() {
    if(!this.width||!this.height)return this;
    this.maskCtx.clearRect(0,0,this.width,this.height);
    for(const stroke of this.history)drawStroke(this.maskCtx,stroke);
    if(this.current)drawStroke(this.maskCtx,this.current);
    this._composeLayer();
    return this;
  }
  toDataURL(type='image/png') {return this.canvas.toDataURL(type);}
  download(filename='kingdom-solo-transparente.png') {
    const a=document.createElement('a');a.download=filename;a.href=this.toDataURL();a.click();return this;
  }
  destroy() {
    for(const [name,fn] of this._boundHandlers)this.canvas.removeEventListener(name,fn);
    this._boundHandlers=[];this.current=null;this.history=[];this.redoStack=[];
  }
}

export default DirtBrush;
