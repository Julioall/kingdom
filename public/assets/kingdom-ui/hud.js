/* Forja HUD — reusable browser component, no framework dependencies.
 * Uses original BigBar/SmallBar frame crops and color-preserving fill sprites.
 * Center slices repeat in X; the frame never stretches its corners.
 */
(function(root){
  'use strict';
  const COLORS=Object.freeze(['red','blue','green','yellow','purple','gray']);
  const SIZES=Object.freeze(['big','small']);
  function base(){return root.FORJA_ASSET_BASE||'../assets/sprites/';}
  const clamp=(v,max=100)=>Math.min(max,Math.max(0,Number.isFinite(Number(v))?Number(v):0));
  function asset(name){return `${base()}${name}`;}
  function make(tag,css){const e=document.createElement(tag);e.className=css;return e;}
  function setValue(node,value,max=100){
    const limit=Math.max(1,Number(max)||100), val=clamp(value,limit);
    node.querySelector('.progress-fill').style.width=`${val/limit*100}%`;
    node.setAttribute('aria-valuemax',String(limit));node.setAttribute('aria-valuenow',String(val));
    node.dataset.value=String(val);node.dataset.max=String(limit);
    return node;
  }
  function setColor(node,color){
    const c=COLORS.includes(color)?color:'red';
    node.dataset.color=c;
    node.querySelector('.progress-fill').style.backgroundImage=`url("${asset(`hud-${node.dataset.size}-fill-${c}.png`)}")`;
    return node;
  }
  function create(options={}){
    const size=SIZES.includes(options.size)?options.size:'big';
    const bar=make('div',`forja-hud tiled-progress hud-${size}`);bar.dataset.size=size;
    bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');
    bar.setAttribute('aria-label',options.label||'Recurso');
    if(options.width!==undefined){
      const px=Number(options.width);
      if(Number.isFinite(px))bar.style.width=`${Math.max(65,px)}px`;
    }
    const track=make('div','progress-track');track.setAttribute('aria-hidden','true');
    ['left','center','right'].forEach(part=>{
      const el=make('span',`hud-track-${part}`);
      el.style.backgroundImage=`url("${asset(`hud-${size}-track-${part}.png`)}")`;
      track.append(el);
    });
    const viewport=make('div','progress-fill-viewport');viewport.setAttribute('aria-hidden','true');
    viewport.append(make('div','progress-fill'));bar.append(track,viewport);
    setColor(bar,options.color||'red');setValue(bar,options.value??75,options.max??100);
    return bar;
  }
  root.ForjaHUD=Object.freeze({create,setValue,setColor,COLORS,SIZES});
})(window);
