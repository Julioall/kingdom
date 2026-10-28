import { PLANTS } from '../../config/ecosystem.js';

const PROPERTY_MEASURES = Object.freeze({
  food: { resource: 'food', unit: 'food-unit' },
  meat: { resource: 'meat', unit: 'meat-unit' },
  feed: { resource: 'feed', unit: 'feed-unit' },
  seeds: { resource: 'seeds', unit: 'seed-unit' },
  foodReserve: { resource: 'food', unit: 'person-day', accountKind: 'personal-reserve' },
  carriedFood: { resource: 'food', unit: 'food-unit', accountKind: 'carried-food' },
  carriedFruit: { resource: 'food', unit: 'food-unit', accountKind: 'carried-food' },
  carriedMeat: { resource: 'meat', unit: 'meat-unit', accountKind: 'carried-meat' },
  carriedFeed: { resource: 'feed', unit: 'feed-unit', accountKind: 'carried-feed' },
  cropSeedStored: { resource: 'seeds', unit: 'seed-unit', accountKind: 'field-seed-stock' },
  fruitStored: { resource: 'food', unit: 'food-unit', accountKind: 'location-mirror', conserved: false },
  meatStored: { resource: 'meat', unit: 'meat-unit', accountKind: 'location-mirror', conserved: false },
  militaryFoodPurchased: { resource: 'food', unit: 'food-unit', accountKind: 'cumulative-counter', conserved: false }
});

const STOCK_PROPERTIES = Object.freeze(['food', 'meat', 'feed', 'seeds']);
let activeAudit = null;

function measureFor(property) { return PROPERTY_MEASURES[property] || null; }
function hasTrackedResource(value) { return !!measureFor(value); }
function finite(value) { return Number.isFinite(value) ? value : 0; }
function rounded(value) { return Number(finite(value).toFixed(6)); }
function resourceAmounts(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).filter(([, amount]) => Number.isFinite(amount))
    .map(([resource, amount]) => [resource, rounded(amount)]));
}

function codeLocation() {
  const frames = String(new Error().stack || '').split('\n').slice(1);
  const frame = frames.find(line => !line.includes('food-audit-ledger.js')
    && !line.includes('node:internal') && !line.includes('inventories.js'));
  return frame?.trim() || 'unknown';
}

function resourceFrom(property) { return measureFor(property)?.resource || null; }

function endpointPosition(endpoint, world) {
  const ref = endpoint?.positionRef;
  if (ref && Number.isFinite(ref.x) && Number.isFinite(ref.y)) return { x: ref.x, y: ref.y };
  const kingdomId = endpoint?.owner?.kingdomId ?? endpoint?.owner?.id;
  const community = (world?.communities || []).find(item => item.kingdomId === kingdomId || item.id === endpoint?.owner?.communityId);
  return community && Number.isFinite(community.x) && Number.isFinite(community.y)
    ? { x: community.x, y: community.y } : null;
}

function cleanEndpoint(meta, world) {
  if (!meta) return null;
  const position = endpointPosition(meta, world);
  return {
    ownerType: meta.ownerType,
    ownerId: meta.ownerId ?? null,
    ownerName: meta.ownerName ?? null,
    communityId: meta.communityId ?? null,
    kingdomId: meta.kingdomId ?? null,
    account: meta.accountName ?? null,
    position
  };
}

