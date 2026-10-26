export const SOCIAL_EVIDENCE_SCHEMA_VERSION = 1;
export const SOCIAL_RECORD_SCHEMA_VERSIONS = Object.freeze({
  fact: 1, memory: 1, belief: 1, relationship: 1, commitment: 1, intention: 1
});
export const SOCIAL_FACT_RETENTION_DAYS = 365;
export const SOCIAL_MEMORY_PER_PERSON_LIMIT = 32;
export const SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT = 16;
export const SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT = 3;
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

function uniqueKnownPersonIds(world, values, field) {
  const ids = uniqueKnownIds(world, values, field);
  for (const id of ids) {
    if (!(world.people || []).some(person => String(person.id) === id)) fail(field + ' só pode apontar para pessoas.');
  }
  return ids;
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
  const worldEpoch = world.simulationEpoch ?? 0;
  if (!Number.isSafeInteger(worldEpoch) || worldEpoch < 0) fail('simulationEpoch deve ser um inteiro não negativo.');
  if (!world.socialEvidence) {
    world.socialEvidence = {
      schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION, worldSeed: world.seed, worldEpoch,
      nextFactNumber: 1, nextBeliefNumber: 1,
      nextCommitmentNumber: 1, nextIntentionNumber: 1, facts: [], commitments: [], idempotency: {}
    };
  }
  const evidence = world.socialEvidence;
  if (evidence.schemaVersion !== SOCIAL_EVIDENCE_SCHEMA_VERSION || !Array.isArray(evidence.facts)) {
    fail('versão de esquema do mundo incompatível.');
  }
  if (evidence.worldSeed !== world.seed || evidence.worldEpoch !== worldEpoch) fail('seed/época do estado social não corresponde ao mundo.');
  evidence.idempotency ||= {};
  evidence.commitments ||= [];
  if (!Number.isSafeInteger(evidence.nextFactNumber) || evidence.nextFactNumber < 1) evidence.nextFactNumber = 1;
  for (const field of ['nextBeliefNumber', 'nextCommitmentNumber', 'nextIntentionNumber']) {
    if (!Number.isSafeInteger(evidence[field]) || evidence[field] < 1) evidence[field] = 1;
  }
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
  const participantIds = uniqueKnownPersonIds(world, input.participantIds || [], 'participantIds');
  const witnessIds = uniqueKnownPersonIds(world, input.witnessIds || [], 'witnessIds');
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
    worldEpoch: evidence.worldEpoch,
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
  if (input.idempotencyKey == null) fail('idempotencyKey é obrigatório para registrar um fato social.');
  const idempotencyKey = idKey(input.idempotencyKey, 'idempotencyKey');
  if (evidence.idempotency[idempotencyKey]) {
    const existing = evidence.facts.find(fact => fact.eventId === evidence.idempotency[idempotencyKey].eventId);
    if (!existing) fail('a chave de idempotência aponta para um fato removido.');
    if (JSON.stringify(evidence.idempotency[idempotencyKey].fingerprint) !== JSON.stringify(fingerprint)) {
      fail('a mesma chave de idempotência foi usada para fatos diferentes.');
    }
    return existing;
  }
  const sequence = evidence.nextFactNumber++;
  const eventId = String(world.seed) + ':epoch:' + evidence.worldEpoch + ':social:' + sequence;
  const fact = freezeRecursively({ ...factData, sequence, eventId });
  evidence.facts.push(fact);
  evidence.idempotency[idempotencyKey] = { eventId, fingerprint };
  pruneSocialEvidence(world);
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
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    memoryId: fact.eventId + ':person:' + String(person.id),
    rootEventId: fact.eventId,
    sequence: fact.sequence,
    eventType: fact.type,
    eventDay: fact.day,
    acquiredDay,
    source,
    sourcePersonId
  });
  person.socialMemories.push(memory);
  pruneSocialEvidence(world);
  return memory;
}

function localEvidenceIds(person, values = []) {
  if (!Array.isArray(values)) fail('evidenceIds deve ser uma lista.');
  const memories = new Set((person.socialMemories || []).map(memory => memory.rootEventId));
  const ids = [...new Set(values.map(value => idKey(value, 'evidenceIds')))];
  for (const id of ids) if (!memories.has(id)) fail('a pessoa não possui memória da evidência ' + id + '.');
  return ids;
}

