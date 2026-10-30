// Native profiles based on the supplied lab's Arcano, Rúnico, Invocação and
// Debuff presets. Assignments are deliberate per spell, never randomized.
const labStyles = {
  arcane: { ringCount: 3, ringSegments: 8, glyphCount: 12, rotationSpeed: .3, centerSymbol: 'diamond' },
  rune: { ringCount: 4, ringSegments: 12, glyphCount: 16, rotationSpeed: .25, centerSymbol: 'rune' },
  summon: { ringCount: 3, ringSegments: 6, glyphCount: 6, rotationSpeed: .45, centerSymbol: 'triangles' },
  debuff: { ringCount: 3, ringSegments: 10, glyphCount: 10, rotationSpeed: -.35, centerSymbol: 'diamond' }
};
const profile = (circleStyle, overrides = {}) => Object.freeze({ ...labStyles[circleStyle], circleStyle, ...overrides });
export const SPELL_VISUAL_STYLES = Object.freeze({
  heal: profile('arcane', { ringCount: 2, glyphCount: 8, centerSymbol: 'cross', rotationSpeed: .18 }),
  'area-heal': profile('rune', { centerSymbol: 'cross', rotationSpeed: .2 }),
  'greater-heal': profile('summon', { ringCount: 5, glyphCount: 12, rotationSpeed: .22 }),
  regeneration: profile('arcane', { centerSymbol: 'sun', ringSegments: 12, rotationSpeed: .15 }),
  fortitude: profile('rune', { centerSymbol: 'shield', glyphCount: 8, rotationSpeed: .16 }),
  haste: profile('arcane', { ringCount: 2, centerSymbol: 'hourglass', rotationSpeed: .4 }),
  'blessed-weapons': profile('summon', { centerSymbol: 'blade', glyphCount: 8, rotationSpeed: .28 }),
  protection: profile('rune', { centerSymbol: 'shield', ringCount: 5, rotationSpeed: -.18 }),
  weakness: profile('debuff', { centerSymbol: 'rune', glyphCount: 6 }),
  slow: profile('rune', { centerSymbol: 'hourglass', ringSegments: 6, rotationSpeed: -.12 }),
  exhaustion: profile('debuff', { centerSymbol: 'hourglass', ringCount: 2, rotationSpeed: -.2 }),
  curse: profile('debuff', { centerSymbol: 'triangles', ringCount: 4, glyphCount: 12 }),
  poison: profile('debuff', { centerSymbol: 'venom', ringSegments: 6, glyphCount: 6, rotationSpeed: -.25 }),
  purify: profile('arcane', { centerSymbol: 'sun', ringCount: 4, glyphCount: 16, rotationSpeed: -.24 }),
  dispel: profile('rune', { centerSymbol: 'diamond', ringSegments: 8, rotationSpeed: -.4 }),
  sanctuary: profile('summon', { centerSymbol: 'sun', ringCount: 5, glyphCount: 16, rotationSpeed: .12 })
});