function movementRoute(operation, world) {
  const actor = operation?.actorRef
    || (operation?.sourceMeta?.ownerType === 'person' ? operation.sourceMeta.ownerRef : null)
    || (operation?.destinationMeta?.ownerType === 'person' ? operation.destinationMeta.ownerRef : null);
  const source = endpointPosition(operation?.sourceMeta, world) || operation?.sourcePosition
    || (actor && Number.isFinite(actor.x) && Number.isFinite(actor.y) ? { x: actor.x, y: actor.y } : null);
  const destination = endpointPosition(operation?.destinationMeta, world) || operation?.destinationPosition;
  const straightLineDistance = source && destination
    ? Math.hypot(destination.x - source.x, destination.y - source.y) : null;
  const route = actor?.navigationRoute;
  const path = Array.isArray(route?.path) ? route.path : [];
  const cursor = Number.isInteger(route?.cursor) ? route.cursor : -1;
  const congestion = actor?.navigationCongestion || actor?.movementCongestion || actor?.routeCongestion || null;
  return {
    from: source,
    to: destination,
    straightLineDistance: straightLineDistance == null ? null : rounded(straightLineDistance),
    routeTiles: path.length || null,
    routeTilesRemaining: path.length ? Math.max(0, path.length - Math.max(0, cursor + 1)) : null,
    blockedDays: Number.isFinite(congestion?.blockedDays) ? congestion.blockedDays : null,
    routeTarget: route?.key ?? null
  };
}

function addMutation(audit, meta, before, after, operation = audit.currentOperation) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || Math.abs(after - before) < 1e-9) return;
  const measure = measureFor(meta.property);
  const entry = audit.accounts.get(meta.accountId);
  const mutation = {
    day: audit.day,
    accountIndex: entry?.index,
    before: rounded(before),
    delta: rounded(after - before),
    after: rounded(after),
    operationId: operation?.id ?? null,
    category: operation?.category ?? 'unclassified-direct-write',
    callsite: operation?.callsite ?? codeLocation()
  };
  audit.dayMutations.push(mutation);
  if (operation) operation.changes.push([mutation.accountIndex, mutation.before, mutation.delta, mutation.after]);
  else {
    const directOperation = {
      id: audit.nextOperationId++, day: audit.day, kind: 'direct-mutation',
      category: 'unclassified-direct-write', resource: measure.resource, unit: measure.unit,
      owner: entry?.index ?? null, changes: [[mutation.accountIndex, mutation.before, mutation.delta, mutation.after]], callsite: mutation.callsite,
      status: 'observed'
    };
    audit.operations.push(directOperation);
    audit.dayOperations.push(directOperation);
  }
}

function ownerMeta(ownerType, owner, accountName, positionRef = owner) {
  const kingdomId = owner?.kingdomId ?? (ownerType === 'kingdom' ? owner?.id : null);
  const communityId = owner?.communityId ?? (ownerType === 'community' ? owner?.id : null);
  return {
    ownerType, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null,
    kingdomId: kingdomId ?? null, communityId: communityId ?? null,
    ownerRef: owner, positionRef, accountName
  };
}

function makeAccountMeta(base, accountName, property) {
  const measure = measureFor(property);
  const accountId = [base.ownerType, base.ownerId ?? 'world', accountName, property].join(':');
  return { ...base, accountObjectRef: base.accountObjectRef ?? null, accountName, property, accountId,
    resource: measure.resource, unit: measure.unit };
}

