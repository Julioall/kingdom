(function() {
  'use strict';
  const Sim = window.GenesisSim;
  const $ = id => document.getElementById(id);
  const canvas = $('world');
  let ctx = canvas.getContext('2d');
  const groundCacheCanvas = document.createElement('canvas');
  groundCacheCanvas.width = canvas.width; groundCacheCanvas.height = canvas.height;
  const groundCacheContext = groundCacheCanvas.getContext('2d');
  const W = Sim.width, H = Sim.height, TILE = canvas.width / W, stage = canvas.parentElement;
  const seasonNames = Sim.seasons;
  let world = Sim.createWorld(42), paused = false, speed = 1, accumulator = 0;
  let layer = 'ecosystem', selection = null, showLeft = true, showRight = true;
  const localAI = window.GenesisLocalAI ? window.GenesisLocalAI.create({ Sim, getWorld: () => world, onStatus: updateLocalAIStatus }) : null;
  if (localAI) updateLocalAIStatus(localAI.getStatus());
  let visualPack = 'tiny-swords';
  const MIN_MAP_ZOOM = 1, MAX_MAP_ZOOM = 4;
  let mapZoom = 1, mapPanX = 0, mapPanY = 0;
  let lastFrame = 0, animationTime = 0, lastSpriteDraw = 0, assetRenderQueued = false, groundCacheKey = '';
  const visualMotions = new Map();
  const treeSprites = Object.create(null);
  const tinyTreeSprites = Object.create(null);
  const tinyBushSprites = [];
  const tinyStumpSprites = Object.create(null);
  const tinySheepSprites = Object.create(null);
  const tinyPersonSprites = Object.create(null);
  const tinyBuildingSprites = Object.create(null);
  const tinyTerrainAtlases = [];
  for (let color = 1; color <= 5; color++) {
    const image = new Image();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/terrain/Tilemap_color' + color + '.png';
    tinyTerrainAtlases.push(image);
  }
  const tinyWaterTile = new Image();
  tinyWaterTile.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyWaterTile.src = 'assets/tiny-swords/terrain/water-background.png';
  const tinyWaterFoam = new Image();
  tinyWaterFoam.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyWaterFoam.src = 'assets/tiny-swords/terrain/water-foam.png';
  const tinyFenceTilemap = new Image();
  tinyFenceTilemap.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyFenceTilemap.src = 'assets/tiny-swords/fences/tileset-fences-1.png';
  const tinyMeatSprite = new Image();
  tinyMeatSprite.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyMeatSprite.src = 'assets/tiny-swords/meat-resource.png';
  const tinyElevationShadow = new Image();
  tinyElevationShadow.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
  tinyElevationShadow.src = 'assets/tiny-swords/terrain/shadow.png';
  function queueAssetRender() {
    if (assetRenderQueued) return;
    assetRenderQueued = true;
    window.requestAnimationFrame(() => { assetRenderQueued = false; groundCacheKey = ''; render(); });
  }
  function visualPose(kind, agent) {
    const key = kind + ':' + agent.id;
    let motion = visualMotions.get(key);
    if (!motion) {
      motion = { fromX: agent.x, fromY: agent.y, toX: agent.x, toY: agent.y, start: animationTime, duration: 1 };
      visualMotions.set(key, motion);
    }
    const progress = Math.max(0, Math.min(1, (animationTime - motion.start) / motion.duration));
    const eased = progress * progress * (3 - 2 * progress);
    const x = motion.fromX + (motion.toX - motion.fromX) * eased;
    const y = motion.fromY + (motion.toY - motion.fromY) * eased;
    if (Math.abs(agent.x - motion.toX) > .001 || Math.abs(agent.y - motion.toY) > .001) {
      motion.fromX = x; motion.fromY = y;
      motion.toX = agent.x; motion.toY = agent.y;
      motion.start = animationTime;
      motion.duration = Math.max(180, Math.min(720, 680 / Math.max(.5, speed)));
    }
    const activeProgress = Math.max(0, Math.min(1, (animationTime - motion.start) / motion.duration));
    const activeEase = activeProgress * activeProgress * (3 - 2 * activeProgress);
    return {
      x: motion.fromX + (motion.toX - motion.fromX) * activeEase,
      y: motion.fromY + (motion.toY - motion.fromY) * activeEase,
      moving: activeProgress < 1,
      dirX: motion.toX - motion.fromX
    };
  }
  function clampMapPan() {
    const maxX = Math.abs(canvas.offsetWidth * mapZoom - stage.clientWidth) / 2;
    const maxY = Math.abs(canvas.offsetHeight * mapZoom - stage.clientHeight) / 2;
    mapPanX = Math.max(-maxX, Math.min(maxX, mapPanX));
    mapPanY = Math.max(-maxY, Math.min(maxY, mapPanY));
  }
  function updateMapViewport() {
    clampMapPan();
    canvas.style.setProperty('--map-zoom', mapZoom.toFixed(4));
    canvas.style.setProperty('--map-pan-x', mapPanX.toFixed(2) + 'px');
    canvas.style.setProperty('--map-pan-y', mapPanY.toFixed(2) + 'px');
    $('mapZoomLevel').textContent = Math.round(mapZoom * 100) + '%';
    $('mapZoomOut').disabled = mapZoom <= MIN_MAP_ZOOM + .001;
    $('mapZoomIn').disabled = mapZoom >= MAX_MAP_ZOOM - .001;
    $('mapZoomReset').disabled = mapZoom <= MIN_MAP_ZOOM + .001 && Math.abs(mapPanX) < 1 && Math.abs(mapPanY) < 1;
    $('cameraPosition').textContent = mapZoom > MIN_MAP_ZOOM + .001 ? 'ZOOM ' + Math.round(mapZoom * 100) + '%' : 'MAPA INTEIRO';
    canvas.style.cursor = mapZoom > MIN_MAP_ZOOM + .001 ? 'grab' : 'crosshair';
  }
  function zoomMapTo(nextZoom, clientX, clientY) {
    const bounds = stage.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
    const focusX = Number.isFinite(clientX) ? clientX : centerX;
    const focusY = Number.isFinite(clientY) ? clientY : centerY;
    const mapX = (focusX - centerX - mapPanX) / mapZoom;
    const mapY = (focusY - centerY - mapPanY) / mapZoom;
    mapZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, nextZoom));
    mapPanX = focusX - centerX - mapX * mapZoom;
    mapPanY = focusY - centerY - mapY * mapZoom;
    updateMapViewport();
  }
  function resetMapViewport() {
    mapZoom = MIN_MAP_ZOOM; mapPanX = 0; mapPanY = 0;
    updateMapViewport();
  }
  window.addEventListener('resize', updateMapViewport);
  for (const species of ['oak', 'birch', 'pine']) {
    const colors = species === 'birch' ? ['green', 'yellow', 'brown'] : species === 'oak' ? ['green', 'brown'] : ['green', 'blue_green'];
    for (const color of colors) for (const stage of ['small', 'medium', 'big']) {
      const key = species + '-' + color + '-' + stage;
      const image = new Image();
      image.onload = () => { if (visualPack === 'modern-farm') queueAssetRender(); };
      image.src = 'assets/modern-farm/trees/' + key + '.png';
      treeSprites[key] = image;
    }
  }
  for (let id = 1; id <= 4; id++) {
    const image = new Image();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/trees/tree-' + id + '.png';
    tinyTreeSprites[id] = image;
    const bush = new Image();
    bush.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    bush.src = 'assets/tiny-swords/bushes/bush-' + id + '.png';
    tinyBushSprites[id] = bush;
  }
  for (let id = 1; id <= 4; id++) {
    const image = new Image();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/stumps/stump-' + id + '.png';
    tinyStumpSprites[id] = image;
  }
  for (const [action, file] of Object.entries({ idle: 'sheep_idle.png', move: 'sheep_move.png', grass: 'sheep_grass.png' })) {
    const image = new Image();
    image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
    image.src = 'assets/tiny-swords/sheep/' + file;
    tinySheepSprites[action] = image;
  }
  const tinyPalettes = ['blue', 'red', 'purple', 'yellow', 'black'];
  const tinyPersonActions = ['idle', 'run', 'interact-axe', 'interact-hammer', 'interact-knife'];
  const tinyPersonFiles = {
    idle: 'pawn_idle.png', run: 'pawn_run.png',
    'interact-axe': 'pawn_interact-axe.png',
    'interact-hammer': 'pawn_interact-hammer.png',
    'interact-knife': 'pawn_interact-knife.png'
  };
  for (const palette of tinyPalettes) {
    tinyPersonSprites[palette] = Object.create(null);
    tinyBuildingSprites[palette] = Object.create(null);
    for (const action of tinyPersonActions) {
      const image = new Image();
      image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
      image.src = 'assets/tiny-swords/people/' + palette + '/' + tinyPersonFiles[action];
      tinyPersonSprites[palette][action] = image;
    }
    for (let level = 1; level <= 3; level++) {
      const image = new Image();
      image.onload = () => { if (visualPack === 'tiny-swords') queueAssetRender(); };
      image.src = 'assets/tiny-swords/buildings/' + palette + '/house' + level + '.png';
      tinyBuildingSprites[palette]['house' + level] = image;
    }
  }

  function fmt(n, digits) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits || 0 }); }
  function qualityLabel(score) { return score >= .62 ? 'boa' : score >= .28 ? 'moderada' : 'ruim'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, alpha) { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')'; }
  function mix(a, b, amount) { return a.map((v, i) => Math.round(v + (b[i] - v) * amount)); }
  function terrainLight(t) {
    const left = cell(t.x - 1, t.y) || t, right = cell(t.x + 1, t.y) || t;
    const up = cell(t.x, t.y - 1) || t, down = cell(t.x, t.y + 1) || t;
    const gx = (right.heightM - left.heightM) / 32, gy = (down.heightM - up.heightM) / 32;
    const nx = -gx, ny = -gy, nz = 1, length = Math.hypot(nx, ny, nz);
    const season = Math.floor((world.day % 365) / 365 * 4);
    const sunAngle = [-.72, -.58, -.42, -.68][season];
    const sunX = Math.cos(sunAngle) * .48, sunY = Math.sin(sunAngle) * .48, sunZ = .74;
    const incidence = Math.max(0, (nx * sunX + ny * sunY + nz * sunZ) / length);
    const altitude = Math.min(.12, t.heightM / 8000);
    return Math.max(.58, Math.min(1.14, .64 + incidence * .43 + altitude));
  }
  function lit(color, amount) { return color.map(c => Math.max(0, Math.min(255, Math.round(c * amount)))); }
  function hashColor(x, y, salt) { return ((x * 92821 + y * 68917 + salt * 283) >>> 0) % 11; }
  function cell(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? null : world.tiles[y * W + x]; }
  function plantIndex(id) { return Sim.plants.findIndex(p => p.id === id); }
  function getCommunity(id) { return world.communities.find(c => c.id === id && !c.dissolved); }
  function getPerson(id) { return world.people.find(p => p.id === id && p.alive); }
  function getAnimal(id) { return world.animals.find(a => a.id === id && a.alive); }

  function treeMass(tile, broad, conifer) { return Math.max(tile.plants[broad] || 0, tile.plants[conifer] || 0); }

  function isTreeAssetAnchor(tile, broad, conifer) {
    const mass = treeMass(tile, broad, conifer);
    if (mass < 150) return false;
    const tie = hashColor(tile.x, tile.y, world.seed + 431);
    const index = tile.y * W + tile.x;
    // Larger tree crowns need wider spacing so the original silhouettes remain readable.
    const spacing = 4;
    for (let dy = -spacing; dy <= spacing; dy++) for (let dx = -spacing; dx <= spacing; dx++) {
      if (!dx && !dy) continue;
      const neighbor = cell(tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain === 'water') continue;
      const neighborMass = treeMass(neighbor, broad, conifer);
      const neighborTie = hashColor(neighbor.x, neighbor.y, world.seed + 431);
      const neighborIndex = neighbor.y * W + neighbor.x;
      if (neighborMass > mass || (neighborMass === mass && (neighborTie > tie || (neighborTie === tie && neighborIndex < index)))) return false;
    }
    return true;
  }

  function treeAssetKey(tile, type, mass) {
    const stage = mass > 760 ? 'big' : mass > 420 ? 'medium' : 'small';
    const variation = hashColor(tile.x, tile.y, world.seed + 773);
    if (type === 'conifer') return 'pine-' + (variation % 2 ? 'green' : 'blue_green') + '-' + stage;
    const species = variation % 2 ? 'oak' : 'birch';
    const season = Math.floor((world.day % 365) / 365 * 4);
    const color = season < 2 ? 'green' : season === 2 ? (species === 'oak' ? 'brown' : 'yellow') : 'brown';
    return species + '-' + color + '-' + stage;
  }

  function drawTreeAsset(tile, type, mass) {
    const key = treeAssetKey(tile, type, mass);
    const species = key.split('-')[0];
    const stage = key.split('-').pop();
    const fallbackColor = species === 'pine' || species === 'oak' || species === 'birch' ? 'green' : 'green';
    const image = treeSprites[key] || treeSprites[species + '-' + fallbackColor + '-' + stage];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const width = image.naturalWidth / 1.4, height = image.naturalHeight / 1.4;
    const x = tile.x * TILE + (TILE - width) / 2, y = tile.y * TILE + TILE - height;
    ctx.fillStyle = 'rgba(20,35,26,.29)';
    ctx.beginPath(); ctx.ellipse(tile.x * TILE + TILE / 2, tile.y * TILE + TILE - 2, Math.max(4, width * .22), 2.5, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(image, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    return true;
  }

  function communityPalette(id) { return tinyPalettes[Math.abs(Math.trunc(id || 0)) % tinyPalettes.length]; }

  function drawTinySwordsTree(tile, type, mass) {
    const variation = hashColor(tile.x, tile.y, world.seed + 991);
    const season = Math.floor((world.day % 365) / 365 * 4);
    const treeId = type === 'conifer' ? 1 + variation % 2 : season < 2 ? 3 : 4;
    const image = tinyTreeSprites[treeId];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const frameWidth = 192, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const frame = ((Math.floor(animationTime / 100) + variation) % frameCount + frameCount) % frameCount;
    const size = mass > 760 ? 1 : mass > 420 ? .84 : .68;
    // Mature trees render at the Tiny Swords source pixel scale; smaller stages scale down.
    const scale = TILE / 16 * size;
    const width = frameWidth * scale, height = image.naturalHeight * scale;
    const baseY = ({ 1: 241, 2: 249, 3: 170, 4: 168 })[treeId];
    const x = tile.x * TILE + TILE / 2 - width / 2;
    const groundY = tile.y * TILE + TILE - 2;
    const y = groundY - baseY * scale;
    ctx.fillStyle = 'rgba(20,35,26,.29)';
    ctx.beginPath(); ctx.ellipse(tile.x * TILE + TILE / 2, groundY, Math.max(4, width * .22), 2.5, -.12, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(image, frame * frameWidth, 0, frameWidth, image.naturalHeight, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    return true;
  }

  function isBushAssetAnchor(tile, plantId) {
    const plant = plantIndex(plantId), mass = tile.plants[plant];
    if (tile.terrain === 'water' || mass < 18) return false;
    const salt = plantId === 'browse' ? 2503 : 1907;
    const tie = hashColor(tile.x, tile.y, world.seed + salt), index = tile.y * W + tile.x;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const neighbor = cell(tile.x + dx, tile.y + dy);
      if (!neighbor || neighbor.terrain === 'water') continue;
      const otherMass = neighbor.plants[plant];
      const otherTie = hashColor(neighbor.x, neighbor.y, world.seed + salt);
      const otherIndex = neighbor.y * W + neighbor.x;
      if (otherMass > mass || (otherMass === mass && (otherTie > tie || (otherTie === tie && otherIndex < index)))) return false;
    }
    return true;
  }

  function drawTinySwordsBush(tile, plantId) {
    const index = plantIndex(plantId), mass = tile.plants[index];
    const variation = hashColor(tile.x, tile.y, world.seed + (plantId === 'browse' ? 2729 : 2011));
    const bushId = 1 + variation % 4, image = tinyBushSprites[bushId];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const frameWidth = 128, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const frame = ((Math.floor(animationTime / 180) + variation) % frameCount + frameCount) % frameCount;
    const size = mass >= 70 ? 1 : .67;
    const scale = TILE / 32 * size, width = frameWidth * scale, height = image.naturalHeight * scale;
    const footY = tile.y * TILE + TILE - 2;
    const x = tile.x * TILE + TILE / 2 - width / 2;
    const y = footY - 79 * scale;
    ctx.fillStyle = 'rgba(20,35,26,.24)';
    ctx.beginPath(); ctx.ellipse(tile.x * TILE + TILE / 2, footY, 5.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(image, frame * frameWidth, 0, frameWidth, image.naturalHeight, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    if (plantId === 'berry' && mass > 38) {
      ctx.fillStyle = '#9e4d52'; ctx.fillRect(tile.x * TILE + 5, footY - 8, 2, 2); ctx.fillRect(tile.x * TILE + 10, footY - 6, 2, 2);
    } else if (plantId === 'browse') {
      ctx.fillStyle = mass >= 70 ? '#a9c26f' : '#829f5a';
      ctx.fillRect(tile.x * TILE + 6, footY - 6, 2, 1); ctx.fillRect(tile.x * TILE + 10, footY - 9, 1, 2);
    }
    return true;
  }

  function drawTinySwordsSheep(animal, x, y, pose) {
    const state = String(animal.state || '').toLowerCase();
    const action = animal.brain.lastAction;
    const sheet = action === 'feed' || state.includes('alimentando') ? 'grass' : pose.moving ? 'move' : 'idle';
    const image = tinySheepSprites[sheet];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const frameWidth = 128, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const frame = ((Math.floor(animationTime / (sheet === 'grass' ? 145 : 180)) + animal.id * 2) % frameCount + frameCount) % frameCount;
    const scale = TILE / 32, width = frameWidth * scale, height = image.naturalHeight * scale;
    const footY = y + TILE - 1, x0 = x + TILE / 2 - width / 2, y0 = footY - 84 * scale;
    ctx.fillStyle = 'rgba(20,35,26,.3)';
    ctx.beginPath(); ctx.ellipse(x + TILE / 2, footY, 6.2, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(image, frame * frameWidth, 0, frameWidth, image.naturalHeight, Math.round(x0), Math.round(y0), Math.round(width), Math.round(height));
    return true;
  }

  function tinyPersonAction(person, pose) {
    const state = String(person.state || '').toLowerCase();
    if (pose.moving) return 'run';
    if ((person.carriedMeat || 0) > .01) return 'idle';
    if (person.brain.lastAction === 'build' || state.includes('construindo')) return 'interact-hammer';
    if (person.brain.lastAction === 'gather' || state.includes('coletando material')) return 'interact-axe';
    if (person.brain.lastAction === 'hunt' || state.includes('caçando')) return 'interact-knife';
    return 'idle';
  }

  function drawTinySwordsPerson(person, x, y, child, pose) {
    const community = person.communityId ? getCommunity(person.communityId) : null;
    const palette = community ? communityPalette(community.id) : 'blue';
    const image = tinyPersonSprites[palette] && tinyPersonSprites[palette][tinyPersonAction(person, pose)];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const frameWidth = 192, frameCount = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const frame = ((Math.floor(animationTime / 100) + person.id * 3) % frameCount + frameCount) % frameCount;
    const scale = TILE / 48 * (child ? .78 : 1);
    const width = frameWidth * scale, height = image.naturalHeight * scale;
    const x0 = x + TILE / 2 - width / 2;
    const y0 = y + TILE - 135 * scale;
    ctx.drawImage(image, frame * frameWidth, 0, frameWidth, image.naturalHeight, Math.round(x0), Math.round(y0), Math.round(width), Math.round(height));
    return true;
  }

  function drawCarriedMeat(person, x, y, pose) {
    if ((person.carriedMeat || 0) <= .01 || !tinyMeatSprite.complete || !tinyMeatSprite.naturalWidth) return;
    const size = 18;
    const side = pose.dirX < 0 ? -1 : 1;
    const px = x + TILE / 2 + (side < 0 ? -size - 2 : 4);
    const py = y + TILE / 2 - size / 2 + 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tinyMeatSprite, Math.round(px), Math.round(py), size, size);
    ctx.restore();
  }

  function drawCarriedWood(person, x, y, pose) {
    if ((person.carriedWood || 0) + (person.carriedStone || 0) + (person.carriedFeed || 0) <= .01) return;
    const side = pose.dirX < 0 ? -1 : 1, px = x + TILE / 2 + (side < 0 ? -9 : 3), py = y + TILE / 2 - 2;
    ctx.fillStyle = '#61432c'; ctx.fillRect(px, py, 7, 3);
    ctx.fillStyle = '#bc8c57'; ctx.fillRect(px + 1, py - 1, 5, 2);
    ctx.fillStyle = '#e0bd84'; ctx.fillRect(px, py, 1, 2); ctx.fillRect(px + 6, py, 1, 2);
  }

  function drawTinySwordsBuilding(structure, community, x, y) {
    const house = structure.type === 'abrigo' ? 'house1' : structure.type === 'posto de coleta' ? 'house2' : 'house3';
    const palette = community ? communityPalette(community.id) : 'blue';
    const image = tinyBuildingSprites[palette] && tinyBuildingSprites[palette][house];
    if (!image || !image.complete || !image.naturalWidth) return false;
    const scale = TILE / 64, width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x0 = x + TILE / 2 - width / 2;
    const y0 = y + TILE - image.naturalHeight * .9 * scale;
    ctx.drawImage(image, Math.round(x0), Math.round(y0), Math.round(width), Math.round(height));
    return true;
  }

  function tinyTerrainPalette(t) {
    return Math.max(0, Math.min(4, Math.floor(t.heightM / 320)));
  }

  function tinyShoreTile(t, elevated) {
    const north = cell(t.x, t.y - 1), south = cell(t.x, t.y + 1);
    const west = cell(t.x - 1, t.y), east = cell(t.x + 1, t.y);
    const exposed = neighbor => neighbor && (neighbor.terrain === 'water' || (elevated && t.heightM - neighbor.heightM > 105));
    const n = exposed(north), s = exposed(south), w = exposed(west), e = exposed(east);
    if (n && s && !w && !e) return { col: elevated ? 8 : 3, row: 1, rotate: Math.PI / 2 };
    if (w && e && !n && !s) return { col: elevated ? 8 : 3, row: 1, rotate: 0 };
    let col = w ? 0 : e ? 2 : 1, row = n ? 0 : s ? 2 : 1;
    if (n && w) { col = 0; row = 0; }
    else if (n && e) { col = 2; row = 0; }
    else if (s && w) { col = 0; row = 2; }
    else if (s && e) { col = 2; row = 2; }
    return { col: col + (elevated ? 5 : 0), row, rotate: 0 };
  }

  function drawTinyAtlasTile(image, col, row, x, y) {
    if (!image || !image.complete || !image.naturalWidth) return false;
    ctx.drawImage(image, col * 64, row * 64, 64, 64, x, y, TILE, TILE);
    return true;
  }

  function drawTinyCliffFaces() {
    const directions = [
      { dx: 0, dy: 1, angle: 0 }, { dx: 0, dy: -1, angle: Math.PI },
      { dx: 1, dy: 0, angle: Math.PI / 2 }, { dx: -1, dy: 0, angle: -Math.PI / 2 }
    ];
    for (const t of world.tiles) {
      if (t.terrain === 'water') continue;
      let face = null;
      for (const d of directions) {
        const lower = cell(t.x + d.dx, t.y + d.dy);
        const drop = lower ? t.heightM - lower.heightM : 0;
        if (!lower || drop < 245 || t.heightM < 700 || t.slope < .4) continue;
        if (!face || drop > face.drop) face = { ...d, lower, drop };
      }
      if (!face) continue;
      const atlas = tinyTerrainAtlases[tinyTerrainPalette(t)];
      if (!atlas || !atlas.complete || !atlas.naturalWidth) continue;
      const x = face.lower.x * TILE + TILE / 2, y = face.lower.y * TILE + TILE / 2;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(face.angle);
      ctx.beginPath(); ctx.rect(-TILE / 2, -TILE / 2, TILE, TILE / 2); ctx.clip();
      ctx.globalAlpha = Math.min(.78, .48 + face.drop / 1000);
      ctx.drawImage(atlas, 6 * 64, 4 * 64, 64, 64, -TILE / 2, -TILE / 2, TILE, TILE);
      ctx.restore();
    }
  }

  function drawTinyElevationShadows() {
    if (!tinyElevationShadow.complete || !tinyElevationShadow.naturalWidth) return;
    for (const t of world.tiles) {
      if (t.terrain === 'water' || t.heightM < 640) continue;
      const south = cell(t.x, t.y + 1);
      if (!south || south.terrain === 'water' || t.heightM - south.heightM < 105) continue;
      ctx.globalAlpha = .24;
      // The atlas places its opaque center one tile below the image origin.
      ctx.drawImage(tinyElevationShadow, (t.x - 1) * TILE, t.y * TILE, TILE * 3, TILE * 3);
      ctx.globalAlpha = 1;
    }
  }

  function drawTinyWaterFoam() {
    if (!tinyWaterFoam.complete || !tinyWaterFoam.naturalWidth) return;
    const frameCount = Math.max(1, Math.floor(tinyWaterFoam.naturalWidth / 192));
    for (const t of world.waterTiles) {
      const touchesLand = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => {
        const neighbor = cell(t.x + dx, t.y + dy);
        return neighbor && neighbor.terrain !== 'water';
      });
      if (!touchesLand || (t.x * 3 + t.y * 5 + world.seed) % 3 !== 0) continue;
      const phase = ((Math.floor(animationTime / 100) + hashColor(t.x, t.y, world.seed)) % frameCount + frameCount) % frameCount;
      ctx.globalAlpha = .18;
      ctx.drawImage(tinyWaterFoam, phase * 192, 0, 192, 192,
        t.x * TILE - TILE, t.y * TILE - TILE, TILE * 3, TILE * 3);
      ctx.globalAlpha = 1;
    }
  }

  function drawTinySwordsGround() {
    const baseAtlas = tinyTerrainAtlases[0];
    if (!baseAtlas || !baseAtlas.complete || !baseAtlas.naturalWidth) return false;
    for (const t of world.tiles) {
      const x = t.x * TILE, y = t.y * TILE, variation = hashColor(t.x, t.y, world.seed);
      if (t.terrain === 'water') {
        if (tinyWaterTile.complete && tinyWaterTile.naturalWidth) ctx.drawImage(tinyWaterTile, x, y, TILE, TILE);
        else { ctx.fillStyle = '#31566c'; ctx.fillRect(x, y, TILE, TILE); }
        if ((variation + world.day) % 7 === 0) {
          ctx.fillStyle = 'rgba(204,235,215,.28)';
          ctx.fillRect(x + 2 + variation % 7, y + (world.day + t.x) % 13, 5, 1);
        }
      } else {
        const elevated = t.heightM >= 640 || t.terrain === 'rock';
        if (t.terrain === 'rock') {
          const stone = lit([104 + variation * 2, 110 + variation * 2, 105 + variation * 2], terrainLight(t));
          ctx.fillStyle = 'rgb(' + stone.join(',') + ')'; ctx.fillRect(x, y, TILE, TILE);
          if (variation % 3 === 0) { ctx.fillStyle = 'rgba(210,207,184,.56)'; ctx.fillRect(x + 2 + variation % 5, y + 3 + variation % 4, 4, 2); }
          if (variation % 4 === 0) { ctx.fillStyle = 'rgba(46,55,55,.46)'; ctx.fillRect(x + 8, y + 9 + variation % 4, 5, 2); }
        } else {
          const tile = tinyShoreTile(t, elevated);
          const atlas = tinyTerrainAtlases[tinyTerrainPalette(t)];
          const terrainAtlas = atlas && atlas.complete && atlas.naturalWidth ? atlas : baseAtlas;
          if (tile.rotate) {
            ctx.save(); ctx.translate(x + TILE / 2, y + TILE / 2); ctx.rotate(tile.rotate);
            drawTinyAtlasTile(terrainAtlas, tile.col, tile.row, -TILE / 2, -TILE / 2); ctx.restore();
          } else drawTinyAtlasTile(terrainAtlas, tile.col, tile.row, x, y);
        }
      }
      applyLayerTint(t, x, y);
    }
    drawTinyElevationShadows();
    drawTinyCliffFaces();
    return true;
  }

  function drawGround() {
    if (visualPack === 'tiny-swords' && drawTinySwordsGround()) return;
    for (const t of world.tiles) {
      const x = t.x * TILE, y = t.y * TILE, variation = hashColor(t.x, t.y, world.seed);
      const light = terrainLight(t);
      if (t.terrain === 'water') {
        const nearShore = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => { const n = cell(t.x + dx, t.y + dy); return n && n.terrain !== 'water'; });
        const depth = t.waterKind === 'lake' && world.lake ? Math.min(1, Math.hypot(t.x - world.lake.x, t.y - world.lake.y) / Math.max(1, world.lake.r)) : .45;
        const waterBase = mix([42, 91, 101], [31, 68, 86], depth);
        ctx.fillStyle = 'rgb(' + lit(waterBase, light).join(',') + ')'; ctx.fillRect(x, y, TILE, TILE);
        if (nearShore) { ctx.fillStyle = '#d2c99a38'; ctx.fillRect(x + 1, y + 1, TILE - 2, 1); }
        if ((t.x * 3 + t.y * 5 + world.day) % 5 === 0) { ctx.fillStyle = '#a8d0c388'; ctx.fillRect(x + 2 + variation % 8, y + ((world.day + t.x) % 13), 5 + variation % 4, 1); }
      } else if (t.terrain === 'rock') {
        const stone = lit([112 + variation, 117 + variation, 105 + variation], light);
        ctx.fillStyle = 'rgb(' + stone.join(',') + ')'; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = rgba('#d5d0b5', .2 + light * .08); ctx.fillRect(x + 2, y + 2, 8 + variation % 4, 3);
        ctx.fillStyle = rgba('#34463e', .24 + t.slope * .12); ctx.fillRect(x + 7, y + 9, 7, 5);
        if (variation % 3 === 0) { ctx.fillStyle = '#789078'; ctx.fillRect(x + 4, y + 12, 4, 2); }
      } else {
        const wet = Math.max(0, Math.min(1, t.soilWaterMm / t.soilCapacityMm));
        const high = Math.max(0, Math.min(1, (t.heightM - 370) / 750));
        let ground = t.soilType === 'shallow' ? [112, 116, 88] : t.soilType === 'sandy' ? [152, 139, 98] : t.soilType === 'riparian' ? [77, 111, 73] : [88, 119, 72];
        ground = mix(ground, [119, 116, 99], high * .52);
        ground = mix(ground, [142, 123, 83], Math.max(0, .42 - wet) * .54);
        ground = lit(ground.map(v => Math.min(220, v + variation * .75)), light);
        ctx.fillStyle = 'rgb(' + ground.join(',') + ')';
        ctx.fillRect(x, y, TILE, TILE);
        if (variation % 4 === 0) { ctx.fillStyle = '#d5c99a4d'; ctx.fillRect(x + 3 + variation % 5, y + 4 + variation % 6, 2, 1); }
        if (t.slope > .26 && variation % 3 === 0) { ctx.fillStyle = rgba('#35463a', Math.min(.2, t.slope * .1)); ctx.fillRect(x + 2, y + 12, 5, 1); }
      }
      applyLayerTint(t, x, y);
    }
    drawContours();
  }

  function drawContours() {
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(238,231,194,.18)';
    for (const t of world.tiles) {
      if (t.terrain === 'water') continue;
      const level = Math.floor(t.heightM / 110);
      const right = cell(t.x + 1, t.y), down = cell(t.x, t.y + 1);
      if (right && right.terrain !== 'water' && Math.floor(right.heightM / 110) !== level) {
        ctx.beginPath(); ctx.moveTo(t.x * TILE + 13, t.y * TILE + 2); ctx.lineTo(t.x * TILE + 15, t.y * TILE + 13); ctx.stroke();
      }
      if (down && down.terrain !== 'water' && Math.floor(down.heightM / 110) !== level) {
        ctx.beginPath(); ctx.moveTo(t.x * TILE + 2, t.y * TILE + 13); ctx.lineTo(t.x * TILE + 13, t.y * TILE + 15); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function applyLayerTint(t, x, y) {
    if (layer === 'soil' && t.terrain !== 'water') {
      const wet = t.soilWaterMm / t.soilCapacityMm;
      ctx.fillStyle = wet > .52 ? rgba('#438ca0', .10 + wet * .16) : rgba('#a87a47', .06 + (1 - wet) * .17);
      ctx.fillRect(x, y, TILE, TILE);
    } else if (layer === 'climate') {
      const region = world.regions[t.regionId];
      const tint = region.rainfallMm > 1 ? '#4d9aaa' : region.temperatureC > 24 ? '#d29a4b' : '#9c946f';
      ctx.fillStyle = rgba(tint, .13 + Math.min(.12, region.rainfallMm / 90));
      ctx.fillRect(x, y, TILE, TILE);
    } else if (layer === 'flora' && t.terrain === 'land') {
      const amount = t.plants.reduce((s, v) => s + v, 0);
      ctx.fillStyle = rgba('#9fc56d', Math.min(.28, amount / 3600));
      ctx.fillRect(x, y, TILE, TILE);
    } else if (layer === 'harvest') {
      const score = t.terrain === 'water' ? t.fishingSuitability : t.huntingSuitability;
      const tint = score >= .62 ? (t.terrain === 'water' ? '#4ba9a0' : '#8cb85e')
        : score >= .28 ? '#d6ae54' : '#b66b5b';
      ctx.fillStyle = rgba(tint, score >= .62 ? .43 : score >= .28 ? .34 : .22);
      ctx.fillRect(x, y, TILE, TILE);
    }
  }

  function drawGroundPlants() {
    const berry = plantIndex('berry'), browse = plantIndex('browse'), grass = plantIndex('grass'), reeds = plantIndex('reed');
    for (const t of world.tiles) {
      if (t.terrain === 'water') continue;
      const px = t.x * TILE, py = t.y * TILE;
      const g = t.plants[grass], sh = t.plants[berry], br = t.plants[browse], reed = t.plants[reeds];
      if (g > 22 && (t.x * 5 + t.y * 7) % 3 === 0) {
        ctx.fillStyle = g > 110 ? '#9ab565' : '#809a53';
        ctx.fillRect(px + 3 + (t.x % 4), py + 10 + (t.y % 3), 2, 3);
        ctx.fillRect(px + 8 + (t.y % 4), py + 7 + (t.x % 4), 1, 3);
      }
      if (reed > 38 && (t.x + t.y) % 2 === 0) {
        ctx.fillStyle = '#a7a454'; ctx.fillRect(px + 4, py + 4, 1, 8); ctx.fillRect(px + 8, py + 2, 1, 10); ctx.fillRect(px + 11, py + 6, 1, 7);
      }
      if (visualPack !== 'tiny-swords' && sh > 30 && (t.x * 3 + t.y * 5) % 3 === 0) {
        ctx.fillStyle = '#657c47'; ctx.fillRect(px + 4, py + 6, 8, 6);
        ctx.fillStyle = '#a35551'; if (sh > 45) { ctx.fillRect(px + 6, py + 7, 2, 2); ctx.fillRect(px + 10, py + 10, 2, 2); }
      }
      if (visualPack !== 'tiny-swords' && br > 20 && (t.x * 7 + t.y * 3) % 4 === 0) {
        ctx.fillStyle = br > 70 ? '#728e50' : '#637b47';
        ctx.fillRect(px + 4, py + 7, 8, 5); ctx.fillRect(px + 7, py + 5, 3, 3);
      }
    }
  }

  function collectDepthItems() {
    const items = [], broad = plantIndex('broadleaf'), conifer = plantIndex('conifer');
    let sequence = 0;
    function add(kind, x, y, tile, order, id, extra) {
      const z = tile ? Math.max(0, Math.min(1800, tile.heightM || 0)) : 0;
      // Screen-space ground contact is primary; terrain elevation is the explicit Z tie-breaker.
      items.push(Object.assign({ kind, x, y, z, depth: (y + 1) * TILE * 2048 + z, order, id: id || 0, sequence: sequence++ }, extra || {}));
    }
    for (const t of world.tiles) {
      if (t.terrain === 'water') continue;
      const tree = t.plants[broad], pine = t.plants[conifer];
      const variant = (t.x * 13 + t.y * 17 + world.seed) % 5;
      if ((t.stoneDeposit || 0) > .7 || (t.goldOre || 0) > .05) {
        add('mineral', t.x, t.y, t, .15, t.i, { tile: t, stone: t.stoneDeposit || 0, gold: t.goldOre || 0 });
      }
      if (visualPack === 'procedural') {
        if (tree > 160 && (t.x * 7 + t.y * 11) % 3 !== 1) add('tree', t.x, t.y, t, 0, t.i, { tile: t, type: 'broadleaf', mass: tree, variant });
        if (pine > 150 && (t.x * 11 + t.y * 5) % 3 !== 1) add('tree', t.x, t.y, t, 0, t.i, { tile: t, type: 'conifer', mass: pine, variant });
      } else if (isTreeAssetAnchor(t, broad, conifer)) {
        const type = tree >= pine ? 'broadleaf' : 'conifer', mass = type === 'broadleaf' ? tree : pine;
        add('tree', t.x, t.y, t, 0, t.i, { tile: t, type, mass, variant });
      }
      for (const plantId of ['berry', 'browse']) {
        if (visualPack === 'tiny-swords' && isBushAssetAnchor(t, plantId)) add('bush', t.x, t.y, t, 1, t.i, { tile: t, plantId });
      }
      if (t.stump && t.stump.untilDay >= world.day) add('stump', t.x, t.y, t, 2, t.i, { tile: t, stump: t.stump });
    }
    for (const item of world.logs || []) {
      if (!item.available || item.amount <= .01) continue;
      const tile = cell(Math.round(item.x), Math.round(item.y));
      if (tile) add('log', item.x, item.y, tile, 2.2, item.id, { resource: item });
    }
    for (const s of world.structures) {
      if (s.type === 'divisa') continue;
      const tile = cell(Math.round(s.x), Math.round(s.y));
      add('structure', s.x, s.y, tile, 2, s.id, { structure: s });
      if (s.complete && s.type === 'curral') {
        const radius = Math.max(2, Math.round(s.radius || 3.5));
        const centerX = Math.round(s.x), centerY = Math.round(s.y);
        function addFence(x, y, sourceColumn, sourceRow, key) {
          const fenceTile = cell(x, y);
          if (fenceTile) add('fence', x, y, fenceTile, 2.6, s.id * 100 + key, { sourceX: sourceColumn * 32, sourceY: sourceRow * 32 });
        }
        for (let offset = -radius; offset <= radius; offset++) {
          const topColumn = offset === -radius ? 0 : offset === radius ? 4 : 2;
          const bottomColumn = topColumn;
          addFence(centerX + offset, centerY - radius, topColumn, 0, offset + radius);
          if (offset !== 0) addFence(centerX + offset, centerY + radius, bottomColumn, 3, offset + radius + 2 * radius + 1);
          if (offset > -radius && offset < radius) {
            const sideRow = 1 + ((offset + radius - 1) % 2);
            addFence(centerX - radius, centerY + offset, 0, sideRow, offset + radius + 4 * radius + 2);
            addFence(centerX + radius, centerY + offset, 4, sideRow, offset + radius + 6 * radius + 3);
          }
        }
      }
    }
    for (const a of world.animals) {
      if (!a.alive) continue;
      const pose = visualPose('animal', a);
      const tile = cell(Math.round(a.x), Math.round(a.y));
      add('animal', pose.x, pose.y, tile, 3, a.id, { animal: a, pose });
    }
    for (const p of world.people) {
      if (!p.alive) continue;
      const pose = visualPose('person', p);
      const tile = cell(Math.round(p.x), Math.round(p.y));
      add('person', pose.x, pose.y, tile, 4, p.id, { person: p, pose });
    }
    return items;
  }

  function drawDepthSortedWorld() {
    const items = collectDepthItems();
    items.sort((a, b) => a.depth - b.depth || a.order - b.order || a.sequence - b.sequence || a.id - b.id);
    for (const item of items) {
      if (item.kind === 'tree') drawTreeItem(item);
      else if (item.kind === 'mineral') drawMineralDeposit(item);
      else if (item.kind === 'bush') drawTinySwordsBush(item.tile, item.plantId);
      else if (item.kind === 'stump') drawTreeStump(item);
      else if (item.kind === 'log') drawLooseTreeLog(item);
      else if (item.kind === 'fence') drawFenceSegment(item);
      else if (item.kind === 'structure') drawStructure(item.structure);
      else if (item.kind === 'animal') drawAnimal(item.animal, item.pose);
      else if (item.kind === 'person') drawPerson(item.person, item.pose);
    }
  }

  function drawFenceSegment(item) {
    if (visualPack !== 'tiny-swords') return;
    const image = tinyFenceTilemap;
    if (!image.complete || image.naturalWidth < 352 || image.naturalHeight < 768) return;
    const x = item.x * TILE + TILE / 2, y = item.y * TILE + TILE / 2;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, item.sourceX, item.sourceY, 32, 32, x - TILE / 2, y - TILE / 2, TILE, TILE);
    ctx.restore();
  }

  function drawTreeStump(item) {
    if (visualPack === 'tiny-swords') {
      const isConifer = item.stump.type === 'conifer';
      const firstVariant = isConifer ? 1 : 3;
      const variant = firstVariant + hashColor(item.tile.x, item.tile.y, world.seed + 281) % 2;
      const image = tinyStumpSprites[variant];
      if (image && image.complete && image.naturalWidth >= 128 && image.naturalHeight >= 256) {
        const anchors = { 1: { x: 35, y: 48 }, 2: { x: 30.5, y: 53 }, 3: { x: 33, y: 40 }, 4: { x: 35, y: 36 } };
        const anchor = anchors[variant], scale = TILE / 16;
        const x = item.x * TILE + TILE / 2 - anchor.x * scale;
        const groundY = (item.y + 1) * TILE - 2;
        const y = groundY - anchor.y * scale;
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 64, 192, 64, 64, Math.round(x), Math.round(y), 64 * scale, 64 * scale);
        ctx.restore();
        return;
      }
    }
    const x = item.x * TILE, y = item.y * TILE;
    ctx.fillStyle = 'rgba(21,31,24,.3)'; ctx.fillRect(x + 3, y + 12, 10, 2);
    ctx.fillStyle = '#59402a'; ctx.fillRect(x + 6, y + 6, 5, 8);
    ctx.fillStyle = '#9a7044'; ctx.fillRect(x + 5, y + 5, 7, 3);
    ctx.fillStyle = '#d0a46b'; ctx.fillRect(x + 7, y + 6, 3, 1);
    ctx.fillStyle = '#725132'; ctx.fillRect(x + 8, y + 6, 1, 1);
  }

  function drawMineralDeposit(item) {
    const x = item.x * TILE, y = item.y * TILE;
    const gold = item.gold > .05;
    const size = Math.max(.7, Math.min(1.25, .72 + item.stone * .045 + item.gold * .08));
    ctx.save();
    ctx.fillStyle = 'rgba(25,31,29,.34)';
    ctx.beginPath(); ctx.ellipse(x + 8, y + 13, 6 * size, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#46544f'; ctx.fillRect(x + 3, y + 8, 5 * size, 5 * size);
    ctx.fillRect(x + 8, y + 6, 5 * size, 6 * size);
    ctx.fillStyle = '#69756c'; ctx.fillRect(x + 4, y + 8, 3 * size, 2 * size);
    ctx.fillRect(x + 9, y + 6, 3 * size, 2 * size);
    ctx.fillStyle = '#9b9d8c'; ctx.fillRect(x + 5, y + 8, 2, 1); ctx.fillRect(x + 10, y + 6, 2, 1);
    if (gold) {
      ctx.fillStyle = '#d29c36'; ctx.fillRect(x + 7, y + 10, 2, 2); ctx.fillRect(x + 11, y + 9, 2, 2);
      ctx.fillStyle = '#f1d66b'; ctx.fillRect(x + 8, y + 10, 1, 1); ctx.fillRect(x + 12, y + 9, 1, 1);
    }
    ctx.restore();
  }

  function drawLooseTreeLog(item) {
    const x = item.x * TILE, y = item.y * TILE;
    ctx.fillStyle = 'rgba(21,31,24,.28)'; ctx.fillRect(x + 2, y + 12, 13, 2);
    ctx.fillStyle = '#67462d'; ctx.fillRect(x + 2, y + 8, 12, 4);
    ctx.fillStyle = '#9d7143'; ctx.fillRect(x + 3, y + 7, 10, 3);
    ctx.fillStyle = '#d4ad72'; ctx.fillRect(x + 2, y + 8, 2, 3); ctx.fillRect(x + 13, y + 8, 2, 3);
    ctx.fillStyle = '#75502f'; ctx.fillRect(x + 3, y + 9, 1, 1); ctx.fillRect(x + 13, y + 9, 1, 1);
    if (item.resource.amount > 12) { ctx.fillStyle = '#b68a56'; ctx.fillRect(x + 5, y + 8, 2, 1); }
  }

  function drawTreeItem(item) {
    const tile = item.tile, px = item.x * TILE, py = item.y * TILE;
    if (visualPack === 'tiny-swords' && drawTinySwordsTree(tile, item.type, item.mass)) return;
    if (visualPack === 'modern-farm' && drawTreeAsset(tile, item.type, item.mass)) return;
    if (item.type === 'broadleaf') drawBroadleaf(px, py, item.mass, item.variant);
    else drawConifer(px, py, item.mass, item.variant);
  }

  function drawCanopyShadows(broad, conifer) {
    ctx.save();
    for (const t of world.tiles) {
      const crown = t.plants[broad] + t.plants[conifer];
      if (crown < 160 || (t.x * 7 + t.y * 11) % 3 === 1) continue;
      const x = t.x * TILE, y = t.y * TILE, size = Math.min(8, 3 + crown / 220);
      ctx.fillStyle = 'rgba(20,35,26,.31)';
      ctx.beginPath(); ctx.ellipse(x + 10 + size * .45, y + 13, size, 2.2 + size * .18, -.18, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBroadleaf(x, y, mass, variant) {
    const crown = mass > 500 ? '#42673f' : '#527749';
    const litCrown = mass > 500 ? '#6e9255' : '#82a361';
    const spread = variant % 2 ? 1 : 0;
    ctx.fillStyle = '#403f31'; ctx.fillRect(x + 7, y + 7, 2, 8);
    ctx.fillStyle = 'rgba(31,49,35,.22)'; ctx.fillRect(x + 9, y + 13, 6, 2);
    ctx.fillStyle = crown;
    ctx.fillRect(x + 2 - spread, y + 5, 12 + spread, 6);
    ctx.fillRect(x + 4, y + 3, 8 + (variant % 3), 8);
    if (variant % 3 !== 0) ctx.fillRect(x + 1, y + 7, 4, 4);
    ctx.fillStyle = litCrown;
    ctx.fillRect(x + 3, y + 4, 4, 3); ctx.fillRect(x + 8, y + 5, 3 + variant % 2, 3);
    if (mass > 700) { ctx.fillStyle = '#36573a'; ctx.fillRect(x + 5, y + 9, 7, 2); }
  }

  function drawConifer(x, y, mass, variant) {
    const shade = mass > 550 ? '#2f5c49' : '#3f6c4e';
    const light = mass > 550 ? '#5e8058' : '#70925d';
    const width = variant % 2 ? 6 : 5;
    ctx.fillStyle = '#554b36'; ctx.fillRect(x + 7, y + 8, 2, 7);
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(x + 8, y + 1); ctx.lineTo(x + 8 + width, y + 12); ctx.lineTo(x + 8 - width, y + 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 8, y + 4); ctx.lineTo(x + 13, y + 13); ctx.lineTo(x + 3, y + 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light;
    ctx.fillRect(x + 7, y + 4, 2, 3); ctx.fillRect(x + 5, y + 9, 3, 2);
    if (variant % 3 === 1) ctx.fillRect(x + 10, y + 8, 2, 2);
  }

  function drawAtmosphere() {
    ctx.save();
    for (const r of world.regions) {
      const x0 = (r.id % (W / 8)) * 8, y0 = Math.floor(r.id / (W / 8)) * 8;
      const x = x0 * TILE, y = y0 * TILE, regionSize = 8 * TILE;
      if (r.humidity > .66) {
        ctx.fillStyle = 'rgba(92,112,118,' + Math.min(.13, (r.humidity - .58) * .2) + ')';
        ctx.fillRect(x, y, regionSize, regionSize);
      }
      if (r.rainfallMm <= 1) continue;
      ctx.strokeStyle = 'rgba(190,220,216,' + Math.min(.62, .24 + r.rainfallMm / 48) + ')';
      ctx.lineWidth = 1;
      for (let n = 0; n < 15; n++) {
        const px = x + ((n * 71 + world.day * 5 + r.id * 13) % regionSize);
        const py = y + ((n * 37 + world.day * 9 + r.id * 17) % regionSize);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 2, py + 5); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCommunities() {
    if (layer === 'society') for (const person of world.people) {
      if (!person.alive || !person.leadingSheepId) continue;
      const sheep = world.animals.find(animal => animal.id === person.leadingSheepId && animal.alive);
      if (!sheep) continue;
      ctx.save(); ctx.strokeStyle = 'rgba(247,225,174,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(person.x * TILE + 8, person.y * TILE + 9); ctx.lineTo(sheep.x * TILE + 8, sheep.y * TILE + 9); ctx.stroke(); ctx.restore();
    }
    for (const c of world.communities) {
      if (c.dissolved || !c.memberIds.length) continue;
      const count = c.memberIds.filter(id => getPerson(id)).length;
      if (!count) continue;
      if (layer === 'society') {
        for (const [key, lastSeen] of Object.entries(c.usedCells || {})) {
          if (world.day - lastSeen > 45) continue;
          const index = Number(key), ux = index % W, uy = Math.floor(index / W);
          ctx.fillStyle = rgba(c.color, .13); ctx.fillRect(ux * TILE + 2, uy * TILE + 2, TILE - 4, TILE - 4);
        }
        for (const structure of world.structures.filter(s => s.communityId === c.id && s.complete)) {
          if (structure.type === 'divisa') continue;
          const r = (structure.type === 'abrigo' ? 3 : 5) * TILE;
          ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = rgba(c.color, .42); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(structure.x * TILE + 8, structure.y * TILE + 8, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        for (const property of c.properties || []) {
          const r = (property.radius || 5) * TILE;
          ctx.save(); ctx.fillStyle = rgba(c.color, .08); ctx.strokeStyle = rgba(c.color, .9); ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.arc(property.x * TILE + 8, property.y * TILE + 8, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#f4f0dfdf'; ctx.fillRect(property.x * TILE - 8, property.y * TILE - 5, 56, 10);
          ctx.fillStyle = '#3e4f3e'; ctx.font = '6px system-ui'; ctx.textAlign = 'left'; ctx.fillText('PROPRIEDADE', property.x * TILE - 5, property.y * TILE + 2);
          ctx.restore();
        }
      }
      if (layer === 'society' || layer === 'harvest') {
        for (const [kind, ground] of Object.entries(c.grounds || {})) {
          if (!ground) continue;
          ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(c.color, .86); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(ground.x * TILE + 8, ground.y * TILE + 8, (ground.radius || 4) * TILE, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#f4f0dfdf'; ctx.fillRect(ground.x * TILE - 8, ground.y * TILE - 7, kind === 'hunting' ? 34 : 35, 10);
          ctx.fillStyle = '#3e4f3e'; ctx.font = '6px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(kind === 'hunting' ? 'CAÇA' : 'PESCA', ground.x * TILE - 5, ground.y * TILE + 1);
          ctx.restore();
        }
      }
      const radius = (4 + Math.min(4, Math.sqrt(count))) * TILE;
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(c.color, .66); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c.x * TILE + 8, c.y * TILE + 8, radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#f4f0dfdf'; ctx.fillRect(c.x * TILE - 8, c.y * TILE - 5, Math.min(154, c.name.length * 5 + 14), 11);
      ctx.fillStyle = '#3e4f3e'; ctx.font = '7px system-ui'; ctx.textAlign = 'left';
      const leader = getPerson(c.leaderId);
      const title = c.stage === 'reino' ? 'rei' : 'prefeito';
      ctx.fillText(c.name + (leader ? ' · ' + title + ' ' + leader.name.split(' ')[0] : ''), c.x * TILE - 5, c.y * TILE + 3, 145);
    }
  }

  function drawBoundaries() {
    for (const s of world.structures) {
      if (s.type !== 'divisa') continue;
      const activeCommunity = getCommunity(s.communityId);
      const x = s.x * TILE, y = s.y * TILE;
      if (!activeCommunity && !s.complete) continue;
      const ratio = s.complete ? 1 : Math.max(.08, s.progress / s.required);
      const radius = (s.radius || 4) * TILE;
      ctx.save(); ctx.strokeStyle = activeCommunity ? activeCommunity.color : '#b58a55'; ctx.lineWidth = s.complete ? 2 : 1.5;
      ctx.setLineDash(s.complete ? [] : [3, 4]); ctx.beginPath(); ctx.arc(x + 8, y + 8, radius, -.5 * Math.PI, -.5 * Math.PI + Math.PI * 2 * ratio); ctx.stroke();
      const posts = Math.max(4, Math.ceil(12 * ratio)); ctx.fillStyle = activeCommunity ? activeCommunity.color : '#b58a55';
      for (let n = 0; n < posts; n++) {
        const angle = -.5 * Math.PI + Math.PI * 2 * ratio * n / Math.max(1, posts - 1);
        ctx.fillRect(x + 6 + Math.cos(angle) * radius, y + 6 + Math.sin(angle) * radius, 4, 4);
      }
      ctx.restore();
    }
  }

  function drawStructure(s) {
      if (s.type === 'curral') return;
      const activeCommunity = getCommunity(s.communityId);
      if (!activeCommunity && !s.complete) return;
      const x = s.x * TILE, y = s.y * TILE;
      let drawnBuilding = false;
      if (s.complete && visualPack === 'tiny-swords') {
        drawnBuilding = drawTinySwordsBuilding(s, activeCommunity, x, y);
      }
      if (s.complete && !drawnBuilding) {
        ctx.fillStyle = '#303a2b'; ctx.fillRect(x + 3, y + 10, 11, 5);
        ctx.fillStyle = activeCommunity ? (s.type === 'abrigo' ? '#b58a55' : '#a87849') : '#776e5c';
        ctx.fillRect(x + 5, y + 7, 8, 5); ctx.fillRect(x + 7, y + 5, 4, 3);
        ctx.fillStyle = '#66543b'; ctx.fillRect(x + 8, y + 11, 2, 4);
      } else {
        ctx.fillStyle = '#e2d4a5'; ctx.fillRect(x + 4, y + 11, 10, 2);
        ctx.fillStyle = '#b8844e'; ctx.fillRect(x + 7, y + 8, 2, 3); ctx.fillRect(x + 10, y + 7, 2, 4);
      }
  }

  function drawAnimal(a, pose) {
      const p = Sim.animals.find(s => s.id === a.speciesId), x = pose.x * TILE, y = pose.y * TILE;
      if (!p) return;
      if (a.speciesId === 'sheep' && visualPack === 'tiny-swords' && drawTinySwordsSheep(a, x, y, pose)) return;
      if (p.aquatic) {
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 7, 7, 3); ctx.fillRect(x + 11, y + 6, 3, 5);
        ctx.fillStyle = '#f4e8b5'; ctx.fillRect(x + 7, y + 8, 1, 1);
      } else if (a.speciesId === 'bird') {
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 6, 7, 3); ctx.fillRect(x + 8, y + 4, 2, 3);
        ctx.fillStyle = '#dfc78b'; ctx.fillRect(x + 11, y + 5, 3, 1);
      } else {
        ctx.fillStyle = '#1f2d25aa'; ctx.fillRect(x + 4, y + 10, 9, 2);
        ctx.fillStyle = p.color; ctx.fillRect(x + 5, y + 6, 8, 4); ctx.fillRect(x + 11, y + 5, 3, 3);
        if (a.speciesId === 'hare') { ctx.fillRect(x + 12, y + 2, 1, 4); ctx.fillRect(x + 14, y + 3, 1, 3); }
        if (a.speciesId === 'fox') { ctx.fillRect(x + 2, y + 7, 4, 2); ctx.fillRect(x + 3, y + 6, 2, 2); }
        ctx.fillStyle = '#302a22'; ctx.fillRect(x + 12, y + 6, 1, 1);
      }
  }

  function drawPerson(p, pose) {
      const c = p.communityId ? getCommunity(p.communityId) : null;
      const x = pose.x * TILE, y = pose.y * TILE, child = p.ageDays < 12 * 365;
      const scale = child ? .72 : 1, color = c ? c.color : ['#d9c28b', '#cfb585', '#e0c99b', '#c9b27f'][p.id % 4];
      ctx.fillStyle = 'rgba(22,35,27,.38)'; ctx.beginPath(); ctx.ellipse(x + 9, y + 13, child ? 3.5 : 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      if (p.conflictRisk > .5) { ctx.strokeStyle = 'rgba(196,109,72,.52)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 8, y + 8, 7.5, 0, Math.PI * 2); ctx.stroke(); }
      if (visualPack !== 'tiny-swords' || !drawTinySwordsPerson(p, x, y, child, pose)) {
        ctx.fillStyle = color;
        ctx.fillRect(x + 8 - scale * 3, y + 7, scale * 6, scale * 5);
        ctx.fillRect(x + 8 - scale * 2, y + 3, scale * 4, scale * 4);
        ctx.fillStyle = '#554731'; ctx.fillRect(x + 7, y + 4, 3, 1);
        if (!child) {
          ctx.fillStyle = '#4b4a3a';
          if (p.brain.lastAction === 'gather' || p.brain.lastAction === 'build') ctx.fillRect(x + 4, y + 8, 3, 1);
          else ctx.fillRect(x + 5, y + 8, 2, 1);
          ctx.fillStyle = '#67553c'; ctx.fillRect(x + 7, y + 11, 1, 3); ctx.fillRect(x + 10, y + 11, 1, 3);
        }
      }
      drawCarriedMeat(p, x, y, pose);
      drawCarriedWood(p, x, y, pose);
      if (p.health < 22) { ctx.fillStyle = '#bc574d'; ctx.fillRect(x + 12, y + 2, 3, 2); }
  }

  function drawSelection() {
    if (!selection) return;
    if (selection.kind === 'cell') {
      ctx.strokeStyle = '#f5edc5'; ctx.lineWidth = 2;
      ctx.strokeRect(selection.x * TILE + 1, selection.y * TILE + 1, TILE - 2, TILE - 2);
    } else if (selection.kind === 'person') {
      const p = getPerson(selection.id); if (!p) return;
      ctx.strokeStyle = '#fff0b4'; ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x * TILE + 1, p.y * TILE + 1, 14, 15);
    } else if (selection.kind === 'animal') {
      const a = getAnimal(selection.id); if (!a) return;
      const x = a.x * TILE, y = a.y * TILE;
      ctx.strokeStyle = '#fff5cd'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + TILE - 1, a.speciesId === 'sheep' ? 11 : 8, 4, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (selection.kind === 'structure') {
      const s = world.structures.find(item => item.id === selection.id); if (!s) return;
      const x = s.x * TILE, y = s.y * TILE;
      ctx.strokeStyle = '#fff0b4'; ctx.lineWidth = 1.5;
      if (s.type === 'divisa') {
        ctx.beginPath(); ctx.arc(x + 8, y + 8, (s.radius || 4) * TILE + 3, 0, Math.PI * 2); ctx.stroke();
      } else ctx.strokeRect(x - 8, y - 30, 32, 48);
    }
  }

  function drawMap() {
    const displayContext = ctx;
    const nextGroundKey = [world.seed, world.day, visualPack, layer].join(':');
    if (groundCacheKey !== nextGroundKey) {
      ctx = groundCacheContext;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, groundCacheCanvas.width, groundCacheCanvas.height);
      drawGround();
      drawGroundPlants();
      if (visualPack === 'procedural') drawCanopyShadows(plantIndex('broadleaf'), plantIndex('conifer'));
      ctx = displayContext;
      groundCacheKey = nextGroundKey;
    }
    ctx = displayContext;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(groundCacheCanvas, 0, 0);
    if (visualPack === 'tiny-swords') drawTinyWaterFoam();
    drawAtmosphere();
    drawDepthSortedWorld();
    drawBoundaries(); drawCommunities(); drawSelection();
  }

  function renderCommunityList(stats) {
    const active = world.communities.filter(c => !c.dissolved && c.memberIds.some(id => getPerson(id)));
    $('communityList').innerHTML = active.length ? active.slice().sort((a, b) => b.memberIds.length - a.memberIds.length).map(c => {
      const count = c.memberIds.filter(id => getPerson(id)).length;
      const structures = world.structures.filter(s => s.communityId === c.id);
      const completed = structures.filter(s => s.complete).length;
      const building = structures.find(s => !s.complete);
      const markedGrounds = c.grounds && c.grounds.hunting ? ['caça'] : [];
      const boundaryCount = structures.filter(s => s.type === 'divisa' && s.complete).length;
      const progress = building ? ' · construindo ' + Math.floor(building.progress / building.required * 100) + '%' : completed ? ' · ' + completed + ' construção(ões)' : '';
      const leader = getPerson(c.leaderId);
      const title = c.stage === 'reino' ? 'rei' : 'prefeito';
      return '<button class="community-card" data-community="' + c.id + '" title="Carne fornece 2,5 vezes a nutrição de uma unidade de fruto." style="--community:' + esc(c.color) + '">' +
        '<i class="color-dot"></i><span><strong>' + esc(c.name) + '</strong><small>' + esc(c.stage) + ' · ' + count + ' pessoas · ' + title + ' ' + esc(leader ? leader.name : 'sem líder') + ' · satisfação ' + Math.round((c.satisfaction || 0) * 100) + '% · alimento ' + fmt(c.stores.food, 0) + ' · carne ' + fmt(c.stores.meat, 1) + ' · madeira ' + fmt(c.stores.wood, 0) + ' · pedra ' + fmt(c.stores.stone, 0) + ' · ' + (c.properties || []).length + ' propriedade(s)' + (markedGrounds.length ? ' · áreas: ' + markedGrounds.join('/') : '') + (boundaryCount ? ' · ' + boundaryCount + ' divisa(s)' : '') + progress + '</small></span><em>' + Math.round(c.cohesion * 100) + '%</em></button>';
    }).join('') : '<div class="empty-state">Nenhum vínculo duradouro. Observe encontros ou libere novos indivíduos.</div>';
    $('solitaryCount').textContent = stats.independentPeople + ' dispersos';
  }

  function renderSpecies(stats) {
    $('faunaList').innerHTML = Sim.animals.map(p => {
      const count = stats.animalCounts[p.id] || 0;
      return '<div class="species-row" title="' + esc(p.role) + '"><i class="species-dot" style="--species:' + p.color + '"></i><span>' + esc(p.name) + '</span><b>' + count + '</b></div>';
    }).join('');
    $('floraList').innerHTML = Sim.plants.map((p, i) => {
      const count = stats.plantCounts[p.id] || 0;
      return '<div class="species-row" title="' + esc(p.guild) + '"><i class="species-dot" style="--species:' + p.color + '"></i><span>' + esc(p.name) + '</span><b>' + fmt(count) + '</b></div>';
    }).join('');
  }

  function renderEvents() {
    $('events').innerHTML = world.events.slice(0, 14).map(e =>
      '<div class="event">' + esc(e.text) + '<small>' + (e.day ? 'DIA ' + e.day : 'INÍCIO') + '</small></div>'
    ).join('') || '<div class="empty-state">Ainda não há registros.</div>';
  }

  function updateWorldLine(stats) {
    const communities = world.communities.filter(c => !c.dissolved && c.memberIds.some(id => getPerson(id)));
    if (stats.dryRegions >= 5) $('worldLine').textContent = 'Seca em ' + stats.dryRegions + ' regiões altera água e alimento';
    else if (communities.length) {
      const c = communities.slice().sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
      $('worldLine').textContent = c.name + ' · ' + c.stage + ' · ' + c.memberIds.filter(id => getPerson(id)).length + ' indivíduos';
      } else $('worldLine').textContent = stats.peopleCount + ' pessoas vivas · ' + stats.conflicts + ' disputas resolvidas';
  }

  function updateHeader(stats) {
    const region = world.regions[0] || { temperatureC: 18, rainfallMm: 0 };
    const avgTemp = world.regions.reduce((s, r) => s + r.temperatureC, 0) / world.regions.length;
    $('day').textContent = fmt(world.day);
    $('year').textContent = fmt(stats.year);
    $('animalCount').textContent = fmt(stats.animalCount);
    $('peopleCount').textContent = fmt(stats.peopleCount);
    $('communityCount').textContent = fmt(stats.communityCount);
    $('birthCount').textContent = fmt(stats.births);
    $('deathCount').textContent = fmt(stats.deaths);
    $('conflictCount').textContent = fmt(stats.conflicts);
    $('harvestCount').textContent = fmt(stats.harvests.hunting);
    $('meatCount').textContent = fmt(stats.meatCarried, 1) + '/' + fmt(stats.meatStored, 1);
    $('season').textContent = world.day ? seasonNames[stats.season].toUpperCase() + ' · ANO ' + stats.year : 'ESTADO INICIAL';
    $('temperature').textContent = Math.round(avgTemp) + ' °C';
    $('rainfall').textContent = fmt(stats.rainfallMm, 1) + ' mm';
    $('moisture').textContent = Math.round(stats.soilMoisture * 100) + '%';
    $('foodPressureTag').hidden = stats.foodRiskPeople === 0;
    $('foodRiskCount').textContent = fmt(stats.foodRiskPeople);
    const droughtActive = world.day < (world.droughtUntil || 0);
    $('droughtTag').hidden = !droughtActive;
    if (droughtActive) $('droughtTag').innerHTML = 'SECA EXPERIMENTAL · <b>' + fmt(world.droughtUntil - world.day) + ' DIAS</b>';
    $('droughtTrigger').textContent = droughtActive ? 'Estender seca' : 'Testar seca';
    $('runState').textContent = paused ? 'PAUSADA' : 'ATIVA';
    $('toggle').innerHTML = paused ? '▶ <span>Retomar</span>' : 'Ⅱ <span>Pausar</span>';
    $('toggle').setAttribute('aria-label', paused ? 'Retomar simulação' : 'Pausar simulação');
    $('seedLabel').textContent = world.seed;
    $('faunaSpecies').textContent = stats.speciesAnimals + ' presentes';
    $('floraSpecies').textContent = stats.speciesPlants + ' presentes';
    updateWorldLine(stats);
  }

  function openSelection(item) {
    selection = item;
    if (item && showRight) $('rightPanel').classList.remove('is-collapsed');
    renderInspector();
    drawMap();
  }

  function updateLocalAIStatus(status) {
    if (!$('localAiState')) return;
    const labels = { idle: 'desligada', loading: 'carregando', ready: 'ativa', working: 'pensando', error: 'indisponível' };
    $('localAiState').textContent = labels[status.phase] || status.phase;
    $('localAiStatus').textContent = status.text || '';
    $('localAiToggle').textContent = status.phase === 'loading' ? 'Carregando modelo…' : status.phase === 'ready' || status.phase === 'working' ? 'Desativar IA local' : 'Ativar modelo local';
    $('localAiToggle').disabled = status.phase === 'loading';
    $('localAiProgress').hidden = status.phase !== 'loading';
    $('localAiProgress').value = status.progress || 0;
  }

  function renderInspector() {
    const root = $('inspector');
    if (!selection) {
      $('inspectEyebrow').textContent = 'CAMPO DE OBSERVAÇÃO';
      $('inspectTitle').textContent = 'Um ecossistema em formação';
      root.innerHTML = '<p class="intro">Plantas, animais e pessoas começam sem uma história definida. O clima altera o solo; a vegetação sustenta consumidores; encontros podem virar comunidades.</p><div class="note-card"><b>Camada principal</b><span>Atmosfera · Geosfera · Hidrosfera · Biosfera</span></div><div class="note-card"><b>Experimentos complementares</b><span>Redes individuais para animais e pessoas; comunidades e nomes surgem durante a simulação. Plantas seguem processos fisiológicos.</span></div><p class="quiet">Selecione uma célula, organismo ou comunidade para inspecionar suas condições e relações.</p>';
      return;
    }
    if (selection.kind === 'person') {
      const p = getPerson(selection.id);
      if (!p) { selection = null; renderInspector(); return; }
      const c = p.communityId ? getCommunity(p.communityId) : null;
      const links = Object.values(world.socialLinks).filter(l => l.a === p.id || l.b === p.id).length;
      const skillLabels = { forage: 'coletor de alimento', hunt: 'caçador', gather: 'coletor de recursos', build: 'construtor', care: 'cuidador', diplomacy: 'mediador' };
      const leadingSkill = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0];
      const role = skillLabels[leadingSkill[0]] || 'generalista';
      const actionLabels = { forage: 'buscar frutos', hunt: 'caçar', deliver: 'levar recursos ao abrigo', drink: 'buscar água conhecida', socialize: 'procurar companhia visível', rest: 'descansar', explore: 'explorar', build: 'construir', gather: 'cortar árvore ou extrair minério', collect_log: 'recolher tronco', collect_feed: 'guardar brotos para o rebanho', share: 'partilhar', trade: 'negociar no posto ou com outra comunidade', migrate: 'migrar', capture_sheep: 'capturar ovelha próxima', lead_sheep: 'conduzir ovelha ao curral', raid: 'assaltar armazém conhecido' };
      const choices = p.lastDecision ? p.lastDecision.scores.map((score, i) => ({ action: Sim.actions[i], score }))
        .sort((a, b) => b.score - a.score).slice(0, 3) : [];
      const strategicPlan = p.strategicPlan;
      const personalMemories = (p.personalMemory || []).slice(-3).reverse();
      $('inspectEyebrow').textContent = c ? 'INDIVÍDUO · ' + c.stage.toUpperCase() : 'INDIVÍDUO · SEM COMUNIDADE';
      $('inspectTitle').textContent = p.name;
      root.innerHTML = '<div class="data-row"><span>Estado atual</span><b>' + esc(p.state) + '</b></div>' +
        '<div class="data-row"><span>Idade aproximada</span><b>' + fmt(p.ageDays / 365, 1) + ' anos</b></div>' +
        '<div class="data-row"><span>Alimento / água</span><b>' + Math.round(p.foodReserve) + ' / ' + Math.round(p.hydration) + '%</b></div>' +
        '<div class="data-row"><span>Energia / saúde</span><b>' + Math.round(p.energy) + ' / ' + Math.round(p.health) + '%</b></div>' +
        '<div class="data-row"><span>Ferimentos / carga</span><b>' + Math.round(p.injury) + ' · carne ' + fmt(p.carriedMeat, 1) + ' · madeira ' + fmt(p.carriedWood, 1) + ' · pedra ' + fmt(p.carriedStone, 1) + ' · ração ' + fmt(p.carriedFeed, 1) + '</b></div>' +
        '<div class="data-row"><span>Necessidade social</span><b>' + Math.round(p.socialNeed) + '%</b></div>' +
        '<div class="data-row"><span>Especialização emergente</span><b>' + esc(role) + ' · ' + Math.round(leadingSkill[1] * 100) + '%</b></div>' +
        '<div class="data-row"><span>Prestígio / tarefa</span><b>' + fmt(p.prestige || 0, 1) + (p.assignment ? ' · ' + esc(p.assignment.title) + (p.assignment.pauseReason ? ' · suspensa por ' + esc(p.assignment.pauseReason) : ' · até dia ' + p.assignment.expiresDay) : ' · sem delegação ativa') + '</b></div>' +
        '<div class="data-row"><span>Vínculos observados</span><b>' + links + '</b></div>' +
        '<h3>Comunidade</h3><div class="note-card"><b>' + (c ? esc(c.name) : 'Ainda sem vínculo') + '</b><span>' + (c ? esc(c.stage) + ' · satisfação ' + Math.round(c.satisfaction * 100) + '% · coesão ' + Math.round(c.cohesion * 100) + '%' : 'A convivência depende de encontros repetidos.') + '</span></div>' +
        '<h3>Decisão e aprendizado</h3><div class="brain-box"><strong>Rede individual · ' + p.brain.inputSize + ' → ' + p.brain.hiddenSize + ' → ' + p.brain.actionCount + '</strong><small>50% mais neurônios ocultos que a versão anterior e atualização dos pesos 1,5× mais rápida. Avalia necessidades, alimento, água, risco, recursos do grupo e áreas de caça; resultados positivos e negativos ajustam decisões futuras.</small><div class="brain-metrics"><span>Intenção<b>' + esc(actionLabels[p.brain.lastAction] || p.brain.lastAction) + '</b></span><span>Atualizações<b>' + fmt(p.brain.updates) + '</b></span><span>Recompensa média<b>' + p.brain.rewardMean.toFixed(2) + '</b></span><span>Memória por ação<b>individual</b></span></div></div>' +
        (strategicPlan ? '<div class="note-card"><b>Plano individual do modelo local · ' + esc(actionLabels[strategicPlan.action] || strategicPlan.action) + (strategicPlan.expiresDay >= world.day ? ' · ativo' : ' · expirado') + '</b><span>' + esc(strategicPlan.reason || 'Sem justificativa registrada.') + ' · confiança ' + Math.round(strategicPlan.confidence * 100) + '% · dia ' + strategicPlan.createdDay + '</span></div>' : '') +
        (personalMemories.length ? '<h3>Memória pessoal recente</h3>' + personalMemories.map(memory => '<div class="event">Dia ' + memory.day + ': ' + esc(memory.state) + ' — ' + esc(memory.lesson) + '</div>').join('') : '') +
        '<div class="note-card"><b>O que aprendeu</b><span>' + esc(p.lastLesson || 'Ainda está aprendendo com o ambiente.') + '</span></div>' +
        (choices.length ? '<h3>Alternativas avaliadas</h3>' + choices.map(item => '<div class="data-row"><span>' + esc(actionLabels[item.action] || item.action) + '</span><b>' + item.score.toFixed(2) + '</b></div>').join('') : '') +
        (p.parents ? '<div class="note-card"><b>Dependência familiar</b><span>Esta pessoa nasceu durante a simulação e ainda recebe cuidado de seus responsáveis.</span></div>' : '');
      return;
    }
    if (selection.kind === 'animal') {
      const a = getAnimal(selection.id);
      if (!a) { selection = null; renderInspector(); return; }
      const profile = Sim.animals.find(p => p.id === a.speciesId);
      const t = cell(a.x, a.y);
      $('inspectEyebrow').textContent = 'BIOSFERA · FAUNA';
      $('inspectTitle').textContent = profile.name;
      root.innerHTML = '<div class="data-row"><span>Perfil funcional</span><b>' + esc(profile.role) + '</b></div>' +
        '<div class="data-row"><span>Comportamento</span><b>' + esc(a.state) + '</b></div>' +
        (a.beingLedBy ? '<div class="data-row"><span>Conduzida por</span><b>' + esc((getPerson(a.beingLedBy) || {}).name || 'morador') + ' · a caminho do curral</b></div>' : a.herdCommunityId ? '<div class="data-row"><span>Rebanho</span><b>' + esc((getCommunity(a.herdCommunityId) || {}).name || 'comunidade') + ' · habituada ' + Math.round((a.habituation || 0) * 100) + '%</b></div>' : '<div class="data-row"><span>Condição</span><b>ovelha selvagem</b></div>') +
        '<div class="data-row"><span>Idade / longevidade</span><b>' + fmt(a.ageDays / 365, 1) + ' / ' + fmt(profile.life / 365) + ' anos</b></div>' +
        '<div class="data-row"><span>Energia / hidratação</span><b>' + Math.round(a.energy) + ' / ' + Math.round(a.hydration) + '%</b></div>' +
        '<h3>Condições locais</h3><div class="data-row"><span>Água no solo</span><b>' + Math.round(t.soilWaterMm) + ' mm</b></div>' +
        '<div class="data-row"><span>Altitude</span><b>' + Math.round(t.heightM) + ' m</b></div>' +
        '<div class="brain-box"><strong>Controlador individual · rede ' + a.brain.inputSize + ' → ' + a.brain.hiddenSize + ' → ' + a.brain.actionCount + '</strong><small>50% mais neurônios ocultos e atualização dos pesos 1,5× mais rápida. As necessidades e o habitat continuam limitando as ações possíveis.</small><div class="brain-metrics"><span>Última intenção<b>' + esc(a.brain.lastAction) + '</b></span><span>Decisões<b>' + a.brain.decisions + '</b></span><span>Atualizações<b>' + a.brain.updates + '</b></span><span>Pesos<b>independentes</b></span></div></div>' +
        '<p class="quiet">' + (profile.prey.length ? 'A dieta inclui ' + profile.prey.map(id => Sim.animals.find(s => s.id === id).name.toLowerCase()).join(', ') + '; a predação depende de encontros e do estado da presa.' : 'A dieta retira biomassa vegetal disponível; não há reposição automática de indivíduos.') + '</p>';
      return;
    }
    if (selection.kind === 'log') {
      const item = (world.logs || []).find(entry => entry.id === selection.id && entry.available);
      if (!item) { selection = null; renderInspector(); return; }
      $('inspectEyebrow').textContent = 'RECURSO · MADEIRA NO SOLO';
      $('inspectTitle').textContent = 'Tronco derrubado';
      root.innerHTML = '<div class="data-row"><span>Madeira disponível</span><b>' + fmt(item.amount, 1) + ' unidades</b></div>' +
        '<div class="data-row"><span>Espécie cortada</span><b>' + (item.treeType === 'conifer' ? 'conífera' : 'árvore de folhas largas') + '</b></div>' +
        '<div class="data-row"><span>Localização</span><b>' + item.x + ', ' + item.y + '</b></div>' +
        '<p class="quiet">O tronco fica disponível para qualquer morador que o perceba. A madeira só entra no estoque depois de ser levada ao abrigo.</p>';
      return;
    }
    if (selection.kind === 'community') {
      const c = getCommunity(selection.id);
      if (!c) { selection = null; renderInspector(); return; }
      const members = c.memberIds.map(getPerson).filter(Boolean);
      const names = members.slice(0, 8).map(p => p.name).join(', ');
      const structures = world.structures.filter(s => s.communityId === c.id);
      const activeUse = Object.values(c.usedCells || {}).filter(day => world.day - day <= 45).length;
      const relations = Object.values(world.communityRelations).filter(r => r.a === c.id || r.b === c.id);
      const disputes = relations.reduce((sum, r) => sum + r.conflicts, 0);
      const roleNames = { forage: 'alimento', hunt: 'caça', gather: 'recursos', build: 'construção', care: 'cuidado', diplomacy: 'mediação' };
      const roles = {};
      for (const p of members) {
        const best = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0][0];
        roles[best] = (roles[best] || 0) + 1;
      }
      const roleText = Object.entries(roles).map(([key, count]) => count + ' ' + roleNames[key]).join(' · ') || 'Sem especializações observadas';
      const structureText = structures.length ? structures.map(s => s.type + (s.complete ? ' (concluída)' : ' (' + Math.floor(s.progress / s.required * 100) + '%)')).join(', ') : 'Nenhuma construção';
      const groundsText = c.grounds && c.grounds.hunting ? ['caça perto de ' + c.grounds.hunting.feature + ' (' + qualityLabel(c.grounds.hunting.score || 0) + ')'] : [];
      const boundaryCount = structures.filter(s => s.type === 'divisa' && s.complete).length;
      const stageText = { vínculo: 'Laços ainda pequenos', grupo: 'Grupo local', tribo: 'Tribo emergente', reino: 'Reino emergente' }[c.stage] || c.stage;
      const leader = members.find(person => person.id === c.leaderId) || null;
      const taskCount = (c.assignments || []).filter(task => task.status === 'delegada').length;
      const tasksCompleted = (c.assignments || []).filter(task => task.status === 'concluída').length;
      const propertyCount = (c.properties || []).length;
      const raids = world.raidAttempts ? world.raidAttempts : 0;
      $('inspectEyebrow').textContent = 'ORGANIZAÇÃO SOCIAL · EXPERIMENTO';
      $('inspectTitle').textContent = c.name;
      root.innerHTML = '<div class="data-row"><span>Forma atual</span><b>' + esc(stageText) + '</b></div>' +
        '<div class="data-row"><span>Membros vivos</span><b>' + members.length + '</b></div>' +
        '<div class="data-row"><span>Coesão média</span><b>' + Math.round(c.cohesion * 100) + '%</b></div>' +
        '<div class="data-row"><span>' + (c.stage === 'reino' ? 'Rei' : 'Prefeito') + '</span><b>' + (leader ? esc(leader.name) : 'ainda sem nomeação') + ' · prestígio ' + fmt(leader && leader.prestige || 0, 1) + '</b></div>' +
        '<div class="data-row"><span>Satisfação</span><b>' + Math.round((c.satisfaction || 0) * 100) + '% · mede alimento, saúde, abrigo e vínculos</b></div>' +
        '<div class="data-row"><span>Reservas compartilhadas</span><b>alimento ' + fmt(c.stores.food, 1) + ' · carne ' + fmt(c.stores.meat, 1) + ' · madeira ' + fmt(c.stores.wood, 1) + ' · pedra ' + fmt(c.stores.stone, 1) + ' · ração ' + fmt(c.stores.feed, 1) + ' · ouro ' + fmt(c.stores.gold, 1) + '</b></div>' +
        '<div class="data-row"><span>Tarefas / propriedades</span><b>' + tasksCompleted + ' concluídas · ' + taskCount + ' ativas · ' + propertyCount + ' propriedade(s)</b></div>' +
        '<div class="data-row"><span>Trocas / disputas / assaltos</span><b>' + c.tradeCount + ' / ' + disputes + ' / ' + raids + ' no mundo</b></div>' +
        '<div class="data-row"><span>Primeiro vínculo</span><b>dia ' + c.createdDay + '</b></div>' +
        '<h3>Membros observados</h3><p>' + esc(names || 'Nenhum membro vivo') + (members.length > 8 ? '…' : '') + '</p>' +
        '<div class="note-card"><b>Ordens e prestígio</b><span>' + esc(roleText) + '. A liderança prioriza alimento para a comunidade quando as reservas caem; sede, fome ou energia críticas suspendem a tarefa para a pessoa cuidar da própria sobrevivência. Concluir uma tarefa concede 1 ponto de prestígio ao membro e 0,2 à liderança; um membro mais prestigiado precisa manter apoio por sete dias para assumir.</span></div>' +
        '<h3>Construção e área de uso</h3><div class="note-card"><b>' + esc(structureText) + '</b><span>' + activeUse + ' locais usados nos últimos 45 dias. Caçadas bem-sucedidas marcam áreas comunitárias; divisas exigem reservas e trabalho, e cruzá-las consome energia.</span></div>' +
        '<div class="note-card"><b>Áreas, propriedades e divisas</b><span>' + esc(groundsText.join(' · ') || 'Ainda sem áreas de caça marcadas') + (propertyCount ? ' · ' + propertyCount + ' propriedade(s), adquiridas por ouro, madeira e pedra' : '') + (boundaryCount ? ' · ' + boundaryCount + ' divisa(s) concluída(s)' : '') + '</span></div>' +
        '<div class="note-card"><b>Nome comunitário</b><span>' + esc(c.nameSource || 'Os primeiros membros') + ' propôs o nome usando um marco da paisagem local. Uma união pode gerar uma nova votação.</span></div>' +
        (c.history.length ? '<h3>Histórico</h3>' + c.history.slice(-5).reverse().map(item => '<div class="event">' + esc(item) + '</div>').join('') : '');
      return;
    }
    if (selection.kind === 'structure') {
      const s = world.structures.find(item => item.id === selection.id);
      if (!s) { selection = null; renderInspector(); return; }
      const c = getCommunity(s.communityId);
      $('inspectEyebrow').textContent = 'BIOSFERA · CONSTRUÇÃO COMUNITÁRIA';
      $('inspectTitle').textContent = s.type.charAt(0).toUpperCase() + s.type.slice(1);
      root.innerHTML = '<div class="data-row"><span>Comunidade</span><b>' + esc(c ? c.name : 'Sem comunidade') + '</b></div>' +
        '<div class="data-row"><span>Estado</span><b>' + (s.complete ? 'concluída no dia ' + s.builtDay : 'em construção · ' + Math.floor(s.progress / s.required * 100) + '%') + '</b></div>' +
        '<div class="data-row"><span>Localização</span><b>' + s.x + ', ' + s.y + '</b></div>' +
        (s.type === 'abrigo' ? '<div class="data-row"><span>Frutos armazenados</span><b>' + fmt(s.fruitStored, 1) + ' unidades</b></div><div class="data-row"><span>Carne armazenada</span><b>' + fmt(s.meatStored, 1) + ' unidades</b></div>' : '') +
        (s.type === 'curral' ? '<div class="data-row"><span>Rebanho próximo</span><b>' + world.animals.filter(a => a.alive && (a.herdCommunityId === s.communityId || Math.hypot(a.x - s.x, a.y - s.y) <= (s.radius || 3.5))).length + ' ovelhas · raio ' + (s.radius || 3.5) + ' células</b></div>' : '') +
        (s.type === 'posto de coleta' ? '<div class="data-row"><span>Mercado</span><b>ouro ' + fmt(world.market.gold, 0) + ' · alimento ' + fmt(world.market.food, 0) + ' · madeira ' + fmt(world.market.wood, 0) + ' · pedra ' + fmt(world.market.stone, 0) + ' · ovelhas ' + fmt(world.market.sheep, 0) + '</b></div>' : '') +
        (s.type === 'divisa' ? '<div class="data-row"><span>Área demarcada</span><b>caça · raio ' + (s.radius || 4) + ' células</b></div>' : '') +
        '<p class="quiet">Cada obra consome madeira, pedra, alimento, energia e tempo de trabalho. Abrigos guardam frutos e carne levados pelos moradores; currais usam as cercas do tileset e mantêm o rebanho dentro do perímetro; postos permitem negociar comida, madeira, pedra, ração e ovelhas com ouro.</p>';
      return;
    }
    const d = Sim.inspectTile(world, selection.x, selection.y);
    if (!d) return;
    const soilNames = { loam: 'franco', shallow: 'raso/pedregoso', sandy: 'arenoso', riparian: 'margem úmida', water: 'água superficial' };
    $('inspectEyebrow').textContent = 'GEOSFERA · CÉLULA ' + d.x + ',' + d.y;
    $('inspectTitle').textContent = d.terrain === 'water' ? 'Água superficial' : 'Solo e habitat';
    root.innerHTML = '<div class="data-row"><span>Terreno</span><b>' + (d.terrain === 'water' ? 'lago' : 'terra firme') + '</b></div>' +
      '<div class="data-row"><span>Superfície</span><b>plana</b></div>' +
      '<div class="data-row"><span>Classe de solo</span><b>' + (soilNames[d.soilType] || d.soilType) + '</b></div>' +
      '<div class="data-row"><span>Água retida</span><b>' + d.soilWaterMm + ' / ' + d.soilCapacityMm + ' mm</b></div>' +
      '<div class="data-row"><span>N mineral</span><b>' + d.mineralNitrogenGPerM2 + ' g/m²</b></div>' +
      '<div class="data-row"><span>Recursos geológicos</span><b>pedra ' + fmt(d.stoneDeposit, 1) + ' · ouro ' + fmt(d.goldOre, 1) + '</b></div>' +
      (d.looseTreeResource > .01 ? '<div class="data-row"><span>Tronco no chão</span><b>' + fmt(d.looseTreeResource, 1) + ' unidades de madeira</b></div>' : '') +
      (d.stump ? '<div class="data-row"><span>Árvore cortada</span><b>toco em recuperação</b></div>' : '') +
      '<h3>Caça</h3>' +
      '<div class="data-row"><span>Potencial de caça</span><b>' + qualityLabel(d.huntingSuitability) + ' · ' + Math.round(d.huntingSuitability * 100) + '% · índice de presas ' + d.nearbyHuntableAnimals + '</b></div>' +
      '<h3>Biomassa vegetal local</h3>' + (d.plantBiomass.length ? d.plantBiomass.map(p => '<div class="data-row"><span>' + esc(p.name) + '</span><b>' + fmt(p.biomass) + ' g/m²</b></div>').join('') : '<p>Sem biomassa vegetal visível nesta célula.</p>') +
      '<p class="quiet">Os perfis e taxas desta prévia são parâmetros exploratórios, não uma calibração de campo.</p>';
  }

  function render() {
    const stats = Sim.snapshot(world);
    $('assetCreditTiny').hidden = visualPack !== 'tiny-swords';
    $('assetCreditModern').hidden = visualPack !== 'modern-farm';
    updateHeader(stats);
    drawMap();
    renderCommunityList(stats);
    renderSpecies(stats);
    renderEvents();
    renderInspector();
  }

  function pickEntity(x, y) {
    const p = world.people.filter(a => a.alive && Math.hypot(a.x - x, a.y - y) < 1.1).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (p) return { kind: 'person', id: p.id };
    const a = world.animals.filter(o => o.alive && Math.hypot(o.x - x, o.y - y) < 1.05).sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (a) return { kind: 'animal', id: a.id };
    const looseLog = (world.logs || []).filter(item => item.available && item.amount > .01 && Math.hypot(item.x - x, item.y - y) < .9)
      .sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (looseLog) return { kind: 'log', id: looseLog.id };
    const structure = world.structures.filter(s => s.type === 'divisa'
      ? Math.abs(Math.hypot(s.x - x, s.y - y) - (s.radius || 4)) < .85
      : s.type === 'curral' ? Math.abs(Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) - Math.round(s.radius || 3.5)) < .85
      : Math.hypot(s.x - x, s.y - y) < 1.4)
      .sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (structure) return { kind: 'structure', id: structure.id };
    const c = world.communities.filter(g => !g.dissolved && g.memberIds.some(id => getPerson(id)) && Math.hypot(g.x - x, g.y - y) < 4.5)
      .sort((u, v) => Math.hypot(u.x - x, u.y - y) - Math.hypot(v.x - x, v.y - y))[0];
    if (c && layer === 'society') return { kind: 'community', id: c.id };
    return { kind: 'cell', x, y };
  }

  const activeMapPointers = new Map();
  let mapDrag = null, pinchGesture = null, mapGestureMoved = false, ignoreNextMapClick = false;
  function beginMapPointer(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    if (activeMapPointers.size === 1) {
      mapGestureMoved = false;
      mapDrag = mapZoom > MIN_MAP_ZOOM + .001
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: mapPanX, panY: mapPanY }
        : null;
    } else if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      const centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2;
      pinchGesture = { distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), centerX, centerY };
      mapDrag = null;
      mapGestureMoved = true;
    }
  }
  function moveMapPointer(event) {
    if (!activeMapPointers.has(event.pointerId)) return;
    activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const centerX = (points[0].x + points[1].x) / 2, centerY = (points[0].y + points[1].y) / 2;
      if (!pinchGesture) pinchGesture = { distance, centerX, centerY };
      if (pinchGesture.distance > 0 && distance > 0) {
        const bounds = stage.getBoundingClientRect();
        const stageX = bounds.left + bounds.width / 2, stageY = bounds.top + bounds.height / 2;
        const mapX = (pinchGesture.centerX - stageX - mapPanX) / mapZoom;
        const mapY = (pinchGesture.centerY - stageY - mapPanY) / mapZoom;
        mapZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, mapZoom * distance / pinchGesture.distance));
        mapPanX = centerX - stageX - mapX * mapZoom;
        mapPanY = centerY - stageY - mapY * mapZoom;
        pinchGesture = { distance, centerX, centerY };
        mapGestureMoved = true;
        updateMapViewport();
      }
      return;
    }
    if (mapDrag && mapDrag.pointerId === event.pointerId) {
      const dx = event.clientX - mapDrag.x, dy = event.clientY - mapDrag.y;
      if (Math.hypot(dx, dy) > 4) mapGestureMoved = true;
      if (mapGestureMoved) {
        mapPanX = mapDrag.panX + dx; mapPanY = mapDrag.panY + dy;
        updateMapViewport(); canvas.style.cursor = 'grabbing';
      }
    }
  }
  function endMapPointer(event) {
    activeMapPointers.delete(event.pointerId);
    if (activeMapPointers.size === 1) {
      const [pointerId, point] = activeMapPointers.entries().next().value;
      pinchGesture = null;
      mapDrag = mapZoom > MIN_MAP_ZOOM + .001
        ? { pointerId, x: point.x, y: point.y, panX: mapPanX, panY: mapPanY }
        : null;
    } else if (activeMapPointers.size >= 2) {
      const points = Array.from(activeMapPointers.values()).slice(0, 2);
      pinchGesture = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        centerX: (points[0].x + points[1].x) / 2,
        centerY: (points[0].y + points[1].y) / 2
      };
    } else {
      mapDrag = null; pinchGesture = null;
      if (mapGestureMoved) {
        ignoreNextMapClick = true;
        window.setTimeout(() => { ignoreNextMapClick = false; }, 0);
      }
      mapGestureMoved = false;
      canvas.style.cursor = mapZoom > MIN_MAP_ZOOM + .001 ? 'grab' : 'crosshair';
    }
  }
  canvas.addEventListener('pointerdown', beginMapPointer);
  canvas.addEventListener('pointermove', moveMapPointer);
  canvas.addEventListener('pointerup', endMapPointer);
  canvas.addEventListener('pointercancel', endMapPointer);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoomMapTo(mapZoom * Math.exp(-event.deltaY * .0015), event.clientX, event.clientY);
  }, { passive: false });
  $('mapZoomIn').addEventListener('click', () => zoomMapTo(mapZoom * 1.25));
  $('mapZoomOut').addEventListener('click', () => zoomMapTo(mapZoom / 1.25));
  $('mapZoomReset').addEventListener('click', resetMapViewport);

  canvas.addEventListener('click', event => {
    if (ignoreNextMapClick) { ignoreNextMapClick = false; return; }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * W);
    const y = Math.floor((event.clientY - rect.top) / rect.height * H);
    if (x >= 0 && x < W && y >= 0 && y < H) { showRight = true; $('rightPanel').classList.remove('is-collapsed'); openSelection(pickEntity(x, y)); }
  });

  function advanceWorldOneDay() {
    Sim.stepDay(world);
    if (localAI) localAI.pump(world);
  }

  $('toggle').addEventListener('click', () => { paused = !paused; render(); });
  $('step').addEventListener('click', () => { paused = true; advanceWorldOneDay(); render(); });
  $('localAiToggle').addEventListener('click', async () => {
    if (!localAI) return;
    if (localAI.isEnabled()) { localAI.disable(world); return; }
    try { await localAI.enable(world); } catch { render(); }
  });
  $('speed').addEventListener('change', e => { speed = Number(e.target.value) || 1; });
  $('layer').addEventListener('change', e => { layer = e.target.value; world.selectedLayer = layer; render(); });
  $('visualPackSelect').addEventListener('change', e => { visualPack = e.target.value; render(); });
  $('restart').addEventListener('click', () => {
    const requestedSeed = Number($('seedInput').value);
    const seed = Number.isFinite(requestedSeed) ? Math.min(0xffffffff, Math.max(1, Math.trunc(requestedSeed))) : 1;
    world = Sim.createWorld(seed); if (localAI) localAI.syncWorld(world); visualMotions.clear(); $('seedInput').value = seed; selection = null; accumulator = 0; paused = false; resetMapViewport(); render();
  });
  $('droughtTrigger').addEventListener('click', () => { Sim.modules.Atmosphere.triggerDrought(world, 90, .82); render(); });
  $('seedInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('restart').click(); });
  $('release').addEventListener('click', () => { Sim.addIndividuals(world, 6, false); render(); });
  $('journalToggle').addEventListener('click', () => {
    const panel = $('journal'), open = panel.hidden;
    panel.hidden = !open; $('journalToggle').setAttribute('aria-expanded', String(open));
  });
  $('journalClose').addEventListener('click', () => { $('journal').hidden = true; $('journalToggle').setAttribute('aria-expanded', 'false'); });
  $('leftClose').addEventListener('click', () => {
    showLeft = !showLeft; $('leftPanel').classList.toggle('is-collapsed', !showLeft);
    $('leftClose').textContent = showLeft ? '−' : '+';
  });
  $('rightClose').addEventListener('click', () => {
    showRight = false; $('rightPanel').classList.add('is-collapsed');
  });
  $('communityList').addEventListener('click', e => {
    const button = e.target.closest('[data-community]');
    if (button) { showRight = true; openSelection({ kind: 'community', id: Number(button.dataset.community) }); }
  });

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    const elapsed = Math.min(.25, (now - lastFrame) / 1000);
    lastFrame = now; animationTime = now;
    if (!paused) {
      accumulator += elapsed * speed;
      let days = Math.min(12, Math.floor(accumulator));
      if (days > 0) {
        accumulator -= days;
        for (let i = 0; i < days; i++) advanceWorldOneDay();
        render();
      }
    }
    if (now - lastSpriteDraw >= 1000 / 24) {
      lastSpriteDraw = now;
      drawMap();
    }
    window.requestAnimationFrame(frame);
  }

  updateMapViewport();
  render();
  window.requestAnimationFrame(frame);
})();
