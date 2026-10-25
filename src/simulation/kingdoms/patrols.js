import { selectHealingTarget, MILITARY_CLASSES } from './military.js';
import { distance } from '../core/math.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { cellAt } from '../world/spatial.js';
import { isRoadTile } from '../world/roads.js';
import { moveOne } from '../individuals/movement.js';
import { militaryDutyCenterFor } from './service.js';

const PATROL_ROUTE_REFRESH_DAYS = 21;
const PATROL_ROAD_RADIUS = 15;
const PATROL_NEEDS = Object.freeze({ food: 26, hydration: 22, energy: 24, health: 42 });

function dutyPost(world, soldier) {
  const assignedFrontier = world.structures.find(structure => structure.id === soldier.militaryDutyPostId
    && structure.complete && structure.type === 'torre' && structure.frontierOutpost
    && structure.kingdomId === soldier.kingdomId);
  if (assignedFrontier) return assignedFrontier;
  const towers = world.structures.filter(s => s.type === 'torre' && s.complete && s.kingdomId === soldier.kingdomId && s.integrity > 0);
  const enemy = world.kingdoms.find(k => k.id !== soldier.kingdomId);
  towers.sort((a, b) => (enemy ? distance(a, enemy) - distance(b, enemy) : a.id - b.id));
  if (towers.length) {
    const unit = world.kingdoms.find(k => k.id === soldier.kingdomId)?.militaryCommand?.units.find(u => u.id === soldier.militaryUnitId);
    return towers[(unit ? Number(unit.memberIds[0]) : soldier.id) % Math.min(2, towers.length)];
  }
  const kingdom = world.kingdoms.find(item => item.id === soldier.kingdomId);
  const center = militaryDutyCenterFor(world, soldier);
  const castleId = kingdom && world.settlements.find(settlement => settlement.kingdomId === kingdom.id)?.castleId;
  return center || (castleId && world.structures.find(structure => structure.id === castleId && structure.complete)) || null;
}

function roadCheckpoints(world, post, kingdomId) {
  const checkpoints = [];
  const radius = PATROL_ROAD_RADIUS;
  const centerX = Math.round(post.x), centerY = Math.round(post.y);
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      const tile = cellAt(world, x, y);
      if (!tile || tile.kingdomId !== kingdomId || tile.terrain !== 'land'
          || distance(tile, post) < 3 || !isRoadTile(tile) || isTreeAnchor(world, tile)) continue;
      checkpoints.push(tile);
    }
  }
  checkpoints.sort((a, b) => Math.atan2(a.y - post.y, a.x - post.x) - Math.atan2(b.y - post.y, b.x - post.x)
    || distance(a, post) - distance(b, post));
  const selected = [];
  for (const tile of checkpoints) {
    if (selected.some(other => distance(tile, other) < 4)) continue;
    selected.push(tile);
    if (selected.length === 10) break;
  }
  return selected.length >= 3 ? selected : [];
}

function perimeterCheckpoints(world, post, kingdomId) {
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  const selected = [];
  for (const [dx, dy] of directions) {
    const length = Math.hypot(dx, dy);
    const desiredX = post.x + dx / length * 5.5;
    const desiredY = post.y + dy / length * 5.5;
    let best = null, bestScore = Infinity;
    for (let y = Math.floor(desiredY) - 3; y <= Math.ceil(desiredY) + 3; y++) {
      for (let x = Math.floor(desiredX) - 3; x <= Math.ceil(desiredX) + 3; x++) {
        const tile = cellAt(world, x, y);
        if (!tile || tile.kingdomId !== kingdomId || tile.terrain !== 'land' || isTreeAnchor(world, tile)) continue;
        const fromPost = distance(tile, post);
        if (fromPost < 3 || fromPost > 9 || selected.some(other => distance(tile, other) < 2.5)) continue;
        const score = Math.hypot(tile.x - desiredX, tile.y - desiredY) + tile.slope * .12;
        if (score < bestScore) { best = tile; bestScore = score; }
      }
    }
    if (best) selected.push(best);
  }
  return selected;
}

function routeFor(world, soldier, post) {
  const refresh = !Array.isArray(soldier.patrolRoute) || soldier.patrolRoute.length < 2
    || soldier.patrolCenterId !== post.id
    || world.day - (soldier.patrolRouteDay ?? -PATROL_ROUTE_REFRESH_DAYS) >= PATROL_ROUTE_REFRESH_DAYS;
  if (refresh) {
    const previousTarget = soldier.patrolCenterId === post.id
      ? world.tiles[soldier.patrolRoute?.[soldier.patrolWaypointIndex || 0]] : null;
    const border = borderPatrolCheckpoints(world, soldier.kingdomId);
    const checkpoints = border.length >= 3 ? border : roadCheckpoints(world, post, soldier.kingdomId);
    const route = checkpoints.length ? checkpoints : perimeterCheckpoints(world, post, soldier.kingdomId);
    soldier.patrolBorderRoute = border.length >= 3;
    soldier.patrolRoute = route.map(tile => tile.i);
    soldier.patrolCenterId = post.id;
    soldier.patrolRouteDay = world.day;
    soldier.patrolWaypointIndex = previousTarget && route.length
      ? route.indexOf(route.slice().sort((a, b) => distance(a, previousTarget) - distance(b, previousTarget))[0])
      : soldier.id % Math.max(1, route.length);
  }
  const route = (soldier.patrolRoute || []).map(index => world.tiles[index])
    .filter(tile => tile && tile.kingdomId === soldier.kingdomId && tile.terrain === 'land' && !isTreeAnchor(world, tile));
  return route;
}

