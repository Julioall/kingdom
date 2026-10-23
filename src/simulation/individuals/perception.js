function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function tileAt(world, x, y) {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
    return world.tiles[Math.floor(y) * world.width + Math.floor(x)] || null;
  }
  function canopyAt(tile, plantProfiles) {
    if (!tile || !tile.plants) return 0;
    let cover = 0;
    for (let i = 0; i < plantProfiles.length; i++) {
      const plant = plantProfiles[i];
      cover += tile.plants[i] * (plant.canopy || 0) / Math.max(1, plant.max || 1);
    }
    return Math.max(0, Math.min(.95, cover));
  }
  function inFieldOfView(observer, target, fieldOfViewDegrees) {
    const hx = observer.headingX || 0, hy = observer.headingY || 0;
    const headingLength = Math.hypot(hx, hy);
    if (headingLength < .01 || fieldOfViewDegrees >= 359) return true;
    const dx = target.x - observer.x, dy = target.y - observer.y;
    const length = Math.hypot(dx, dy);
    if (length < .01) return true;
    const dot = (hx * dx + hy * dy) / (headingLength * length);
    return dot >= Math.cos(fieldOfViewDegrees * Math.PI / 360);
  }
  function lineOfSight(world, observer, target, plantProfiles) {
    let x0 = Math.round(observer.x), y0 = Math.round(observer.y);
    const x1 = Math.round(target.x), y1 = Math.round(target.y);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (x0 !== x1 || y0 !== y1) {
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) break;
      if (canopyAt(tileAt(world, x0, y0), plantProfiles) >= .61) return false;
    }
    return true;
  }
  function visibilityFactor(world, observer) {
    const tile = tileAt(world, observer.x, observer.y);
    const region = tile && world.regions[tile.regionId];
    if (!region) return 1;
    if (region.weather === 'rain') return .78;
    if (region.humidity > .94) return .88;
    return 1;
  }
  function observe(world, observer, kind, plantProfiles) {
    const animal = kind === 'animal';
    const baseRange = animal ? 7 : 10;
    const fieldOfView = animal ? 300 : 210;
    const range = baseRange * visibilityFactor(world, observer);
    const resourceRange = animal ? 5 : 8;
    const memoryDays = animal ? 3 : 5;
    const memory = observer.sensoryMemory || (observer.sensoryMemory = { actors: {}, water: [], logs: {} });
    const visibleAnimals = [];
    const visiblePeople = [];
    const seenKeys = new Set();
    function inspect(list, targetKind) {
      for (const target of list) {
        if (!target.alive || target.id === observer.id) continue;
        const d = distance(observer, target);
        if (d > range || !inFieldOfView(observer, target, fieldOfView)
            || !lineOfSight(world, observer, target, plantProfiles)) continue;
        const key = targetKind + ':' + target.id;
        seenKeys.add(key);
        const sighting = { id: target.id, kind: targetKind, speciesId: target.speciesId || null,
          x: target.x, y: target.y, distance: d, visible: true, confidence: 1, lastSeenDay: world.day };
        memory.actors[key] = { id: target.id, kind: targetKind, speciesId: sighting.speciesId,
          x: target.x, y: target.y, lastSeenDay: world.day };
        (targetKind === 'animal' ? visibleAnimals : visiblePeople).push(sighting);
      }
    }
    inspect(world.animals, 'animal');
    inspect(world.people, 'person');
    const rememberedAnimals = [], rememberedPeople = [];
    for (const [key, last] of Object.entries(memory.actors)) {
      if (seenKeys.has(key)) continue;
      const age = Math.max(0, world.day - last.lastSeenDay);
      if (age > memoryDays) { delete memory.actors[key]; continue; }
      const entityStillAlive = last.kind === 'animal'
        ? world.animals.some(a => a.id === last.id && a.alive)
        : world.people.some(p => p.id === last.id && p.alive);
      if (!entityStillAlive) { delete memory.actors[key]; continue; }
      const remembered = { id: last.id, kind: last.kind, speciesId: last.speciesId,
        x: last.x, y: last.y, distance: distance(observer, last), visible: false,
        confidence: Math.exp(-age / Math.max(1, memoryDays * .65)), lastSeenDay: last.lastSeenDay };
      (last.kind === 'animal' ? rememberedAnimals : rememberedPeople).push(remembered);
    }
    const resources = [];
    const r = Math.ceil(resourceRange);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(observer.x) + dx, y = Math.round(observer.y) + dy;
      const tile = tileAt(world, x, y);
      if (!tile) continue;
      const d = Math.hypot(x - observer.x, y - observer.y);
      if (d > resourceRange || !inFieldOfView(observer, { x, y }, fieldOfView)
          || !lineOfSight(world, observer, { x, y }, plantProfiles)) continue;
      const biomass = {};
      for (let i = 0; i < plantProfiles.length; i++) {
        const amount = tile.plants[i] || 0;
        if (amount > .8) biomass[plantProfiles[i].id] = amount;
      }
      const surfaceWaterMm = tile.surfaceWaterMm || 0;
      if (tile.terrain === 'water' || surfaceWaterMm >= 1.5 || Object.keys(biomass).length || tile.stoneDeposit > 0 || tile.goldOre > 0) {
        resources.push({ x, y, tileIndex: tile.i, distance: d, visible: true, terrain: tile.terrain,
          biomass, stone: tile.stoneDeposit || 0, goldOre: tile.goldOre || 0,
          surfaceWaterMm, waterSource: tile.terrain === 'water' ? 'lake' : surfaceWaterMm >= 1.5 ? 'runoff' : null,
          soilMoisture: tile.soilWaterMm / Math.max(1, tile.soilCapacityMm), slope: tile.slope || 0 });
      }
    }
    const water = resources.filter(resource => resource.waterSource);
    const rememberedWater = new Map((memory.water || []).map(point => [point.x + ',' + point.y, point]));
    for (const resource of water) rememberedWater.set(resource.x + ',' + resource.y,
      { x: resource.x, y: resource.y, source: resource.waterSource, lastSeenDay: world.day });
    memory.water = [...rememberedWater.values()].filter(point => world.day - point.lastSeenDay <= (point.source === 'lake' ? 20 : 1));
    memory.logs = memory.logs || {};
    const visibleLogs = [];
    const seenLogs = new Set();
    for (const item of world.logs || []) {
      if (!item.available || item.amount <= .01) continue;
      const d = distance(observer, item);
      if (d > resourceRange || !inFieldOfView(observer, item, fieldOfView)
          || !lineOfSight(world, observer, item, plantProfiles)) continue;
      const seen = { id: item.id, x: item.x, y: item.y, amount: item.amount, distance: d,
        visible: true, confidence: 1, lastSeenDay: world.day };
      memory.logs[item.id] = seen;
      seenLogs.add(String(item.id));
      visibleLogs.push(seen);
    }
    const rememberedLogs = [];
    for (const [id, last] of Object.entries(memory.logs)) {
      if (seenLogs.has(String(id))) continue;
      const age = Math.max(0, world.day - last.lastSeenDay);
      if (age > memoryDays || !(world.logs || []).some(item => String(item.id) === String(id) && item.available && item.amount > .01)) {
        delete memory.logs[id]; continue;
      }
      rememberedLogs.push({ id: last.id, x: last.x, y: last.y, amount: last.amount,
        distance: distance(observer, last), visible: false,
        confidence: Math.exp(-age / Math.max(1, memoryDays * .65)), lastSeenDay: last.lastSeenDay });
    }
    memory.storages = memory.storages || {};
    const visibleStorageKeys = new Set();
    if (!animal) {
      const sites = [];
      for (const shelter of world.structures || []) {
        if (!shelter.complete || shelter.type !== 'abrigo') continue;
        const d = distance(observer, shelter);
        if (d > 22 || !inFieldOfView(observer, shelter, fieldOfView)
            || !lineOfSight(world, observer, shelter, plantProfiles)) continue;
        sites.push({ id: shelter.id, communityId: shelter.communityId, kind: 'shelter', x: shelter.x, y: shelter.y });
      }
      for (const community of world.communities || []) {
        if (community.dissolved) continue;
        const d = distance(observer, community);
        if (d > 16 || !inFieldOfView(observer, community, fieldOfView)
            || !lineOfSight(world, observer, community, plantProfiles)) continue;
        sites.push({ id: community.id, communityId: community.id, kind: 'community', x: community.x, y: community.y });
      }
      for (const site of sites) {
        const key = site.kind + ':' + site.id;
        visibleStorageKeys.add(key);
        memory.storages[key] = Object.assign({}, site, { lastSeenDay: world.day });
      }
    }
    const knownStorages = [];
    for (const [key, site] of Object.entries(memory.storages)) {
      const age = Math.max(0, world.day - site.lastSeenDay);
      const stillExists = site.kind === 'shelter'
        ? (world.structures || []).some(s => s.id === site.id && s.complete && s.type === 'abrigo')
        : (world.communities || []).some(c => c.id === site.communityId && !c.dissolved);
      if (!stillExists || age > 30) { delete memory.storages[key]; continue; }
      knownStorages.push({ id: site.id, communityId: site.communityId, kind: site.kind, x: site.x, y: site.y,
        distance: distance(observer, site), visible: visibleStorageKeys.has(key), lastSeenDay: site.lastSeenDay,
        confidence: Math.exp(-age / 18) });
    }
    let territorialAwareness = null;
    if (!animal) {
      const currentTile = tileAt(world, observer.x, observer.y);
      const ownKingdom = world.kingdoms && world.kingdoms.find(kingdom => kingdom.id === observer.kingdomId);
      const currentOwner = currentTile && world.kingdoms && world.kingdoms.find(kingdom => kingdom.id === currentTile.kingdomId);
      let nearestForeign = null;
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
        const tile = tileAt(world, observer.x + dx, observer.y + dy);
        if (!tile || tile.kingdomId == null || tile.kingdomId === observer.kingdomId) continue;
        const d = distance(observer, tile);
        if (d > range || !inFieldOfView(observer, tile, fieldOfView)
            || !lineOfSight(world, observer, tile, plantProfiles)) continue;
        if (!nearestForeign || d < nearestForeign.distance) {
          const owner = world.kingdoms.find(kingdom => kingdom.id === tile.kingdomId);
          nearestForeign = { kingdomId: tile.kingdomId, name: owner ? owner.name : 'outro reino', distance: d };
        }
      }
      const inForeignTerritory = !!currentOwner && currentOwner.id !== observer.kingdomId;
      territorialAwareness = {
        ownKingdom: ownKingdom ? ownKingdom.name : 'sem reino',
        currentOwnerId: currentTile ? currentTile.kingdomId : null,
        currentOwner: currentTile && currentTile.kingdomId == null ? 'terra comum'
          : currentOwner ? currentOwner.name : 'território do próprio reino',
        inForeignTerritory,
        nearestForeignTerritory: nearestForeign,
        warning: inForeignTerritory || !!(nearestForeign && nearestForeign.distance <= 2)
          || !!(observer.territoryAwareness && observer.territoryAwareness.warning),
        warningText: inForeignTerritory
          ? 'Você está em território de ' + currentOwner.name + '; guardas podem expulsar ou matar invasores e provocar guerra.'
          : nearestForeign && nearestForeign.distance <= 2
            ? 'A fronteira de ' + nearestForeign.name + ' está próxima; atravessá-la pode ser perigoso.'
            : observer.territoryAwareness && observer.territoryAwareness.caught
              ? 'Você foi expulso de território estrangeiro recentemente; uma nova incursão pode ser mais perigosa.' : null
      };
    }
    return {
      day: world.day, range, fieldOfViewDegrees: fieldOfView,
      animals: visibleAnimals.concat(rememberedAnimals), people: visiblePeople.concat(rememberedPeople),
      resources, logs: visibleLogs.concat(rememberedLogs), knownWater: memory.water.map(point => ({ x: point.x, y: point.y, source: point.source,
        distance: distance(observer, point), visible: world.day - point.lastSeenDay <= 0,
        confidence: Math.exp(-Math.max(0, world.day - point.lastSeenDay) / (point.source === 'lake' ? 12 : .8)), lastSeenDay: point.lastSeenDay })),
      knownStorages, territorialAwareness
    };
  }
  export default { observe, lineOfSight, inFieldOfView, canopyAt };
