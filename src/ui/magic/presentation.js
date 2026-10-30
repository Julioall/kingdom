import { DebuffSystem, normalize, drawEllipseRing } from './particle-runtime.js';
import presets from './presets.json' with { type: 'json' };
import { SPELLS } from '../../simulation/magic/catalog.js';
import { SPELL_VISUAL_STYLES } from './spell-styles.js';

const presetKinds = { weakness: 'weaken', 'blessed-weapons': 'focus', exhaustion: 'curse', protection: 'slow' };
const spellColors = { heal: '#00ff48', 'area-heal': '#00ffb4', 'greater-heal': '#50ff00',
  regeneration: '#00ff66', fortitude: '#ffb800', haste: '#00c4ff', 'blessed-weapons': '#ffdc00',
  protection: '#008cff', weakness: '#9400ff', slow: '#163eff', exhaustion: '#aa28ff',
  curse: '#ff00c8', poison: '#99ed00', purify: '#fff23c', dispel: '#b224ff', sanctuary: '#ffc400' };
const mix = (hex, amount) => '#' + hex.slice(1).match(/../g).map(part => {
  const value = parseInt(part, 16);
  return Math.round(value + (amount > 0 ? 255 - value : value) * amount).toString(16).padStart(2, '0');
}).join('');

export function createMagicPresentation({ tileSize, maxParticles = 2700, maxEffects = 360 } = {}) {
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
        const profile = SPELL_VISUAL_STYLES[data.spellId] || SPELL_VISUAL_STYLES.heal;
        const color = style.color || spellColors[data.spellId] || data.color || spell?.color || '#57ef87';
        const handle = system.apply(key, { ...preset, kind, duration: Infinity,
          ...profile, ringRadius: data.radius * tileSize, ringCount: data.circle ? profile.ringCount : 1,
          ringThickness: .375, magicPattern: data.circle,
          ringOpacity: data.circle ? .95 : 0,
          flatten: .53, rotationSpeed: profile.rotationSpeed, ringPulse: .04,
          groundCount: data.circle ? 27 : 12, auraCount: data.circle ? 21 : 14,
          particleSize: 1, auraHeight: tileSize * (data.circle ? 1.1 : 1.5),
          particleSpeed: data.particleSpeed ?? 1.2, particleOpacity: .9, particleGlow: 0,
          particleMotion: 'rise', emissionStyle: 'flame', flameTurbulence: 1.1, unifyParticles: false,
          colors: { main: color, highlight: mix(color, .4), shadow: mix(color, -.65) },
          ...style, particleGlow: 0 });
        entry = { handle, ...data }; entries.set(key, entry);
      }
      Object.assign(entry, data); entry.retiringAt = null;
    }
    for (const person of world.people) {
      if (!person.alive) continue;
      const cast = person.magicCast;
      if (cast) keep('cast:' + person.id + ':' + cast.startedAt, { spellId: cast.spellId,
        targetId: SPELLS[cast.spellId].radius ? null : cast.targetId,
        x: cast.x, y: cast.y, radius: SPELLS[cast.spellId].radius || .6,
        circle: true, casterId: person.id, startedAt: cast.startedAt, completesAt: cast.completesAt });
      // Limit concurrent aura layers per unit; each active status retains its own logic.
      for (const effect of (person.magicEffects || []).slice(0, 3)) {
        if (effect.expiresAt != null && effect.expiresAt <= (world.magicTimeMs || 0)) continue;
        keep('effect:' + person.id + ':' + effect.id, { spellId: effect.spellId, personId: person.id,
          color: effect.color, radius: .5, circle: false });
      }
    }
    for (const zone of world.magicZones || []) {
      if (zone.expiresAt != null && zone.expiresAt <= (world.magicTimeMs || 0)) continue;
      keep('zone:' + zone.id, { spellId: zone.spellId,
        x: zone.x, y: zone.y, radius: zone.radius, circle: false, particleSpeed: .6 });
    }
    for (const event of world.magicEvents || []) {
      if (event.kind !== 'activated' || (world.magicTimeMs || 0) - event.at > 1100) continue;
      if ((world.magicTimeMs || 0) - event.at < 650) keep('burst:' + event.id,
        { spellId: event.spellId, x: event.x, y: event.y,
          radius: SPELLS[event.spellId]?.radius || .65, circle: true, activatedAt: event.at });
      if (SPELLS[event.spellId]?.radius) continue;
      for (const id of event.targetIds || []) keep('pulse:' + event.id + ':' + id,
        { spellId: event.spellId, personId: id, radius: .65, circle: false });
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
      config.ringOpacity = (entry.circle ? style.ringOpacity ?? .95 : 0) * fade;
      config.particleOpacity = (style.particleOpacity ?? .9) * fade;
      const casting = Number.isFinite(entry.completesAt);
      const progress = casting ? Math.max(0, Math.min(1,
        ((world.magicTimeMs || 0) - entry.startedAt) / Math.max(1, entry.completesAt - entry.startedAt))) : 1;
      const beat = .5 + .5 * Math.sin(renderAt / 1000 * (6 + progress * 12));
      config.castProgress = progress;
      config.ringPulse = 0;
      config.lightIntensity = entry.circle ? (casting ? .08 + progress * progress * (.65 + beat * .55) : .25) * fade : 0;
      config.ringVisualScale = casting ? 1 + beat * (.008 + .024 * progress) : 1;
      if (casting) config.ringOpacity *= .5 + .5 * progress;
      if (casting && entry.retiringAt != null) config.ringOpacity = 0;
      entry.flash = entry.activatedAt == null ? 0 : Math.max(0, 1 - ((world.magicTimeMs || 0) - entry.activatedAt) / 650);
      if (entry.activatedAt != null) {
        config.lightIntensity = entry.flash * 2.4 * fade;
        config.ringVisualScale = 1 + (1 - entry.flash) * .4;
        config.ringOpacity *= entry.flash;
      }
      visibleEntries.push(entry);
    }
    // Share the budget across visible effects instead of starving the last units.
    const perEffect = Math.floor(maxParticles / Math.max(1, visibleEntries.length));
    for (const entry of visibleEntries) {
      const config = system.effects.get(entry.handle).config;
      const style = styles.get(entry.spellId) || {};
      const wanted = Math.min(60, Math.max(0, style.particleCount ?? (entry.circle ? 48 : 26)));
      const granted = Math.min(wanted, perEffect);
      config.groundCount = Math.min(entry.circle ? 27 : 12, granted);
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
    for (const [key, low, high] of [['rotationSpeed', -1, 1], ['particleSpeed', 0, 5], ['particleCount', 0, 60],
      ['particleOpacity', 0, 1], ['ringOpacity', 0, 1]]) {
      if (Number.isFinite(options[key])) style[key] = Math.max(low, Math.min(high, options[key]));
    }
    styles.set(id, style);
    for (const entry of entries.values()) if (entry.spellId === id) system.setConfig(entry.handle, style);
    return true;
  }

  function drawGround(ctx) {
    system.drawGround(ctx);
    if (!ctx.ellipse) return;
    for (const entry of visibleEntries) {
      if (!(entry.flash > 0)) continue;
      const config = system.effects.get(entry.handle).config;
      const radius = config.ringRadius * config.ringVisualScale;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha *= entry.flash * entry.flash * .65;
      ctx.fillStyle = config.colors.main;
      ctx.beginPath(); ctx.ellipse(config.position.x, config.position.y, radius, radius * .53, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha *= .75; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(config.position.x, config.position.y, radius * .65, radius * .34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function drawAura(ctx) { system.drawAura(ctx); }
  function drawIndicator(ctx, x, y, renderAt, { color = '#51e6ff', radius = tileSize * .6, rotationSpeed = .18 } = {}) {
    const key = color + ':' + radius;
    let config = indicatorConfigs.get(key);
    if (!config) {
      config = normalize({ ringRadius: radius, ringThickness: 1, ringCount: 2, ringSegments: 8,
        ringOpacity: 1, flatten: .53, ringPulse: .02,
        colors: { main: color, highlight: mix(color, .8), shadow: mix(color, -.7) } });
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
