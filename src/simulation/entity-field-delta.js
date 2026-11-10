// JUL-277/JUL-278: opt-in, versioned, field-level entity patches.
// Comparison is conservative: only plain serializable records/arrays may be
// memoized. Unsupported values fail closed to a full WorldSnapshot. This
// module does NOT modify the authoritative simulation.
const COLLECTIONS = Object.freeze(['people', 'animals', 'structures']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isRecord = v => !!v && typeof v === 'object'
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const validId = id => Number.isSafeInteger(id) && id >= 0;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function signature(value, visiting = new WeakSet()) {
  switch (typeof value) {
    case 'undefined': return 'u';
    case 'boolean': return value ? 'b1' : 'b0';
    case 'string': return 's' + JSON.stringify(value);
    case 'number':
      return 'n' + (Object.is(value, -0) ? '-0' : Number.isNaN(value)
        ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : String(value));
    case 'bigint': return 'i' + String(value);
    case 'object': {
      if (value === null) return 'null';
      if (visiting.has(value)) throw Error('Cyclic entity values cannot be diffed.');
      visiting.add(value);
      let result;
      if (Array.isArray(value)) {
        if (Object.keys(value).some(k => !/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= value.length))
          throw Error('Entity arrays with custom properties cannot be diffed.');
        const parts = [];
        for (let i = 0; i < value.length; i++)
          parts.push(hasOwn(value, i) ? signature(value[i], visiting) : 'hole');
        result = 'a[' + parts.join(',') + ']';
      } else if (isRecord(value)) {
        if (Object.getOwnPropertySymbols(value).length) throw Error('Symbol entity keys are unsupported.');
        const keys = Object.keys(value).sort();
        if (keys.some(k => FORBIDDEN_KEYS.has(k))) throw Error('Unsafe entity key.');
        result = 'o{' + keys.map(k => JSON.stringify(k) + ':' + signature(value[k], visiting)).join(',') + '}';
      } else {
        throw Error('Non-plain entity value requires full snapshot.');
      }
      visiting.delete(value);
      return result;
    }
    default:
      throw Error('Unsupported entity value requires full snapshot.');
  }
}

export function captureEntityFieldCache(base) {
  const cache = {};
  for (const name of COLLECTIONS) {
    const list = base?.[name];
    if (!Array.isArray(list)) throw Error('Missing entity collection ' + name);
    const rows = new Map(), order = [];
    for (const entity of list) {
      if (!isRecord(entity) || !validId(entity.id) || rows.has(entity.id))
        throw Error('Invalid or duplicate entity ID in ' + name);
      const fields = new Map();
      for (const key of Object.keys(entity)) {
        if (FORBIDDEN_KEYS.has(key)) throw Error('Unsafe entity property.');
        fields.set(key, signature(entity[key]));
      }
      rows.set(entity.id, fields);
      order.push(entity.id);
    }
    cache[name] = { rows, order };
  }
  return cache;
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Return a cached signature + sparse patch; caller must fall back to a full
 * snapshot when patch is null (unsupported shape / insufficient byte savings).
 * The byte comparison is a JSON *proxy*, not structuredClone wire bytes.
 */
export function createEntityFieldPatch(base, previousCache, { maxFraction = .9, force = false } = {}) {
  const cache = captureEntityFieldCache(base);
  if (!previousCache) return { cache, patch: null };
  const collections = {};
  for (const name of COLLECTIONS) {
    const previous = previousCache[name], current = cache[name];
    if (!previous?.rows || !current) return { cache, patch: null };
    const oldIds = previous.rows, currentIds = current.rows;
    const added = [], updated = [], removed = [];
    for (const id of oldIds.keys()) if (!currentIds.has(id)) removed.push(id);
    for (const entity of base[name]) {
      const oldFields = oldIds.get(entity.id);
      if (!oldFields) { added.push(entity); continue; }
      const newFields = currentIds.get(entity.id);
      const set = Object.create(null), unset = [];
      for (const key of oldFields.keys()) if (!newFields.has(key)) unset.push(key);
      for (const [key, hash] of newFields) {
        if (!oldFields.has(key) || oldFields.get(key) !== hash) set[key] = entity[key];
      }
      if (unset.length || Object.keys(set).length) updated.push({ id: entity.id, set, unset });
    }
    collections[name] = {
      beforeCount: previous.order.length, afterCount: current.order.length,
      added, updated, removed,
      ...(!sameOrder(previous.order, current.order) ? { order: current.order } : {})
    };
  }
  const patch = { schemaVersion: 1, collections };
  const fullJson = JSON.stringify(Object.fromEntries(COLLECTIONS.map(name => [name, base[name]])));
  const deltaJson = JSON.stringify(patch);
  if (!Number.isFinite(maxFraction) || maxFraction <= 0 || maxFraction > 1)
    throw new RangeError('Invalid entity delta budget.');
  if (!force && deltaJson.length >= fullJson.length * maxFraction) return { cache, patch: null };
  return { cache, patch };
}

export function prepareEntityFieldPatch(previous, patch) {
  if (!isRecord(patch) || patch.schemaVersion !== 1 || !isRecord(patch.collections)
      || Object.keys(patch.collections).length !== COLLECTIONS.length)
    throw Error('Invalid entity delta schema.');
  const projected = {};
  for (const name of COLLECTIONS) {
    const descriptor = patch.collections[name], currentList = previous?.[name];
    if (!isRecord(descriptor) || !Array.isArray(currentList)
        || !Number.isSafeInteger(descriptor.beforeCount) || descriptor.beforeCount !== currentList.length
        || !Number.isSafeInteger(descriptor.afterCount) || descriptor.afterCount < 0
        || !Array.isArray(descriptor.added) || !Array.isArray(descriptor.updated)
        || !Array.isArray(descriptor.removed)) throw Error('Invalid entity delta collection ' + name);
    const current = new Map();
    for (const entity of currentList) {
      if (!isRecord(entity) || !validId(entity.id) || current.has(entity.id))
        throw Error('Incompatible previous entity view.');
      current.set(entity.id, entity);
    }
    const oldIds = new Set(current.keys());
    for (const id of descriptor.removed) {
      if (!validId(id) || !oldIds.has(id) || !current.has(id))
        throw Error('Unknown/duplicate entity removal.');
      current.delete(id);
    }
    for (const change of descriptor.updated) {
      if (!isRecord(change) || !validId(change.id) || !oldIds.has(change.id)
          || !current.has(change.id) || !isRecord(change.set)
          || !Array.isArray(change.unset)) throw Error('Invalid entity update.');
      const before = current.get(change.id), next = { ...before };
      const changedKeys = new Set();
      for (const key of change.unset) {
        if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || key === 'id'
            || changedKeys.has(key) || !hasOwn(before, key)) throw Error('Invalid entity field removal.');
        changedKeys.add(key);
        delete next[key];
      }
      for (const key of Object.keys(change.set)) {
        if (FORBIDDEN_KEYS.has(key) || key === 'id' || changedKeys.has(key))
          throw Error('Invalid entity field update.');
        changedKeys.add(key);
        next[key] = change.set[key];
      }
      if (next.id !== change.id) throw Error('Entity ID changed.');
      current.set(change.id, next);
    }
    for (const entity of descriptor.added) {
      if (!isRecord(entity) || !validId(entity.id) || current.has(entity.id)
          || oldIds.has(entity.id)) throw Error('Invalid/duplicate entity spawn.');
      current.set(entity.id, entity);
    }
    if (current.size !== descriptor.afterCount) throw Error('Entity count mismatch.');
    const order = descriptor.order;
    let result;
    if (order !== undefined) {
      if (!Array.isArray(order) || order.length !== current.size) throw Error('Invalid entity order.');
      const seen = new Set();
      result = order.map(id => {
        if (!validId(id) || seen.has(id) || !current.has(id))
          throw Error('Invalid entity order ID.');
        seen.add(id);
        return current.get(id);
      });
    } else {
      const expected = currentList.filter(entity => current.has(entity.id)).map(entity => entity.id)
        .concat(descriptor.added.map(entity => entity.id));
      if (expected.length !== current.size) throw Error('Entity order/count mismatch.');
      result = expected.map(id => current.get(id));
    }
    projected[name] = result;
  }
  return projected;
}

export const ENTITY_DELTA_COLLECTIONS = COLLECTIONS;