function unitInterval(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(field + ' deve estar entre 0 e 1.');
  }
  return value;
}

export function defineSocialBelief(world, personId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa dona da crença não existe.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(topic)) fail('topic deve ser um identificador estável em snake_case.');
  if (typeof input.evaluation !== 'number' || !Number.isFinite(input.evaluation) || input.evaluation < -1 || input.evaluation > 1) {
    fail('evaluation deve estar entre -1 e 1.');
  }
  const lastReviewedDay = input.lastReviewedDay ?? world.day;
  if (!Number.isSafeInteger(lastReviewedDay) || lastReviewedDay < 0 || lastReviewedDay > world.day) fail('lastReviewedDay inválido.');
  const belief = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.belief,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    beliefId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':belief:' + evidence.nextBeliefNumber++,
    ownerId: String(person.id),
    topic,
    evaluation: input.evaluation,
    certainty: unitInterval(input.certainty ?? 0, 'certainty'),
    supportingEventIds: localEvidenceIds(person, input.supportingEventIds || []),
    opposingEventIds: localEvidenceIds(person, input.opposingEventIds || []),
    lastReviewedDay
  });
  person.socialBeliefs ||= [];
  person.socialBeliefs.push(belief);
  return belief;
}

export function defineDirectedSocialRelationship(world, observerId, targetId, input = {}) {
  ensureEvidence(world);
  const observer = personById(world, observerId);
  const target = personById(world, targetId);
  if (!observer || !target || observer === target) fail('a relação dirigida requer duas pessoas distintas e existentes.');
  const evidenceIds = localEvidenceIds(observer, input.evidenceIds || []);
  const relationship = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.relationship,
    worldSeed: world.seed,
    worldEpoch: world.simulationEpoch ?? 0,
    observerId: String(observer.id),
    targetId: String(target.id),
    familiarity: unitInterval(input.familiarity ?? 0, 'familiarity'),
    trust: unitInterval(input.trust ?? 0, 'trust'),
    affinity: unitInterval(input.affinity ?? 0, 'affinity'),
    fear: unitInterval(input.fear ?? 0, 'fear'),
    evidenceIds,
    lastReviewedDay: input.lastReviewedDay ?? world.day
  });
  if (!Number.isSafeInteger(relationship.lastReviewedDay) || relationship.lastReviewedDay < 0
    || relationship.lastReviewedDay > world.day) fail('lastReviewedDay inválido.');
  observer.socialRelations ||= [];
  const existing = observer.socialRelations.find(item => item.targetId === String(target.id));
  if (existing) {
    const requested = cloneJson(relationship, 'relationship');
    if (JSON.stringify(existing) !== JSON.stringify(requested)) fail('a relação dirigida já existe com valores diferentes.');
    return existing;
  }
  if (observer.socialRelations.length >= SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT) {
    fail('a pessoa atingiu o limite de relações detalhadas.');
  }
  observer.socialRelations.push(relationship);
  return relationship;
}

export function proposeSocialCommitment(world, input = {}) {
  const evidence = ensureEvidence(world);
  const parties = uniqueKnownIds(world, input.parties || [], 'parties');
  if (parties.length < 2 || parties.some(id => !personById(world, id))) fail('um compromisso requer ao menos duas pessoas.');
  const object = typeof input.object === 'string' ? input.object.trim() : '';
  if (!object) fail('object deve descrever o que foi prometido.');
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity < 0) fail('quantity deve ser finita e não negativa.');
  if (!Number.isSafeInteger(input.dueDay) || input.dueDay < world.day) fail('dueDay não pode anteceder a proposta.');
  if (input.resourceReferences !== undefined && !Array.isArray(input.resourceReferences)) fail('resourceReferences deve ser uma lista.');
  const resourceReferences = (input.resourceReferences || []).map(reference => {
    if (!reference || !REFERENCE_COLLECTIONS[reference.kind]) fail('resourceReferences contém um kind inválido.');
    const id = idKey(reference.id, 'resourceReferences.id');
    if (!REFERENCE_COLLECTIONS[reference.kind].some(collection =>
      (world[collection] || []).some(entity => String(entity.id) === id))) fail('resourceReferences aponta para entidade inexistente.');
    return { kind: reference.kind, id };
  });
  if (input.idempotencyKey == null) fail('idempotencyKey é obrigatório para propor um compromisso.');
  const idempotencyKey = idKey(input.idempotencyKey, 'idempotencyKey');
  const data = {
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.commitment,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    day: world.day,
    parties,
    object,
    quantity: input.quantity,
    dueDay: input.dueDay,
    status: 'proposed',
    resourceReferences
  };
  const fingerprint = cloneJson(data, 'commitment');
  const existing = evidence.commitments.find(item => item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (JSON.stringify(existing.fingerprint) !== JSON.stringify(fingerprint)) fail('a chave do compromisso foi reutilizada com outro conteúdo.');
    return existing.record;
  }
  const record = freezeRecursively({ ...data, commitmentId: String(world.seed) + ':epoch:' + evidence.worldEpoch
    + ':commitment:' + evidence.nextCommitmentNumber++ });
  evidence.commitments.push({ idempotencyKey, fingerprint, record });
  return record;
}