function registerProperty(audit, object, property, base) {
  if (!object || typeof object !== 'object' || !Object.prototype.hasOwnProperty.call(object, property)) return;
  const measure = measureFor(property);
  if (!measure) return;
  let properties = audit.instrumented.get(object);
  if (!properties) { properties = new Set(); audit.instrumented.set(object, properties); }
  if (properties.has(property)) return;
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  if (!descriptor?.configurable || !('value' in descriptor)) {
    audit.uninstrumentedProperties.push({ ownerType: base.ownerType, ownerId: base.ownerId ?? null,
      property, reason: 'non-configurable-or-accessor' });
    return;
  }
  const meta = makeAccountMeta({ ...base, accountObjectRef: object }, base.accountName, property);
  let current = descriptor.value;
  if (!Number.isFinite(current)) return;
  const entry = { meta, get: () => current, index: audit.accountCatalog.length };
  audit.accounts.set(meta.accountId, entry);
  audit.accountCatalog.push({
    index: entry.index, accountId: meta.accountId, ownerType: meta.ownerType, ownerId: meta.ownerId ?? null,
    ownerName: meta.ownerName ?? null, communityId: meta.communityId ?? null, kingdomId: meta.kingdomId ?? null,
    account: meta.accountName, resource: meta.resource, unit: meta.unit, property: meta.property,
    conserved: measure.conserved !== false
  });
  properties.add(property);
  let propertyMetadata = audit.propertyMeta.get(object);
  if (!propertyMetadata) { propertyMetadata = new Map(); audit.propertyMeta.set(object, propertyMetadata); }
  propertyMetadata.set(property, meta);
  const isNewDuringDay = audit.day != null && !audit.openingSnapshot?.has(entry.index);
  Object.defineProperty(object, property, {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() { return current; },
    set(value) {
      const previous = current;
      current = value;
      if (activeAudit === audit) addMutation(audit, meta, previous, value);
    }
  });
  audit.restore.push(() => Object.defineProperty(object, property, { ...descriptor, value: current }));
  if (isNewDuringDay && current !== 0) {
    const parent = audit.currentOperation;
    const operation = {
      id: audit.nextOperationId++, parentId: parent?.id ?? null, day: audit.day, kind: 'inventory-created',
      category: parent?.category || 'initial-stock-on-new-entity', resource: meta.resource, unit: meta.unit,
      requested: rounded(current), source: parent?.source || { ownerType: 'system-source', ownerId: 'entity-initialization' },
      destination: parent?.destination ?? entry.index,
      changes: [], childIds: [], blockers: [], callsite: codeLocation(), status: 'initialized'
    };
    if (parent) parent.childIds.push(operation.id);
    audit.operations.push(operation);
    audit.dayOperations.push(operation);
    addMutation(audit, meta, 0, current, operation);
  }
}

function registerAccountObject(audit, object, base, allowed = STOCK_PROPERTIES) {
  if (!object || typeof object !== 'object') return;
  audit.objectOwner.set(object, { ...base, accountObjectRef: object });
  audit.accountName.set(object, base.accountName);
  for (const property of allowed) if (hasTrackedResource(property)) registerProperty(audit, object, property, base);
}

function registerPerson(audit, person) {
  if (!person || typeof person !== 'object') return;
  const base = ownerMeta('person', person, 'person-reserves-and-cargo', person);
  for (const property of ['foodReserve', 'carriedFood', 'carriedFruit', 'carriedMeat', 'carriedFeed', 'militaryFoodPurchased']) {
    registerProperty(audit, person, property, { ...base, accountName: property });
  }
}

function registerCommunity(audit, community) {
  if (!community || typeof community !== 'object') return;
  registerAccountObject(audit, community.stores, ownerMeta('community', community, 'community-stores', community));
}

function registerKingdom(audit, kingdom) {
  if (!kingdom || typeof kingdom !== 'object') return;
  if (kingdom.treasury?.stock) registerAccountObject(audit, kingdom.treasury.stock,
    ownerMeta('kingdom', kingdom, 'treasury-stock', kingdom));
  if (kingdom.market?.stock) registerAccountObject(audit, kingdom.market.stock,
    ownerMeta('kingdom', kingdom, 'market-stock', kingdom.market));
}

function registerStructure(audit, structure) {
  if (!structure || typeof structure !== 'object') return;
  const base = ownerMeta('structure', structure, 'structure-storage', structure);
  registerProperty(audit, structure, 'cropSeedStored', { ...base, accountName: 'field-seed-stock' });
  registerProperty(audit, structure, 'fruitStored', { ...base, accountName: 'food-location-mirror' });
  registerProperty(audit, structure, 'meatStored', { ...base, accountName: 'meat-location-mirror' });
  registerAccountObject(audit, structure.stock, { ...base, accountName: 'structure-stock' });
  registerAccountObject(audit, structure.stores, { ...base, accountName: 'structure-stores' });
  registerAccountObject(audit, structure.inventory?.stock || structure.inventory,
    { ...base, accountName: 'structure-inventory' });
}

function registerCampaign(audit, campaign) {
  if (!campaign || typeof campaign !== 'object') return;
  for (const side of [campaign.attacker, campaign.defender]) registerCampaignSide(audit, campaign.id, side);
}

