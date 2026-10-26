import manifest from './animation-manifest.js';

export const ANIMATIONS = Object.freeze(Object.fromEntries(manifest.entries.map(entry => [entry.id,
  Object.freeze({ ...entry, anchor: Object.freeze(entry.anchor) })])));
export const STATIC_SPRITE_SOURCES = Object.freeze(manifest.staticSources.slice());

const unitAliases = { aldeao: 'pawn', 'aldeão': 'pawn', resident: 'pawn', lanceiro: 'lancer',
  guerreiro: 'warrior', arqueiro: 'archer', monge: 'monk' };
const slug = value => value.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_ ]+/g, '-').toLowerCase();
const unitAnimationCache = new Map();

export function getAnimation(id) {
  const animation = ANIMATIONS[id];
  if (!animation) throw new Error('Unknown animation: ' + id);
  return animation;
}

export function listAnimations(filters = {}) {
  return Object.values(ANIMATIONS).filter(animation => Object.entries(filters)
    .every(([field, value]) => animation[field] === value));
}

export function getUnitAnimation(unit, action, palette = 'blue') {
  const key = unit + ':' + action + ':' + palette;
  const cached = unitAnimationCache.get(key);
  if (cached) return cached;
  unit = unitAliases[unit] || unit.toLowerCase();
  action = slug(action);
  action = ({ shoot: 'attack', attack1: 'attack', attack2: 'attack-2', guard: 'defend' })[action] || action;
  const animation = getAnimation(`unit.${palette}.${unit}.${action}`);
  unitAnimationCache.set(key, animation);
  return animation;
}

export function getAnimationFrame(animation, elapsedMs, { loop, phase = 0 } = {}) {
  if (typeof animation === 'string') animation = getAnimation(animation);
  loop ??= animation.loop;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const offset = Number.isFinite(phase) ? Math.trunc(phase) : 0;
  const step = Math.floor(elapsed * animation.fps / 1000) + offset;
  const index = loop ? ((step % animation.frames) + animation.frames) % animation.frames
    : Math.max(0, Math.min(animation.frames - 1, step));
  return { index, sx: index * animation.frameWidth, sy: 0,
    sw: animation.frameWidth, sh: animation.frameHeight,
    done: !loop && (animation.frames === 1 || step >= animation.frames) };
}

// A renderer owns its cache. Creating a catalog or importing this module never
// loads the entire pack, and Node consumers do not need a browser DOM.
export function createAnimationRenderer({ imageFactory = () => new Image(), onReady = () => {}, onError = () => {} } = {}) {
  const images = new Map();
  function load(animation) {
    if (typeof animation === 'string') animation = getAnimation(animation);
    let entry = images.get(animation.url);
    if (entry) return entry.promise;
    const image = imageFactory();
    entry = { image, ready: false, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      image.onload = () => { entry.ready = true; resolve(image); onReady(animation); };
      image.onerror = () => reject(new Error('Could not load animation: ' + animation.url));
    });
    images.set(animation.url, entry);
    image.src = animation.url;
    return entry.promise;
  }
  function draw(ctx, animation, x, y, { elapsedMs = 0, scale = 1, flipX = false, rotation = 0, loop, phase = 0 } = {}) {
    if (typeof animation === 'string') animation = getAnimation(animation);
    const cached = images.get(animation.url);
    if (!cached) { load(animation).catch(onError); return false; }
    if (!cached.ready) return false;
    const frame = getAnimationFrame(animation, elapsedMs, { loop, phase });
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.scale(flipX ? -scale : scale, scale);
    ctx.drawImage(cached.image, frame.sx, frame.sy, frame.sw, frame.sh,
      -animation.anchor.x, -animation.anchor.y, frame.sw, frame.sh);
    ctx.restore();
    return true;
  }
  return { load, draw };
}
