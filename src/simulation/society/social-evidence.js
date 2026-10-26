export const SOCIAL_EVIDENCE_SCHEMA_VERSION = 1;
export const SOCIAL_FACT_RETENTION_DAYS = 365;
export const SOCIAL_MEMORY_PER_PERSON_LIMIT = 64;
export const SOCIAL_FACT_LIMIT = 512;
const REFERENCE_COLLECTIONS = Object.freeze({
  person: ['people'], animal: ['animals'], community: ['communities'], kingdom: ['kingdoms'],
  structure: ['structures'], settlement: ['settlements']
});

function fail(message) {
  throw new Error('Evidência social inválida: ' + message);
}

function idKey(value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  fail(field + ' deve ser um ID inteiro ou texto não vazio.');
}

function entityExists(world, id) {
  return ['people', 'animals', 'communities', 'kingdoms', 'structures', 'settlements'].some(collection =>
    (world[collection] || []).some(entity => String(entity.id) === id));
}

function freezeRecursively(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecursively(child);
  return Object.freeze(value);
}

function uniqueKnownIds(world, values, field) {
  if (!Array.isArray(values)) fail(field + ' deve ser uma lista.');
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const id = idKey(value, field);
    if (!entityExists(world, id)) fail(field + ' referencia ID inexistente: ' + id + '.');
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function cloneJson(value, field) {
  const seen = new WeakSet();
  const encode = item => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(field + ' não aceita NaN ou infinito.');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') fail(field + ' deve conter apenas dados JSON.');
    if (seen.has(item)) fail(field + ' não aceita referências cíclicas.');
    seen.add(item);
    const result = Array.isArray(item)
      ? '[' + item.map(encode).join(',') + ']'
      : '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
    seen.delete(item);
    return result;
  };
  try { return JSON.parse(encode(value)); }
  catch (error) {
    if (String(error?.message || '').startsWith('Evidência social inválida:')) throw error;
    fail(field + ' não pode ser serializado: ' + error.message);
  }
}

function ensureEvidence(world) {
  if (!world || !Number.isSafeInteger(world.seed) || !Number.isSafeInteger(world.day)) {
    fail('o mundo precisa de seed e dia inteiros.');
  }
  if (!world.socialEvidence) {
    world.socialEvidence = { schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION, nextFactNumber: 1, facts: [], idempotency: {} };
  }
  const evidence = world.socialEvidence;
  if (evidence.schemaVersion !== SOCIAL_EVIDENCE_SCHEMA_VERSION || !Array.isArray(evidence.facts)) {
    fail('versão de esquema do mundo incompatível.');
  }
  evidence.idempotency ||= {};
  if (!Number.isSafeInteger(evidence.nextFactNumber) || evidence.nextFactNumber < 1) evidence.nextFactNumber = 1;
  return evidence;
}

function personById(world, value) {
  const key = idKey(value, 'personId');
  return (world.people || []).find(person => String(person.id) === key) || null;
}

export function recordSocialFact(world, input = {}) {
  const evidence = ensureEvidence(world);
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) fail('type deve ser um identificador estável em snake_case.');
  const day = input.day === undefined ? world.day : input.day;
  if (!Number.isSafeInteger(day) || day < 0 || day > world.day) fail('day deve pertencer ao passado observável do mundo.');
  const participantIds = uniqueKnownIds(world, input.participantIds || [], 'participantIds');
  const witnessIds = uniqueKnownIds(world, input.witnessIds || [], 'witnessIds');
  const targetId = input.targetId == null ? null : idKey(input.targetId, 'targetId');
  if (targetId !== null && !entityExists(world, targetId)) fail('targetId referencia entidade inexistente: ' + targetId + '.');
  const location = input.location == null ? null : cloneJson(input.location, 'location');
  if (location && (!Number.isFinite(location.x) || !Number.isFinite(location.y))) fail('location requer coordenadas finitas.');
  if (input.references !== undefined && !Array.isArray(input.references)) fail('references deve ser uma lista.');
  const references = (input.references || []).map(reference => {
    if (!reference || typeof reference.kind !== 'string') fail('cada reference precisa de kind e id.');
    if (!REFERENCE_COLLECTIONS[reference.kind]) fail('kind de referência não reconhecido: ' + reference.kind + '.');
    const id = idKey(reference.id, 'references.id');
    const found = REFERENCE_COLLECTIONS[reference.kind].some(collection =>
      (world[collection] || []).some(entity => String(entity.id) === id));
    if (!found) fail('reference aponta para entidade inexistente: ' + reference.kind + ':' + id + '.');
    return { kind: reference.kind, id };
  });
  const factData = {
    schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
    worldSeed: world.seed,
    day,
    type,
    participantIds,
    targetId,
    location,
    outcome: cloneJson(input.outcome ?? {}, 'outcome'),
    references,
    witnessIds
  };
  const fingerprint = cloneJson(factData, 'fact');
  const idempotencyKey = input.idempotencyKey == null ? null : idKey(input.idempotencyKey, 'idempotencyKey');
  if (idempotencyKey && evidence.idempotency[idempotencyKey]) {
    const existing = evidence.facts.find(fact => fact.eventId === evidence.idempotency[idempotencyKey].eventId);
    if (!existing) fail('a chave de idempotência aponta para um fato removido.');
    if (JSON.stringify(evidence.idempotency[idempotencyKey].fingerprint) !== JSON.stringify(fingerprint)) {
      fail('a mesma chave de idempotência foi usada para fatos diferentes.');
    }
    return existing;
  }
  const eventId = String(world.seed) + ':social:' + evidence.nextFactNumber++;
  const fact = freezeRecursively({ ...factData, eventId });
  evidence.facts.push(fact);
  if (idempotencyKey) evidence.idempotency[idempotencyKey] = { eventId, fingerprint };
  return fact;
}