function registerCampaignSide(audit, campaignId, side) {
  if (!side?.supply?.stock) return;
  registerAccountObject(audit, side.supply.stock, {
    ownerType: 'campaign-side', ownerId: campaignId ?? side.campaignId, ownerName: side.role,
    kingdomId: side.kingdomId ?? null, communityId: null, ownerRef: side,
    positionRef: null, accountName: 'field-supply-' + side.role
  });
}

export function registerFoodAuditCampaignSide(side) {
  if (!activeAudit || !side?.supply?.stock) return;
  registerCampaignSide(activeAudit, side.campaignId ?? side.supply.ownerId, side);
}

function registerLoot(audit, pile) {
  if (!pile || typeof pile !== 'object') return;
  registerAccountObject(audit, pile.resources, ownerMeta('loot-pile', pile, 'dropped-loot', pile));
}

const COLLECTIONS = Object.freeze({
  people: registerPerson,
  communities: registerCommunity,
  kingdoms: registerKingdom,
  structures: registerStructure,
  campaigns: registerCampaign,
  loot: registerLoot
});

function refreshKnownEntities(audit) {
  for (const [collectionName, register] of Object.entries(COLLECTIONS)) {
    for (const entity of audit.world[collectionName] || []) register(audit, entity);
  }
  if (audit.world.market?.stock) registerAccountObject(audit, audit.world.market.stock,
    ownerMeta('world-market', audit.world.market, 'world-market-stock', audit.world.market));
  else registerAccountObject(audit, audit.world.market, ownerMeta('world-market', audit.world.market, 'world-market-stock', audit.world.market));
}

function wrapCollection(audit, collectionName) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(audit.world, collectionName);
  let target = audit.world[collectionName];
  let proxy = null;
  const makeProxy = value => {
    if (!Array.isArray(value)) { target = value; proxy = value; return value; }
    target = value;
    proxy = new Proxy(value, {
      set(array, property, next) {
        const result = Reflect.set(array, property, next, array);
        if (property !== 'length' && next && typeof next === 'object') COLLECTIONS[collectionName]?.(audit, next);
        return result;
      },
      deleteProperty(array, property) { return Reflect.deleteProperty(array, property); }
    });
    return proxy;
  };
  const current = makeProxy(target);
  Object.defineProperty(audit.world, collectionName, {
    configurable: true, enumerable: originalDescriptor?.enumerable ?? true,
    get() { return proxy; },
    set(value) {
      const wrapped = makeProxy(value);
      if (Array.isArray(wrapped)) for (const item of wrapped) COLLECTIONS[collectionName]?.(audit, item);
    }
  });
  if (Array.isArray(current)) for (const item of current) COLLECTIONS[collectionName]?.(audit, item);
  audit.restore.push(() => {
    const restored = target;
    if (originalDescriptor) Object.defineProperty(audit.world, collectionName, { ...originalDescriptor,
      ...(Object.prototype.hasOwnProperty.call(originalDescriptor, 'value') ? { value: restored } : {}) });
    else Object.defineProperty(audit.world, collectionName, {
      configurable: true, enumerable: true, writable: true, value: restored
    });
  });
}

function snapshotAccounts(audit) {
  const snapshot = new Map();
  for (const entry of audit.accounts.values()) snapshot.set(entry.index, finite(entry.get()));
  return snapshot;
}

function liveOwnerIds(world) {
  const ids = new Set();
  for (const [type, collection] of [['person', world.people], ['community', world.communities],
    ['kingdom', world.kingdoms], ['structure', world.structures], ['campaign-side', world.campaigns], ['loot-pile', world.loot]]) {
    for (const entity of collection || []) if (entity?.id != null) ids.add(type + ':' + entity.id);
  }
  ids.add('world-market:world');
  return ids;
}

function inaccessibleReason(meta, world, ownerIds) {
  if (meta.ownerType === 'person' && meta.ownerRef?.alive === false) return 'owner-dead';
  if (meta.ownerType === 'community' && meta.ownerRef?.dissolved) return 'community-dissolved';
  if (meta.ownerType === 'structure' && (meta.ownerRef?.destroyedDay != null || meta.ownerRef?.integrity === 0)) return 'structure-destroyed';
  const key = meta.ownerType === 'world-market' ? 'world-market:world' : meta.ownerType + ':' + (meta.ownerId ?? 'world');
  return ownerIds.has(key) ? null : 'owner-removed-from-world';
}

