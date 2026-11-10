// Experimental nested entity patch codec. Completely functional: applying a
// patch never mutates the previous WorldView. The outer entity-level preflight
// validates all arrays before the first tile or world attribute is updated.
const record = v => !!v && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const safeKey = k => typeof k === 'string' && !['__proto__', 'prototype', 'constructor'].includes(k);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const jsonLength = v => JSON.stringify(v)?.length ?? Infinity;

function choosePatch(patch, value) {
  return jsonLength(patch) < jsonLength(value) * .92
    ? patch : { t: 'r', value };
}
function keyedBy(array, key) {
  if (!array.length) return false;
  const keys = new Set();
  for (const item of array) {
    if (!record(item) || !own(item, key)
        || !(typeof item[key] === 'string' || Number.isSafeInteger(item[key]))
        || keys.has(item[key])) return false;
    keys.add(item[key]);
  }
  return true;
}

/** A bounded structural diff; every compact patch is checked against literal
 * JSON length and falls back to lossless whole-value replacement if needed.
 */
export function diffNestedValue(before, after, depth = 0) {
  if (Object.is(before, after)) return null;
  if (depth >= 7) return { t: 'r', value: after };
  if (Array.isArray(before) && Array.isArray(after)) {
    for (const key of ['tileIndex', 'id']) {
      if (keyedBy(before, key) && keyedBy(after, key)) {
        const old = new Map(before.map(v => [v[key], v]));
        const next = new Map(after.map(v => [v[key], v]));
        const add = [], update = [], remove = [];
        for (const id of old.keys()) if (!next.has(id)) remove.push(id);
        for (const value of after) {
          if (!old.has(value[key])) { add.push(value); continue; }
          const patch = diffNestedValue(old.get(value[key]), value, depth + 1);
          if (patch) update.push({ id: value[key], patch });
        }
        const candidate = { t: 'k', key, order: after.map(v => v[key]), add, update, remove };
        return choosePatch(candidate, after);
      }
    }
    if (before.length === after.length) {
      const updates = [];
      for (let i = 0; i < after.length; i++) {
        const changed = own(before, i) !== own(after, i)
          ? { t: 'r', value: after[i] }
          : diffNestedValue(before[i], after[i], depth + 1);
        if (changed) updates.push({ i, patch: changed });
      }
      return updates.length ? choosePatch({ t: 'a', length: before.length, updates }, after) : null;
    }
    let left = 0, right = 0;
    while (left < before.length && left < after.length
        && Object.is(before[left], after[left])) left++;
    while (right < before.length - left && right < after.length - left
        && Object.is(before[before.length - right - 1], after[after.length - right - 1])) right++;
    return choosePatch({ t: 's', start: left, remove: before.length - left - right,
      add: after.slice(left, after.length - right) }, after);
  }
  if (record(before) && record(after)) {
    const unset = [], set = {}, deep = [];
    for (const key of Object.keys(before)) if (!own(after, key)) unset.push(key);
    for (const [key, value] of Object.entries(after)) {
      if (!own(before, key)) { set[key] = value; continue; }
      const nested = diffNestedValue(before[key], value, depth + 1);
      if (!nested) continue;
      if (nested.t === 'r') set[key] = value;
      else deep.push({ key, patch: nested });
    }
    return unset.length || Object.keys(set).length || deep.length
      ? choosePatch({ t: 'o', unset, set, deep }, after) : null;
  }
  return { t: 'r', value: after };
}

export function applyNestedValuePatch(before, patch, depth = 0) {
  if (!record(patch) || depth >= 8) throw Error('Invalid nested entity patch.');
  if (patch.t === 'r') {
    if (!own(patch, 'value')) throw Error('Missing replacement value.');
    return patch.value;
  }
  if (patch.t === 'o') {
    if (!record(before) || !record(patch.set) || !Array.isArray(patch.unset)
        || !Array.isArray(patch.deep)) throw Error('Invalid nested object patch.');
    const next = { ...before }, touched = new Set();
    for (const key of patch.unset) {
      if (!safeKey(key) || touched.has(key) || !own(next, key))
        throw Error('Invalid nested object deletion.');
      touched.add(key); delete next[key];
    }
    for (const [key, value] of Object.entries(patch.set)) {
      if (!safeKey(key) || touched.has(key)) throw Error('Invalid nested object field.');
      touched.add(key); next[key] = value;
    }
    for (const row of patch.deep) {
      if (!record(row) || !safeKey(row.key) || touched.has(row.key)
          || !own(before, row.key)) throw Error('Invalid nested object path.');
      touched.add(row.key);
      next[row.key] = applyNestedValuePatch(before[row.key], row.patch, depth + 1);
    }
    return next;
  }
  if (!Array.isArray(before)) throw Error('Nested array target is missing.');
  if (patch.t === 'a') {
    if (patch.length !== before.length || !Array.isArray(patch.updates))
      throw Error('Invalid indexed entity patch.');
    const next = before.slice(), seen = new Set();
    for (const row of patch.updates) {
      if (!record(row) || !Number.isSafeInteger(row.i) || row.i < 0
          || row.i >= next.length || seen.has(row.i)) throw Error('Invalid nested array index.');
      seen.add(row.i);
      next[row.i] = applyNestedValuePatch(before[row.i], row.patch, depth + 1);
    }
    return next;
  }
  if (patch.t === 's') {
    if (!Number.isSafeInteger(patch.start) || patch.start < 0
        || !Number.isSafeInteger(patch.remove) || patch.remove < 0
        || patch.start + patch.remove > before.length || !Array.isArray(patch.add))
      throw Error('Invalid nested array splice.');
    return before.slice(0, patch.start).concat(patch.add, before.slice(patch.start + patch.remove));
  }
  if (patch.t === 'k') {
    if (!['id','tileIndex'].includes(patch.key) || !Array.isArray(patch.order)
        || !Array.isArray(patch.add) || !Array.isArray(patch.update)
        || !Array.isArray(patch.remove) || !keyedBy(before, patch.key))
      throw Error('Invalid keyed entity patch.');
    const old = new Map(before.map(v => [v[patch.key], v]));
    const next = new Map(old);
    for (const id of patch.remove) {
      if (!old.has(id) || !next.has(id)) throw Error('Invalid keyed entity removal.');
      next.delete(id);
    }
    for (const row of patch.update) {
      if (!record(row) || !old.has(row.id) || !next.has(row.id))
        throw Error('Invalid keyed entity update.');
      next.set(row.id, applyNestedValuePatch(old.get(row.id), row.patch, depth + 1));
    }
    for (const value of patch.add) {
      if (!record(value) || !own(value, patch.key) || next.has(value[patch.key])
          || old.has(value[patch.key])) throw Error('Invalid keyed entity addition.');
      next.set(value[patch.key], value);
    }
    if (next.size !== patch.order.length) throw Error('Keyed patch count mismatch.');
    const seen = new Set();
    return patch.order.map(id => {
      if (seen.has(id) || !next.has(id)) throw Error('Invalid keyed patch order.');
      seen.add(id);
      return next.get(id);
    });
  }
  throw Error('Unknown nested entity patch format.');
}
