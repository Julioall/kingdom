// JUL-275 — Stateless minimap painting extracted from the game coordinator.
// The caller owns visibility, world revision, camera and render-cache policy.
const KINGDOM_COLORS = Object.freeze({
  blue: '#3974b8', red: '#b74f45', purple: '#8354a7',
  yellow: '#d5b346', black: '#59616b'
});

export function paintMinimap({ map, width, height, W, H, world, cell,
  getKingdom, view, LOGICAL_SIZE }) {
  map.clearRect(0, 0, width, height);
  const tileWidth = width / W, tileHeight = height / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tile = cell(x, y);
      if (!tile) continue;
      if (tile.terrain === 'water') map.fillStyle = '#3995a8';
      else if (tile.kingdomId != null) {
        const kingdom = getKingdom(tile.kingdomId);
        map.fillStyle = KINGDOM_COLORS[kingdom && kingdom.palette] || '#9c8751';
      } else {
        const biomass = Array.isArray(tile.plants)
          ? tile.plants.reduce((sum, amount) => sum + amount, 0) : 0;
        map.fillStyle = biomass > 80 ? '#78934e' : biomass > 25 ? '#879351' : '#958751';
      }
      map.fillRect(x * tileWidth, y * tileHeight, tileWidth + .1, tileHeight + .1);
    }
  }
  for (const structure of world.structures) {
    map.fillStyle = KINGDOM_COLORS[getKingdom(structure.kingdomId)?.palette] || '#d0b36c';
    map.fillRect(structure.x - .6, structure.y - .6, 1.4, 1.4);
  }
  for (const person of world.people) if (person.alive && person.restingStructureId == null) {
    map.fillStyle = KINGDOM_COLORS[getKingdom(person.kingdomId)?.palette] || '#f0e2ae';
    map.fillRect(person.x - .35, person.y - .35, .8, .8);
  }
  for (const animal of world.animals) if (animal.alive) {
    map.fillStyle = '#fff1d0';
    map.fillRect(animal.x - .3, animal.y - .3, .7, .7);
  }
  const scaleX = width / LOGICAL_SIZE, scaleY = height / LOGICAL_SIZE;
  map.strokeStyle = '#fff4ce'; map.lineWidth = 1.25;
  map.strokeRect(view.x * scaleX + .5, view.y * scaleY + .5,
    Math.max(1, view.width * scaleX - 1), Math.max(1, view.height * scaleY - 1));
}