function finishDay(audit) {
  refreshKnownEntities(audit);
  const closing = snapshotAccounts(audit);
  const ownerIds = liveOwnerIds(audit.world);
  const dailyDelta = new Map();
  const changesByAccount = new Map();
  for (const mutation of audit.dayMutations) {
    dailyDelta.set(mutation.accountIndex, (dailyDelta.get(mutation.accountIndex) || 0) + mutation.delta);
    const changes = changesByAccount.get(mutation.accountIndex) || [];
    changes.push(mutation);
    changesByAccount.set(mutation.accountIndex, changes);
  }
  let unbalancedAccountDays = 0;
  let accountDays = 0;
  for (const [accountId, entry] of audit.accounts) {
    const opening = audit.openingSnapshot.get(entry.index) ?? 0;
    const ending = closing.get(entry.index) ?? 0;
    const eventDelta = dailyDelta.get(entry.index) || 0;
    const difference = ending - opening - eventDelta;
    const meta = entry.meta;
    if (measureFor(meta.property)?.conserved !== false) {
      accountDays++;
      if (Math.abs(difference) > 1e-5) unbalancedAccountDays++;
    }
    const changes = changesByAccount.get(entry.index) || [];
    const inflows = changes.filter(item => item.delta > 0).reduce((sum, item) => sum + item.delta, 0);
    const outflows = changes.filter(item => item.delta < 0).reduce((sum, item) => sum - item.delta, 0);
    const inaccessible = inaccessibleReason(meta, audit.world, ownerIds);
    audit.dailyBalances.push([audit.day, entry.index, rounded(opening), rounded(inflows), rounded(outflows),
      rounded(eventDelta), rounded(ending), rounded(difference), inaccessible == null, inaccessible, changes.length]);
  }
  audit.daySummaries.push({ day: audit.day, accountCount: audit.accounts.size,
    mutationCount: audit.dayMutations.length, operationCount: audit.dayOperations.length,
    blockedOperationCount: audit.dayBlockedOperations.length, accountDays, unbalancedAccountDays });
  audit.totalAccountDays += accountDays;
  audit.unbalancedAccountDays += unbalancedAccountDays;
  audit.openingSnapshot = closing;
}

function interestedIn(operation) {
  if (!operation || typeof operation !== 'object') return false;
  if (hasTrackedResource(operation.resource) || resourceFrom(operation.resource)) return true;
  if (hasTrackedResource(operation.sourceResource) || hasTrackedResource(operation.destinationResource)) return true;
  return Object.keys(operation.costs || {}).some(hasTrackedResource)
    || Object.keys(operation.firstGives || {}).some(hasTrackedResource)
    || Object.keys(operation.secondGives || {}).some(hasTrackedResource)
    || Array.isArray(operation.resources) && operation.resources.some(hasTrackedResource);
}

function endpointMeta(audit, account, property) {
  if (!account || typeof account !== 'object') return null;
  const properties = audit.propertyMeta.get(account);
  if (property && properties?.has(property)) return properties.get(property);
  if (property && properties) {
    const resource = resourceFrom(property);
    if (resource) return [...properties.values()].find(meta => meta.resource === resource) || null;
  }
  return properties?.values().next().value || audit.objectOwner.get(account) || null;
}