export function rememberSocialFact(world, personId, eventId, options = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa que receberá a memória não existe.');
  const fact = evidence.facts.find(item => item.eventId === String(eventId));
  if (!fact) fail('o fato de origem não existe neste mundo.');
  const source = options.source || 'direct';
  if (!['direct', 'reported'].includes(source)) fail('source deve ser direct ou reported.');
  const acquiredDay = options.acquiredDay === undefined ? world.day : options.acquiredDay;
  if (!Number.isSafeInteger(acquiredDay) || acquiredDay < fact.day || acquiredDay > world.day) {
    fail('acquiredDay deve estar entre o fato e o dia atual.');
  }
  let sourcePersonId = null;
  if (source === 'direct') {
    if (!fact.witnessIds.includes(String(person.id))) fail('a pessoa não consta entre as testemunhas do fato.');
  } else {
    sourcePersonId = idKey(options.sourcePersonId, 'sourcePersonId');
    const sourcePerson = personById(world, sourcePersonId);
    if (!sourcePerson || sourcePerson === person) fail('a fonte do relato deve ser outra pessoa existente.');
    if (!(sourcePerson.socialMemories || []).some(memory => memory.rootEventId === fact.eventId)) {
      fail('a fonte ainda não conhece este fato.');
    }
  }
  person.socialMemories ||= [];
  const existing = person.socialMemories.find(memory => memory.rootEventId === fact.eventId);
  if (existing) return existing;
  const memory = freezeRecursively({
    schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
    memoryId: fact.eventId + ':person:' + String(person.id),
    rootEventId: fact.eventId,
    eventType: fact.type,
    eventDay: fact.day,
    acquiredDay,
    source,
    sourcePersonId
  });
  person.socialMemories.push(memory);
  return memory;
}

export function pruneSocialEvidence(world, currentDay = world.day) {
  const evidence = ensureEvidence(world);
  if (!Number.isSafeInteger(currentDay) || currentDay < world.day) fail('currentDay não pode anteceder o mundo.');
  const cutoff = currentDay - SOCIAL_FACT_RETENTION_DAYS;
  for (const person of world.people || []) {
    person.socialMemories = (person.socialMemories || [])
      .filter(memory => memory.acquiredDay >= cutoff)
      .sort((a, b) => a.acquiredDay - b.acquiredDay || a.memoryId.localeCompare(b.memoryId))
      .slice(-SOCIAL_MEMORY_PER_PERSON_LIMIT);
  }
  const referenced = new Set((world.people || []).flatMap(person =>
    (person.socialMemories || []).map(memory => memory.rootEventId)));
  evidence.facts = evidence.facts.filter(fact => fact.day >= cutoff || referenced.has(fact.eventId));
  evidence.facts.sort((a, b) => a.day - b.day || a.eventId.localeCompare(b.eventId));
  while (evidence.facts.length > SOCIAL_FACT_LIMIT) {
    const expired = evidence.facts.shift();
    for (const person of world.people || []) {
      person.socialMemories = (person.socialMemories || []).filter(memory => memory.rootEventId !== expired.eventId);
    }
  }
  const retainedIds = new Set(evidence.facts.map(fact => fact.eventId));
  for (const [key, item] of Object.entries(evidence.idempotency)) {
    if (!retainedIds.has(item.eventId)) delete evidence.idempotency[key];
  }
  return {
    retainedFacts: evidence.facts.length,
    retainedMemories: (world.people || []).reduce((sum, person) => sum + (person.socialMemories || []).length, 0),
    cutoffDay: cutoff
  };
}
