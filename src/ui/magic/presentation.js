import { DebuffSystem, normalize, drawEllipseRing } from './particle-runtime.js';
import presets from './presets.json' with { type: 'json' };
import { SPELLS } from '../../simulation/magic/catalog.js';

const presetKinds = { weakness: 'weaken', 'blessed-weapons': 'focus', exhaustion: 'curse', protection: 'slow' };
const mix = (hex, amount) => '#' + hex.slice(1).match(/../g).map(part => {
  const value = parseInt(part, 16);
  return Math.round(value + (amount > 0 ? 255 - value : value) * amount).toString(16).padStart(2, '0');
}).join('');

export function createMagicPresentation({ tileSize, maxParticles = 800, maxEffects = 360 } = {}) {
  const system = new DebuffSystem(), entries = new Map(), indicatorConfigs = new Map(), styles = new Map();
  const visibleEntries = [], poseCache = new Map();
  let lastRenderAt = 0, particleCount = 0;

  function sync(world, renderAt = 0, reset = false) {
    if (reset) { system.clear(); entries.clear(); }
    const seen = new Set();
    function keep(key, data) {
      seen.add(key);
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= maxEffects) return;
        const spell = SPELLS[data.spellId], kind = presetKinds[data.spellId] || data.spellId;
        const preset = presets[kind + '_runtime']?.config || presets.curse_runtime.config;
        const style = styles.get(data.spellId) || {};
        const color = style.color || data.color || spell?.color || '#a5c99c';
        const handle = system.apply(key, { ...preset, kind, duration: Infinity,
          ringRadius: data.radius * tileSize, ringCount: data.circle ? 2 : 1,
          ringThickness: 1, ringSegments: 8, ringOpacity: data.circle ? .65 : 0,
          flatten: .53, rotationSpeed: spell?.rotationSpeed ?? .18, ringPulse: .04,
          groundCount: data.circle ? 8 : 3, auraCount: data.circle ? 6 : 4,
          particleSize: 1, auraHeight: tileSize * (data.circle ? 1.1 : 1.5),
          particleSpeed: data.particleSpeed ?? 1, particleOpacity: .6, particleGlow: 0,
          particleMotion: data.circle ? 'rise' : 'orbit', unifyParticles: false,
          colors: { main: color, highlight: mix(color, .35), shadow: mix(color, -.4) },
          ...style, particleGlow: 0 });
        entry = { handle, ...data }; entries.set(key, entry);
      }
      Object.assign(entry, data); entry.retiringAt = null;
    }
    for (const person of world.people) {
      if (!person.alive) continue;
      const cast = person.magicCast;
      if (cast) keep('cast:' + person.id + ':' + cast.startedAt, { spellId: cast.spellId,
        targetId: cast.targetId, x: cast.x, y: cast.y, radius: SPELLS[cast.spellId].radius || .6,
        circle: true, casterId: person.id });
      // Limit concurrent aura layers per unit; each active status retains its own logic.
      for (const effect of (person.magicEffects || []).slice(0, 3)) {
        keep('effect:' + person.id + ':' + effect.id, { spellId: effect.spellId, personId: person.id,
          color: effect.color, radius: .5, circle: false });
      }
    }
    for (const zone of world.magicZones || []) keep('zone:' + zone.id, { spellId: zone.spellId,
      x: zone.x, y: zone.y, radius: zone.radius, circle: true, particleSpeed: .6 });
    for (const event of world.magicEvents || []) {
      if (event.kind !== 'activated' || (world.magicTimeMs || 0) - event.at > 650) continue;
      for (const id of event.targetIds || []) keep('pulse:' + event.id + ':' + id,
        { spellId: event.spellId, personId: id, radius: .5, circle: false });
    }
    for (const [key, entry] of entries) {
      if (!seen.has(key) && entry.retiringAt == null) entry.retiringAt = renderAt;
    }
  }

  function prepare(world, renderAt, bounds, getPose) {
    const dt = Math.max(0, Math.min(.1, (renderAt - lastRenderAt) / 1000));
    lastRenderAt = renderAt;
    system.update(dt);
    particleCount = 0;
    visibleEntries.length = 0; poseCache.clear();
    for (const [key, entry] of entries) {
      const instance = system.effects.get(entry.handle), config = instance.config;
      if (entry.retiringAt != null && renderAt - entry.retiringAt >= 240) {
        system.remove(entry.handle); entries.delete(key); continue;
      }
      const personId = entry.personId ?? entry.targetId;
      if (personId != null && !poseCache.has(personId)) poseCache.set(personId, getPose(personId));
      const person = personId != null ? poseCache.get(personId) : null;
      const x = person?.x ?? entry.x, y = person?.y ?? entry.y;
      const radius = entry.radius + 2;
      config.enabled = Number.isFinite(x) && Number.isFinite(y)
        && x >= bounds.minX - radius && x <= bounds.maxX + radius
        && y >= bounds.minY - radius && y <= bounds.maxY + radius;
      if (!config.enabled) continue;
      config.position.x = (x + .5) * tileSize;
      config.position.y = (y + 1) * tileSize;
      const style = styles.get(entry.spellId) || {};
      const fade = entry.retiringAt == null ? 1 : Math.max(0, 1 - (renderAt - entry.retiringAt) / 240);
      config.ringOpacity = (entry.circle ? style.ringOpacity ?? .65 : 0) * fade;
      config.particleOpacity = (style.particleOpacity ?? .6) * fade;
      visibleEntries.push(entry);
    }
    // Share the budget across visible effects instead of starving the last units.
    const perEffect = Math.floor(maxParticles / Math.max(1, visibleEntries.length));
    for (const entry of visibleEntries) {
      const config = system.effects.get(entry.handle).config;
      const style = styles.get(entry.spellId) || {};
      const wanted = Math.min(40, Math.max(0, style.particleCount ?? (entry.circle ? 14 : 7)));
      const granted = Math.min(wanted, perEffect);
      config.groundCount = Math.min(entry.circle ? 8 : 3, granted);
      config.auraCount = granted - config.groundCount;
      particleCount += granted;
    }
  }

  function setSpellStyle(id, options) {
    if (!SPELLS[id] || !options || typeof options !== 'object') return false;
    const style = {};
    if (/^#[0-9a-f]{6}$/i.test(options.color)) {
      style.color = options.color;
      style.colors = { main: options.color, highlight: mix(options.color, .35), shadow: mix(options.color, -.4) };
    }
    for (const [key, low, high] of [['rotationSpeed', -1, 1], ['particleSpeed', 0, 5], ['particleCount', 0, 40],
      ['particleOpacity', 0, 1], ['ringOpacity', 0, 1]]) {
      if (Number.isFinite(options[key])) style[key] = Math.max(low, Math.min(high, options[key]));
    }
    styles.set(id, style);
    for (const entry of entries.values()) if (entry.spellId === id) system.setConfig(entry.handle, style);
    return true;
  }

  function drawGround(ctx) { system.drawGround(ctx); }
  function drawAura(ctx) { system.drawAura(ctx); }
  function drawIndicator(ctx, x, y, renderAt, { color = '#d4bf85', radius = tileSize * .6, rotationSpeed = .18 } = {}) {
    const key = color + ':' + radius;
    let config = indicatorConfigs.get(key);
    if (!config) {
      config = normalize({ ringRadius: radius, ringThickness: 1, ringCount: 2, ringSegments: 8,
        ringOpacity: .8, flatten: .53, ringPulse: .03,
        colors: { main: color, highlight: mix(color, .35), shadow: mix(color, -.4) } });
      indicatorConfigs.set(key, config);
    }
    const seconds = renderAt / 1000;
    drawEllipseRing(ctx, config, x, y, radius, seconds * rotationSpeed * Math.PI * 2, seconds, 0);
    drawEllipseRing(ctx, config, x, y, radius * .8, -seconds * rotationSpeed * Math.PI * 2, seconds, 1);
  }
  return { sync, prepare, drawGround, drawAura, drawIndicator, setSpellStyle,
    stats: () => ({ effects: entries.size, particles: particleCount, maxParticles, maxEffects }),
    // Read-only diagnostic access for deterministic render tests.
    instances: () => [...system.effects.values()] };
}