export function withFoodAuditOperation(details, action) {
  const audit = activeAudit;
  if (!audit || !interestedIn(details)) return action();
  const parent = audit.currentOperation;
  const resourceProperty = details.resource || [...Object.keys(details.costs || {}),
    ...Object.keys(details.firstGives || {}), ...Object.keys(details.secondGives || {})].find(hasTrackedResource);
  for (const endpoint of [details.sourceAccount, details.destinationAccount]) {
    if (endpoint && typeof endpoint === 'object' && Object.prototype.hasOwnProperty.call(endpoint, 'foodReserve')
      && !audit.propertyMeta.get(endpoint)?.has('foodReserve')) registerPerson(audit, endpoint);
  }
  const sourceMeta = endpointMeta(audit, details.sourceAccount, details.sourceResource || resourceProperty);
  const destinationMeta = endpointMeta(audit, details.destinationAccount, details.destinationResource || resourceProperty);
  const operation = {
    id: audit.nextOperationId++, parentId: parent?.id ?? null, day: audit.day,
    kind: details.kind || 'inventory-operation', category: details.category || 'unspecified',
    resource: measureFor(resourceProperty)?.resource || resourceProperty || null,
    sourceResource: details.sourceResource || resourceProperty || null,
    destinationResource: details.destinationResource || resourceProperty || null,
    costs: resourceAmounts(details.costs),
    firstGives: resourceAmounts(details.firstGives),
    secondGives: resourceAmounts(details.secondGives),
    destinationCapacity: Number.isFinite(details.capacity) ? rounded(details.capacity) : null,
    requested: Number.isFinite(details.amount) ? rounded(details.amount)
      : Number.isFinite(details.costs?.[resourceProperty]) ? rounded(details.costs[resourceProperty]) : null,
    requestedByResource: details.requestedByResource || null,
    source: sourceMeta ? audit.accounts.get(sourceMeta.accountId)?.index ?? null : details.source
      || (details.kind === 'add' ? { type: 'unattributed-source', category: details.category ?? 'inventory-add' } : null),
    destination: destinationMeta ? audit.accounts.get(destinationMeta.accountId)?.index ?? null : details.destination
      || (details.kind === 'spend' ? { type: 'consumption-sink', category: details.category ?? 'inventory-spend' } : null),
    sourceMeta, destinationMeta, actorId: details.actor?.id ?? details.actorId ?? null,
    route: null, changes: [], childIds: [], blockers: [], callsite: codeLocation(), status: 'pending'
  };
  operation.route = movementRoute({ ...operation, actorRef: details.actor,
    sourcePosition: details.sourcePosition, destinationPosition: details.destinationPosition }, audit.world);
  delete operation.sourceMeta;
  delete operation.destinationMeta;
  if (parent) parent.childIds.push(operation.id);
  audit.operations.push(operation);
  audit.dayOperations.push(operation);
  audit.currentOperation = operation;
  let result;
  try {
    result = action();
    operation.result = typeof result === 'boolean' || typeof result === 'number' || typeof result === 'string' ? result : null;
    const observed = Math.max(operation.changes.filter(change => change[2] > 0)
      .reduce((sum, change) => sum + change[2], 0),
    operation.changes.filter(change => change[2] < 0)
      .reduce((sum, change) => sum - change[2], 0));
    operation.moved = rounded(observed);
    const children = operation.childIds.map(id => audit.dayOperations.find(item => item.id === id)).filter(Boolean);
    operation.childOutcomes = children.map(child => ({ operationId: child.id, status: child.status, moved: child.moved ?? 0 }));
    operation.status = operation.blockers.length ? 'blocked'
      : operation.changes.length ? 'completed'
        : children.some(child => child.changes.length || child.status === 'completed-via-child-operations')
          ? 'completed-via-child-operations'
          : result === false || result === 0 ? 'no-effect' : 'completed-without-stock-change';
  } catch (error) {
    operation.status = 'error';
    operation.error = String(error?.message || error);
    throw error;
  } finally {
    audit.currentOperation = parent;
  }
  return result;
}

