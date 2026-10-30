import { uiAssetUrl } from '../asset-paths.js';

// Reusable panel skins and decorative ribbons.
const COLORS=['cyan','red','yellow','purple','black'];
const SKINS={
  scroll:{file:'scroll.png',slice:'128',edge:56},
  paper:{file:'paper.png',slice:'64',edge:30},
  stone:{file:'stone.png',slice:'64',edge:30},
  slot:{file:'slot.png',slice:'64',edge:28},
  wood:{file:'wood-panel.png',slice:'85 84 103 84',edge:38},
  'wood-slot':{file:'wood-slot.png',slice:'64',edge:30}
};
function src(file){ return uiAssetUrl(file, import.meta.env.PROD ? 'webp' : 'png'); }
function el(tag,cls,text){let e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;}
function skinLayer(name='scroll'){
 const skin=SKINS[name]||SKINS.scroll;
 const layer=el('div','skin-layer');layer.setAttribute('aria-hidden','true');
 layer.style.setProperty('--sprite',`url("${src(skin.file)}")`);
 layer.style.setProperty('--slice',skin.slice);
 layer.style.setProperty('--edge',`${skin.edge}px`);
 layer.style.setProperty('--tiling','repeat');
 return layer;
}
// The source atlas has 128 px tall ribbon/sword frames. Cropped strips preserve the caps.
function band(kind,color,title,cls='',height){
 const type=kind==='sword'?'sword':'ribbon';const c=COLORS.includes(color)?color:'cyan';
 const wrap=el('div',`${type==='sword'?'sword-tab':'decorative-ribbon'} tiled-band ${cls}`);
 if(height)wrap.style.setProperty('--band-h',`${height}px`);
 wrap.style.setProperty('--cap-left',type==='sword'?'1.015625':'.875'); // source crop px / 128px
 wrap.style.setProperty('--cap-right',type==='sword'?'.875':'.875');
 ['left','center','right'].forEach(p=>{
   const part=el('span',`band-${p}`);part.setAttribute('aria-hidden','true');
   part.style.backgroundImage=`url("${src(`${type}-${c}-${p}.png`)}")`;
   wrap.append(part);
 });
 wrap.append(el('strong',type==='sword'?'sword-label':'ribbon-text',title||'SEM TÍTULO'));
 return wrap;
}
const ribbon=(color,title,cls='',h)=>band('ribbon',color,title,cls,h);
export const surfaceComponents = Object.freeze({ skinLayer, ribbon });