export function defineSocialIntention(world, ownerId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, ownerId);
  if (!person) fail('a pessoa dona da intenção não existe.');
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) fail('type deve ser um identificador estável em snake_case.');
  const priority = unitInterval(input.priority ?? 0, 'priority');
  const targetId = input.targetId == null ? null : idKey(input.targetId, 'targetId');
  if (targetId !== null && !entityExists(world, targetId)) fail('targetId da intenção não existe.');
  if (!Array.isArray(input.steps) || input.steps.some(step => !step || typeof step.action !== 'string' || !step.action.trim())) {
    fail('steps deve listar ações não vazias.');
  }
  const steps = input.steps.map(step => ({
    action: step.action.trim(),
    targetId: step.targetId == null ? null : idKey(step.targetId, 'steps.targetId')
  }));
  for (const step of steps) if (step.targetId !== null && !entityExists(world, step.targetId)) fail('targetId de um passo não existe.');
  const progress = input.progress ?? 0;
  if (!Number.isSafeInteger(progress) || progress < 0 || progress > steps.length) fail('progress deve apontar para um passo válido.');
  const blockers = input.blockers ?? [];
  if (!Array.isArray(blockers) || blockers.some(item => typeof item !== 'string')) fail('blockers deve conter apenas textos.');
  const endsWhen = typeof input.endsWhen === 'string' ? input.endsWhen.trim() : '';
  if (!endsWhen) fail('endsWhen deve explicar a condição de encerramento.');
  person.socialIntentions ||= [];
  if (person.socialIntentions.filter(item => item.status === 'active').length >= SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) {
    fail('a pessoa atingiu o limite de intenções ativas.');
  }
  const intention = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.intention,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    intentionId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':intention:' + evidence.nextIntentionNumber++,
    ownerId: String(person.id),
    type,
    priority,
    targetId,
    steps,
    progress,
    blockers: blockers.slice(),
    endsWhen,
    status: 'active'
  });
  person.socialIntentions.push(intention);
  return intention;
}

export function pruneSocialEvidence(world, currentDay = world.day) {
  const evidence = ensureEvidence(world);
  if (!Number.isSafeInteger(currentDay) || currentDay < world.day) fail('currentDay não pode anteceder o mundo.');
  const cutoff = currentDay - SOCIAL_FACT_RETENTION_DAYS;
  for (const person of world.people || []) {
    if (!Array.isArray(person.socialMemories)) continue;
    person.socialMemories = person.socialMemories
      .filter(memory => memory.acquiredDay >= cutoff)
      .sort((a, b) => a.acquiredDay - b.acquiredDay || a.sequence - b.sequence || a.memoryId.localeCompare(b.memoryId))
      .slice(-SOCIAL_MEMORY_PER_PERSON_LIMIT);
  }
  const referenced = new Set((world.people || []).flatMap(person =>
    (person.socialMemories || []).map(memory => memory.rootEventId)));
  evidence.facts = evidence.facts.filter(fact => fact.day >= cutoff || referenced.has(fact.eventId));
  evidence.facts.sort((a, b) => a.day - b.day || a.sequence - b.sequence);
  while (evidence.facts.length > SOCIAL_FACT_LIMIT) {
    const expired = evidence.facts.shift();
    for (const person of world.people || []) {
      if (Array.isArray(person.socialMemories)) {
        person.socialMemories = person.socialMemories.filter(memory => memory.rootEventId !== expired.eventId);
      }
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