export function recordFoodAuditBlocked(reason, details = {}) {
  const audit = activeAudit;
  if (!audit || !(hasTrackedResource(details.resource) || resourceFrom(details.resource))) return;
  const blocker = { day: audit.day, reason: String(reason || 'unspecified'), resource: resourceFrom(details.resource) || details.resource,
    requested: Number.isFinite(details.requested) ? rounded(details.requested) : null,
    available: Number.isFinite(details.available) ? rounded(details.available) : null,
    capacity: Number.isFinite(details.capacity) ? rounded(details.capacity) : null,
    callsite: codeLocation() };
  const operation = audit.currentOperation;
  if (operation) {
    operation.blockers.push(blocker);
    operation.status = 'blocked';
  }
  audit.blockedOperations.push({ ...blocker, operationId: operation?.id ?? null,
    actorId: operation?.actorId ?? details.actorId ?? null, category: operation?.category ?? details.category ?? null });
  audit.dayBlockedOperations.push(audit.blockedOperations.at(-1));
}

export function recordFoodAuditWorkObservation(world, day) {
  const audit = activeAudit;
  if (!audit) return;
  const foodActions = new Set(['forage', 'deliver', 'hunt', 'fish', 'collect_feed', 'replant_field']);
  const observations = [];
  const dayOperationsById = new Map(audit.dayOperations.map(operation => [operation.id, operation]));
  const accountsByPerson = new Map();
  for (const account of audit.accountCatalog) if (account.ownerType === 'person' && account.conserved) {
    const accountSet = accountsByPerson.get(account.ownerId) || new Set();
    accountSet.add(account.index);
    accountsByPerson.set(account.ownerId, accountSet);
  }
  for (const person of world.people || []) {
    const assignment = person.assignment;
    const state = String(person.state || '');
    const isFoodWork = foodActions.has(assignment?.action) || assignment?.goal === 'secure-shared-food'
      || /alimento|comida|ração|roça|colh|seme|caça|pesca|ovelha/i.test(state);
    if (!isFoodWork) continue;
    const explicitBlockers = [];
    for (const intention of person.socialIntentions || []) {
      if (!['active', 'suspended'].includes(intention.status)) continue;
      for (const blocker of intention.blockers || []) explicitBlockers.push(String(blocker));
    }
    for (const blocker of assignment?.blockers || []) explicitBlockers.push(String(blocker));
    if (assignment?.blockedReason) explicitBlockers.push(String(assignment.blockedReason));
    const route = person.navigationRoute;
    const accountIndices = accountsByPerson.get(person.id) || new Set();
    const hasFoodMutation = audit.dayMutations.some(item => accountIndices.has(item.accountIndex))
      || audit.dayOperations.some(operation => operation.actorId === person.id
        && (operation.changes.length > 0 || operation.childIds.some(id => dayOperationsById.get(id)?.changes.length > 0)));
    let inferredBlocker = null;
    if (!hasFoodMutation && /inacessível|bloquead|sem alimento|sem comida|sem espaço|aguardando sementes|recurso esgotado/i.test(state)) {
      inferredBlocker = state;
    }
    if (explicitBlockers.length || inferredBlocker || assignment) observations.push({
      day, personId: person.id, communityId: person.communityId ?? null, kingdomId: person.kingdomId ?? null,
      action: assignment?.action ?? null, goal: assignment?.goal ?? null,
      assignmentSource: assignment?.source ?? null, targetId: assignment?.targetId ?? null,
      foodFieldId: assignment?.foodFieldId ?? null, state,
      blockers: [...new Set(explicitBlockers)], inferredBlocker,
      foodInventoryChanged: hasFoodMutation,
      routeTiles: Array.isArray(route?.path) ? route.path.length : null,
      routeTilesRemaining: Array.isArray(route?.path) ? Math.max(0, route.path.length - Math.max(0, (route.cursor ?? -1) + 1)) : null,
      routeBlockDays: person.navigationCongestion?.blockedDays ?? person.movementCongestion?.blockedDays ?? null,
      failedFoodTargets: (person.failedFoodTargets || []).map(target => ({ x: target.x, y: target.y,
        reason: target.reason ?? null, untilDay: target.untilDay ?? null }))
    });
  }
  audit.workObservations.push(...observations);
}