export function borderPatrolCheckpoints(world, kingdomId) {
  const kingdom = world.kingdoms.find(k => k.id === kingdomId);
  if (!kingdom) return [];
  const sectors = new Map();
  for (const tile of world.tiles) {
    if (tile.kingdomId !== kingdomId || tile.terrain !== 'land' || isTreeAnchor(world, tile)) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cellAt(world, tile.x + dx, tile.y + dy)?.kingdomId !== kingdomId)) continue;
    const sector = Math.floor((Math.atan2(tile.y - kingdom.y, tile.x - kingdom.x) + Math.PI) / (Math.PI * 2) * 16) % 16;
    const existing = sectors.get(sector);
    if (!existing || distance(tile, kingdom) > distance(existing, kingdom)) sectors.set(sector, tile);
  }
  return [...sectors.entries()].sort(([a], [b]) => a - b).map(([, tile]) => tile);
}

export function patrolSoldier(world, soldier) {
  if (!soldier || !soldier.alive || soldier.role !== 'soldier' || soldier.kingdomId == null) return false;
  if (soldier.militaryClass === 'monge') {
    const patient = selectHealingTarget(soldier, world.people, 12);
    if (patient) {
      if (distance(soldier, patient) > MILITARY_CLASSES.monge.range - 1) moveOne(world, soldier, patient, false);
      soldier.state = 'priorizando aliados feridos';
      return true;
    }
  }
  const post = dutyPost(world, soldier);
  if (!post) {
    soldier.state = 'sem posto de patrulha';
    return false;
  }
  const route = routeFor(world, soldier, post);
  if (!soldier.patrolBorderRoute && distance(soldier, post) > 8) {
    const moved = moveOne(world, soldier, post, false, { allowedTile: tile => tile.kingdomId === soldier.kingdomId, preferRoads: true });
    soldier.state = 'patrulhando a fronteira';
    return moved;
  }
  if (route.length < 2) {
    soldier.state = 'aguardando uma rota segura';
    return false;
  }
  let index = Math.max(0, soldier.patrolWaypointIndex || 0) % route.length;
  let target = route[index];
  if (distance(soldier, target) <= 1.1) {
    index = (index + 1) % route.length;
    soldier.patrolWaypointIndex = index;
    target = route[index];
  }
  const moved = moveOne(world, soldier, target, false, {
    allowedTile: tile => tile.kingdomId === soldier.kingdomId,
    preferRoads: true
  });
  if (moved) {
    soldier.patrolStallDays = 0;
    soldier.state = soldier.patrolBorderRoute ? 'patrulhando a fronteira exterior' : isRoadTile(cellAt(world, soldier.x, soldier.y)) ? 'patrulhando as estradas do reino' : 'patrulhando o território';
    soldier.lastLesson = 'A patrulha percorre caminhos seguros do próprio reino. O tráfego recorrente pode consolidar essas trilhas em estradas.';
    return true;
  }
  soldier.patrolStallDays = (soldier.patrolStallDays || 0) + 1;
  if (soldier.patrolStallDays >= 3) {
    soldier.patrolWaypointIndex = (index + 1) % route.length;
    soldier.patrolStallDays = 0;
  }
  soldier.state = 'aguardando uma rota segura';
  return false;
}

export function canPatrolToday(world, soldier, hasAssignment) {
  const post = dutyPost(world, soldier);
  const kingdom = world.kingdoms.find(item => item.id === soldier.kingdomId);
  const authorizedByStrategy = !kingdom || !kingdom.strategy || kingdom.strategy.garrisonMode !== 'standby'
    || kingdom.frontierAlert && world.day - kingdom.frontierAlert.day <= 10
    || (Math.floor(world.day / 7) + soldier.id) % 3 === 0;
  const postRange = post && post.id === soldier.militaryDutyPostId ? 30 : 22;
  return soldier.role === 'soldier' && !!post && !hasAssignment
    && authorizedByStrategy
    && soldier.foodReserve >= PATROL_NEEDS.food && soldier.hydration >= PATROL_NEEDS.hydration
    && soldier.energy >= PATROL_NEEDS.energy && soldier.health >= PATROL_NEEDS.health
    && (soldier.injury || 0) < 5 && !soldier.leadingSheepId

    && (world.day + soldier.id) % 3 !== 0;
}
