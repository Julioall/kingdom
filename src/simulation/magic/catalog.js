// Times are simulated combat milliseconds; health values are fractions of max HP.
const spell = (id, name, kind, values) => Object.freeze({ id, name, kind, range: 6,
  radius: 0, maxTargets: 1, castMs: 650, cooldownMs: 5000, durationMs: 0,
  mana: 24, color: '#a5c99c', rotationSpeed: .18, ...values,
  castMs: Math.max(1200, Math.round((values.castMs ?? 650) * 1.8)) });

export const SPELLS = Object.freeze(Object.fromEntries([
  spell('heal', 'Cura Simples', 'heal', { mana: 12, castMs: 350, cooldownMs: 900, heal: .07 }),
  spell('area-heal', 'Cura em Área', 'heal', { mana: 28, castMs: 850, cooldownMs: 3500, radius: 2.8, maxTargets: 8, heal: .06 }),
  spell('greater-heal', 'Grande Cura', 'heal', { mana: 75, castMs: 2200, cooldownMs: 14000,
    radius: 3.8, maxTargets: 10, heal: .08, effect: 'regeneration', intensity: .02, durationMs: 6000 }),
  spell('regeneration', 'Regeneração', 'buff', { mana: 22, castMs: 600, cooldownMs: 4000,
    effect: 'regeneration', intensity: .015, durationMs: 6000 }),
  spell('fortitude', 'Fortitude', 'buff', { effect: 'fortitude', intensity: .2, durationMs: 12000,
    mana: 26, radius: 2, maxTargets: 5, color: '#c4b77e' }),
  spell('haste', 'Velocidade', 'buff', { effect: 'haste', intensity: .15, durationMs: 8000,
    mana: 24, radius: 2, maxTargets: 5, color: '#8ebed0' }),
  spell('blessed-weapons', 'Armas Abençoadas', 'buff', { effect: 'blessed-weapons', intensity: .12,
    durationMs: 10000, mana: 28, radius: 2, maxTargets: 5, color: '#d7c88e' }),
  spell('protection', 'Proteção Mágica', 'buff', { effect: 'protection', intensity: .15,
    durationMs: 8000, mana: 26, radius: 2, maxTargets: 5, color: '#99adbe' }),
  spell('weakness', 'Fraqueza', 'debuff', { effect: 'weakness', intensity: .15,
    durationMs: 10000, mana: 26, radius: 2, maxTargets: 5, color: '#9a83b3' }),
  spell('slow', 'Lentidão', 'debuff', { effect: 'slow', intensity: .2,
    durationMs: 7000, mana: 24, radius: 2, maxTargets: 5, color: '#687da7' }),
  spell('exhaustion', 'Exaustão', 'debuff', { effect: 'exhaustion', intensity: .2,
    durationMs: 10000, mana: 26, radius: 2, maxTargets: 5, color: '#9390a6' }),
  spell('curse', 'Maldição', 'debuff', { effect: 'curse', intensity: .4,
    durationMs: 8000, mana: 30, radius: 2, maxTargets: 5, color: '#ae80a4' }),
  spell('poison', 'Veneno', 'debuff', { effect: 'poison', intensity: .008,
    durationMs: 6000, mana: 26, radius: 1.8, maxTargets: 4, color: '#90a26d' }),
  spell('purify', 'Purificação', 'cleanse', { mana: 22, castMs: 450, cooldownMs: 3500,
    radius: 2.5, maxTargets: 6, color: '#e3d9b0' }),
  spell('dispel', 'Dissipação', 'dispel', { mana: 26, castMs: 700, cooldownMs: 4500,
    radius: 2.5, maxTargets: 6, color: '#ac97c5' }),
  spell('sanctuary', 'Santuário', 'area', { mana: 45, castMs: 1500, cooldownMs: 12000,
    radius: 3, maxTargets: 100, durationMs: 8000, intensity: .1, color: '#d9cd9a' })
].map(item => [item.id, item])));

export const MAGIC_ROLES = Object.freeze({
  healer: ['heal', 'area-heal', 'greater-heal', 'regeneration', 'purify'],
  protector: ['heal', 'fortitude', 'protection', 'blessed-weapons', 'sanctuary'],
  disruptor: ['heal', 'slow', 'exhaustion', 'curse', 'dispel']
});
export const MAGIC_TACTICS = Object.freeze({
  balanced: { label: 'Apoio contextual', preferredSpells: [] },
  recovery: { label: 'Recuperar e purificar', preferredSpells: ['heal', 'area-heal', 'greater-heal', 'regeneration', 'purify'] },
  protection: { label: 'Proteger a formação', preferredSpells: ['fortitude', 'protection', 'sanctuary'] },
  offense: { label: 'Preparar ofensiva', preferredSpells: ['blessed-weapons', 'haste', 'weakness', 'dispel'] },
  disruption: { label: 'Enfraquecer inimigos', preferredSpells: ['curse', 'exhaustion', 'slow', 'poison'] },
  hold: { label: 'Poupar magias', preferredSpells: [], holdFire: true }
});

export function availableSpells(person) {
  return (person.availableMagicSpells || Object.keys(SPELLS)).filter(id => SPELLS[id]);
}
export function equippedSpells(person) {
  const role = person.magicRole || ['healer', 'protector', 'disruptor'][Math.abs(person.id || 0) % 3];
  const available = availableSpells(person);
  return (person.magicSpells || MAGIC_ROLES[role] || MAGIC_ROLES.healer)
    .filter(id => available.includes(id)).slice(0, 5);
}