export function recordFoodAuditCultivatedState(world, day) {
  const audit = activeAudit;
  if (!audit) return;
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  for (const field of world.structures || []) {
    if (field.type !== 'roça') continue;
    const standing = cropIndex < 0 ? 0 : (field.fieldTileIndices || []).reduce((sum, index) =>
      sum + (Number(world.tiles?.[index]?.plants?.[cropIndex]) || 0), 0);
    audit.fieldDailyStates.push([day, field.id, field.communityId ?? null, field.complete === true,
      field.destroyedDay != null || field.integrity === 0, (field.fieldTileIndices || []).length,
      rounded(standing), rounded(finite(field.cropSeedStored)), rounded(finite(field.cropSeededBiomass)),
      rounded(finite(field.cropYieldTarget)), rounded(finite(field.cropHarvestedThisCycle)),
      rounded(finite(field.foodDelivered)), field.cropCycleState ?? null]);
  }
}

export function startFoodInventoryAudit(world) {
  if (activeAudit) throw new Error('A auditoria de inventários alimentares já está ativa.');
  const audit = {
    world, day: null, nextOperationId: 1, currentOperation: null,
    accounts: new Map(), accountCatalog: [], instrumented: new WeakMap(), propertyMeta: new WeakMap(),
    objectOwner: new WeakMap(), accountName: new WeakMap(),
    restore: [], uninstrumentedProperties: [], operations: [], dayOperations: [],
    blockedOperations: [], dayBlockedOperations: [], dayMutations: [],
    dailyBalances: [], daySummaries: [], workObservations: [], fieldDailyStates: [], openingSnapshot: new Map(),
    totalAccountDays: 0, unbalancedAccountDays: 0
  };
  activeAudit = audit;
  for (const collectionName of Object.keys(COLLECTIONS)) wrapCollection(audit, collectionName);
  refreshKnownEntities(audit);
  if (audit.world.market?.stock) registerAccountObject(audit, audit.world.market.stock,
    ownerMeta('world-market', audit.world.market, 'world-market-stock', audit.world.market));
  else registerAccountObject(audit, audit.world.market, ownerMeta('world-market', audit.world.market, 'world-market-stock', audit.world.market));
  return {
    beginDay(day) {
      refreshKnownEntities(audit);
      audit.day = day;
      audit.dayMutations = [];
      audit.dayOperations = [];
      audit.dayBlockedOperations = [];
      audit.openingSnapshot = snapshotAccounts(audit);
    },
    endDay() { finishDay(audit); },
    finish() {
      const report = {
        schemaVersion: 1,
        units: { food: 'physical food units', meat: 'meat units', seeds: 'seed units', feed: 'feed units', personalReserve: 'person-days' },
        coverage: {
          accountCount: audit.accounts.size,
          accountDays: audit.totalAccountDays,
          transactionCount: audit.operations.length,
          blockedOperationCount: audit.blockedOperations.length,
          uninstrumentedPropertyCount: audit.uninstrumentedProperties.length,
          uninstrumentedProperties: audit.uninstrumentedProperties,
          unbalancedAccountDays: audit.unbalancedAccountDays,
          balanced: audit.unbalancedAccountDays === 0,
          dailyBalanceRows: audit.dailyBalances.length,
          workObservationRows: audit.workObservations.length
        },
        dailySummaries: audit.daySummaries,
        accounts: audit.accountCatalog,
        accountDailyBalanceColumns: ['day', 'accountIndex', 'opening', 'inflows', 'outflows', 'eventDelta', 'closing',
          'reconciliationError', 'accessible', 'inaccessibleReason', 'eventCount'],
        accountDailyBalances: audit.dailyBalances,
        fieldDailyStateColumns: ['day', 'fieldId', 'communityId', 'complete', 'destroyed', 'tileCount',
          'standingCropBiomass', 'seedStock', 'seededBiomass', 'yieldTarget', 'harvestedThisCycle', 'foodDelivered', 'cycleState'],
        fieldDailyStates: audit.fieldDailyStates,
        transactions: audit.operations,
        blockedOperations: audit.blockedOperations,
        foodWorkObservations: audit.workObservations
      };
      for (const restore of audit.restore.reverse()) restore();
      activeAudit = null;
      return report;
    }
  };
}
