/* FORJA UI V5 — tiled PNG interface engine (no dependencies)
 * 3-slice: repeated ribbon/sword mids with untouched end caps.
 * 9-slice: CSS border-image corners preserved, edges/center always repeated.
 */
(function(root){
 'use strict';
 const COLORS=['cyan','red','yellow','purple','black'];
 const HERALDRY=['leao','espadas','lobo','dragao','cervo','torre','fenix','arvore','estrela','coroa','cristal','touro','flor-de-lis','asas','sol','machados'];
 const SKINS={
   scroll:{file:'scroll.png',slice:'128',edge:56},
   paper:{file:'paper.png',slice:'64',edge:30},
   stone:{file:'stone.png',slice:'64',edge:30},
   slot:{file:'slot.png',slice:'64',edge:28},
   wood:{file:'wood-panel.png',slice:'85 84 103 84',edge:38},
   'wood-slot':{file:'wood-slot.png',slice:'64',edge:30}
 };
 function src(file){ return root.FORJA_ASSETS?.[file]||'../assets/sprites/'+file; }
 function el(tag,cls,text){let e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;}
 function hex(color){return {cyan:'#4eacb8',red:'#cd6a67',yellow:'#d5bc53',purple:'#a67bac',black:'#8995ad'}[COLORS.includes(color)?color:'cyan'];}
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
 const swordTag=(color,title,cls='',h)=>band('sword',color,title,cls,h);
 function crest(color,symbol='✦',iconNumber=0,crestId=0){
  const id=Number(crestId);const box=el('div','crest-mark');box.style.setProperty('--accent',hex(color));
  if(Number.isInteger(id)&&id>0&&id<=HERALDRY.length){
   box.classList.add('is-heraldry');const image=el('img','heraldry-image');
   image.src=src(`heraldry-${String(id).padStart(2,'0')}-${HERALDRY[id-1]}.png`);
   image.alt=`Brasão ${HERALDRY[id-1]}`;image.draggable=false;box.append(image);return box;
  }
  const frame=el('img');frame.src=src(`crest-${COLORS.includes(color)?color:'cyan'}.png`);frame.alt='';frame.draggable=false;box.append(frame);
  let n=Number(iconNumber);
  if(Number.isInteger(n)&&n>=1&&n<=12){const img=el('img','crest-icon');img.src=src(`icon-${String(n).padStart(2,'0')}.png`);img.alt='';img.draggable=false;box.append(img);}
  else box.append(el('span','crest-symbol',symbol));
  return box;
 }
 function sizing(node,data,defaultW,defaultH){
  const w=Math.max(180,Math.min(1100,Number(data.width)||defaultW));
  const h=Math.max(220,Math.min(850,Number(data.height)||defaultH));
  const scale=Math.max(65,Math.min(145,Number(data.ribbonScale)||100))/100;
  node.style.setProperty('--card-w',w+'px');node.style.setProperty('--card-h',h+'px');node.style.setProperty('--band-scale',String(scale));
  node.classList.toggle('is-wide',w/h>1.7);
  node.classList.toggle('is-compact',w<255||h<310);
  node.classList.toggle('is-small-height',h<280);
  node.dataset.size=`${w} × ${h}`;
 }
 function progress(level,variant='big',label='Vida',color='red'){
  return root.ForjaHUD.create({value:level,size:variant,label,color});
 }

 function makeAction(d,baseClass,label,callback){
  const theme=d.color==='red'||d.color==='yellow'?'red':'blue';
  const style=['panel','square','round'].includes(d.buttonStyle)?d.buttonStyle:'panel';
  const action=el('button',`${baseClass} sprite-action button-${style} variant-${theme}`,label);
  const w=Number(d.buttonWidth),h=Number(d.buttonHeight);
  action.style.setProperty('--button-width',`${Number.isFinite(w)?Math.max(90,Math.min(500,w)):156}px`);
  action.style.setProperty('--button-height',`${Number.isFinite(h)?Math.max(36,Math.min(96,h)):48}px`);
  action.type='button';action.addEventListener('click',()=>callback?.(d));
  return action;
 }
 function makeCard(raw,options={}){
  const d=raw||{};const skin=SKINS[d.skin]?d.skin:'scroll';
  const node=el('article',`game-card skin-${skin}`);node.style.setProperty('--accent',hex(d.color));
  sizing(node,d,280,360);node.append(skinLayer(skin));
  if(d.showRibbon!==false)node.append(d.headingStyle==='sword'?swordTag(d.color,d.title,'card-head-sword'):ribbon(d.color,d.title,'card-head-ribbon'));
  else node.append(el('h3','card-plain-title',d.title||'Novo componente'));
  const body=el('div','card-body');
  if(d.showCrest!==false)body.append(crest(d.color,d.symbol||'✦',d.icon,d.crestId));
  const content=el('div','card-main');content.append(el('p','card-description',d.description||'Descreva este componente no editor.'));
  content.append(el('span','card-tag',d.tag||'RECOMPENSA'));
  if(d.showProgress)content.append(progress(d.progress??60,d.progressStyle||'big','Recurso',d.progressColor||'red'));
  body.append(content);
  body.append(makeAction(d,'card-action','EXPLORAR ↗',options.onAction));
  node.append(body);return node;
 }
 function makeBanner(raw,options={}){
  const d=raw||{};const skin=SKINS[d.skin]?d.skin:'scroll';const node=el('section',`hero-card skin-${skin}`);
  sizing(node,d,710,390);node.append(skinLayer(skin));
  const body=el('div','hero-card-inner');
  if(d.showCrest!==false)body.append(crest(d.color,d.symbol||'✦',d.icon,d.crestId));
  if(d.showRibbon!==false)body.append(d.headingStyle==='sword'?swordTag(d.color,d.title,'hero-sword'):ribbon(d.color,d.title,'hero-ribbon'));
  else body.append(el('h2','hero-simple-title',d.title||'O Reino Aguarda'));
  body.append(el('p','hero-description',d.description||'Uma aventura espera por você.'));
  body.append(el('div','hero-eyebrow',d.tag||'NOVA AVENTURA'));
  if(d.showProgress)body.append(progress(d.progress??60,d.progressStyle||'big','Recurso',d.progressColor||'red'));
  body.append(makeAction(d,'hero-action','INICIAR AVENTURA ↗',options.onAction));
  node.append(body);return node;
 }
 function makeInventory(cards,options={}){
  const selected=cards[0]||{};
  const panel=el('div','inventory-panel skin-wood');
  panel.style.setProperty('--card-w',`${Math.max(280,Number(selected.width)||610)}px`);
  panel.append(skinLayer('wood'));
  const head=el('div','inventory-head');head.append(el('h2',null,'Inventário do Herói'),el('span',null,`${cards.length} / 12 ITENS`));panel.append(head);
  const grid=el('div','inventory-grid');
  cards.slice(0,12).forEach(d=>{
   const tile=el('button','inventory-item skin-wood-slot');tile.type='button';tile.title=d.title||'Item';
   tile.append(skinLayer('wood-slot'),crest(d.color,d.symbol||'✦',d.icon,d.crestId));
   tile.addEventListener('click',()=>options.onAction?.(d));grid.append(tile);
  });
  for(let n=cards.length;n<Math.max(8,cards.length);n++){
   const tile=el('div','inventory-item inventory-empty skin-wood-slot');tile.append(skinLayer('wood-slot'),el('span','inventory-empty-glyph','+'));grid.append(tile);
  }
  panel.append(grid,el('div','inventory-legend','✧ Selecione um brasão para inspecionar o item'));return panel;
 }
 root.FantasyUI=Object.freeze({makeAction,makeCard,makeBanner,makeInventory,skinLayer,ribbon,swordTag,crest,progress,SKINS,COLORS,HERALDRY});
})(window);
