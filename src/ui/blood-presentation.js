// Native pixel adaptation of the user's Canvas Blood Splatter reference:
// directional droplets, red shade variation, gravity and a short ground residue.
// Geometry is generated once per confirmed hit, without touching simulation RNG.
export const BLOOD_EFFECT_DURATION_MS = 10500;
export function createBloodParticles(seed, angle, damage) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const count = Math.min(20, 8 + Math.ceil(Math.sqrt(Math.max(0, damage)) * 1.5));
  const colors = ['#790e20', '#a8172a', '#c82436', '#e34449'];
  return Array.from({ length: count }, () => {
    const direction = angle + (random() - .5) * (random() < .75 ? 2.2 : Math.PI * 2);
    const speed = .8 + Math.pow(random(), 1.5) * 4.5;
    const dx = Math.cos(direction), dy = Math.sin(direction);
    const particle = { vx: dx * speed, vy: dy * speed, dx, dy,
      flightMs: 180 + random() * 320, delayMs: random() * 45,
      size: .015 + random() * .025, drag: .8 + random() * 2.4,
      offsetX: (random() - .5) * .22, offsetY: (random() - .5) * .18,
      curl: (random() - .5) * .65, height: .18 + random() * .2, arc: .2 + random() * .35,
      stainWidth: .8 + random() * 1.4, stainDepth: .4 + random() * .6,
      color: colors[Math.floor(random() * colors.length)] };
    const travel = -Math.expm1(-particle.drag * particle.flightMs / 1000) / particle.drag;
    particle.landX = particle.offsetX + particle.vx * travel - dy * particle.curl;
    particle.landY = particle.offsetY + particle.vy * travel + dx * particle.curl;
    return particle;
  });
}

export function drawBloodBurst(ctx, effect, elapsedMs, tileSize) {
  if (elapsedMs < 0 || elapsedMs >= 600 || elapsedMs >= effect.duration) return;
  const originX = (effect.x + .5) * tileSize, originY = (effect.y + 1) * tileSize;
  const opacity = ctx.globalAlpha;
  for (const particle of effect.particles) {
    const age = elapsedMs - particle.delayMs;
    if (age < 0 || age >= particle.flightMs) continue;
    const progress = age / particle.flightMs;
    const travel = -Math.expm1(-particle.drag * age / 1000) / particle.drag;
    const bend = particle.curl * progress * progress;
    const x = originX + (particle.offsetX + particle.vx * travel - particle.dy * bend) * tileSize;
    const groundY = originY + (particle.offsetY + particle.vy * travel + particle.dx * bend) * tileSize;
    const lift = tileSize * (particle.height * (1 - progress) + particle.arc * Math.sin(Math.PI * progress));
    const size = Math.max(1 / 32, particle.size * tileSize * (1 - progress * .25));
    ctx.globalAlpha = opacity * .95;
    ctx.fillStyle = particle.color;
    ctx.fillRect(Math.round(x * 32) / 32, Math.round((groundY - lift) * 32) / 32, size, size);
  }
  ctx.globalAlpha = opacity;
}

export function drawBloodStains(ctx, effect, elapsedMs, tileSize) {
  if (elapsedMs < 0 || elapsedMs >= effect.duration) return;
  const fade = Math.min(1, (effect.duration - elapsedMs) / 1200);
  const originX = (effect.x + .5) * tileSize, originY = (effect.y + 1) * tileSize;
  const opacity = ctx.globalAlpha;
  for (const particle of effect.particles) {
    if (elapsedMs < particle.delayMs + particle.flightMs) continue;
    const x = Math.round((originX + particle.landX * tileSize) * 32) / 32;
    const y = Math.round((originY + particle.landY * tileSize) * 32) / 32;
    const size = Math.max(.09, particle.size * tileSize);
    ctx.globalAlpha = opacity * .7 * fade;
    ctx.fillStyle = '#691626';
    ctx.fillRect(x - size * .5, y, size * particle.stainWidth, size * particle.stainDepth);
    ctx.fillStyle = particle.color; ctx.globalAlpha = opacity * .5 * fade;
    ctx.fillRect(x, y - size * .25, size * .7, size * particle.stainDepth);
  }
  ctx.globalAlpha = opacity;
}
