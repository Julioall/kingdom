export const SOCIAL_EVIDENCE_SCHEMA_VERSION = 1;
export const SOCIAL_RECORD_SCHEMA_VERSIONS = Object.freeze({
  fact: 1, memory: 1, belief: 1, relationship: 1, commitment: 1, intention: 1
});
export const SOCIAL_FACT_RETENTION_DAYS = 365;
export const SOCIAL_MEMORY_PER_PERSON_LIMIT = 32;
export const SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT = 16;
export const SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT = 3;
export const SOCIAL_OPEN_COMMITMENT_PER_PERSON_LIMIT = 8;
export const SOCIAL_FACT_LIMIT = 512;
const TERMINAL_COMMITMENT_STATUSES = new Set(['fulfilled', 'breached', 'rejected', 'cancelled', 'expired']);
const TERMINAL_INTENTION_STATUSES = new Set(['completed', 'abandoned']);
const PHYSICAL_INTENTION_BLOCKERS = new Set(['critical_hunger', 'critical_thirst', 'critical_health', 'critical_energy', 'recent_attack']);
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

export function recordSocialFact(world, input = {}, options = {}) {
  const evidence = ensureEvidence(world);
  if (options.preserveEventIds !== undefined && !Array.isArray(options.preserveEventIds)) {
    fail('preserveEventIds deve ser uma lista.');
  }
  const preserveEventIds = (options.preserveEventIds || []).map(value => idKey(value, 'preserveEventIds'));
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
  pruneSocialEvidence(world, world.day, [eventId, ...preserveEventIds]);
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
  // Keep the just-delivered fact present while callers share it with any
  // other witnesses or attach beliefs, relationships, and plan references.
  if (!options.deferPrune) pruneSocialEvidence(world, world.day, [fact.eventId]);
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
  const aboutId = input.aboutId == null ? null : idKey(input.aboutId, 'aboutId');
  if (aboutId !== null && !entityExists(world, aboutId)) fail('aboutId referencia entidade inexistente: ' + aboutId + '.');
  const belief = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.belief,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    beliefId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':belief:' + evidence.nextBeliefNumber++,
    ownerId: String(person.id),
    topic,
    aboutId,
    evaluation: input.evaluation,
    certainty: unitInterval(input.certainty ?? 0, 'certainty'),
    supportingEventIds: localEvidenceIds(person, input.supportingEventIds || []),
    opposingEventIds: localEvidenceIds(person, input.opposingEventIds || []),
    lastReviewedDay,
    revision: 1,
    evidenceWeight: 0
  });
  person.socialBeliefs ||= [];
  person.socialBeliefs.push(belief);
  return belief;
}

/**
 * Re-evaluates one directed belief from a newly remembered, unique root event.
 * Reports carry less weight than direct observation, and duplicate reports of
 * the same root event never increase certainty a second time.
 */
export function recordSocialBeliefEvidence(world, personId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa dona da crença não existe.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(topic)) fail('topic deve ser um identificador estável em snake_case.');
  const aboutId = input.aboutId == null ? null : idKey(input.aboutId, 'aboutId');
  if (aboutId !== null && !entityExists(world, aboutId)) fail('aboutId referencia entidade inexistente: ' + aboutId + '.');
  const eventId = idKey(input.eventId, 'eventId');
  const fact = evidence.facts.find(item => item.eventId === eventId);
  if (!fact) fail('o fato de origem da crença não existe.');
  if (!localEvidenceIds(person, [eventId]).length) fail('a pessoa não possui memória da evidência ' + eventId + '.');
  if (typeof input.polarity !== 'number' || !Number.isFinite(input.polarity)
      || input.polarity === 0 || input.polarity < -1 || input.polarity > 1) {
    fail('polarity deve estar entre -1 e 1 e ser diferente de zero.');
  }

  person.socialBeliefs ||= [];
  const beliefIndex = person.socialBeliefs.findIndex(item => item.topic === topic && item.aboutId === aboutId);
  const previous = beliefIndex < 0 ? null : person.socialBeliefs[beliefIndex];
  const supportingEventIds = previous ? previous.supportingEventIds.slice() : [];
  const opposingEventIds = previous ? previous.opposingEventIds.slice() : [];
  const hasPreviousEvidence = supportingEventIds.length > 0 || opposingEventIds.length > 0;
  const priorClassification = supportingEventIds.includes(eventId) ? 1
    : opposingEventIds.includes(eventId) ? -1 : 0;
  const requestedClassification = Math.sign(input.polarity);
  if (priorClassification) {
    if (priorClassification !== requestedClassification) fail('a mesma evidência não pode sustentar e contrariar a crença.');
    pruneSocialEvidence(world);
    return previous;
  }

  (requestedClassification > 0 ? supportingEventIds : opposingEventIds).push(eventId);
  const memoriesByEvent = new Map((person.socialMemories || []).map(memory => [memory.rootEventId, memory]));
  const weightFor = id => memoriesByEvent.get(id)?.source === 'reported' ? .5 : 1;
  const positiveWeight = supportingEventIds.reduce((sum, id) => sum + weightFor(id), 0);
  const negativeWeight = opposingEventIds.reduce((sum, id) => sum + weightFor(id), 0);
  const priorUncitedWeight = previous && !hasPreviousEvidence
    ? -3 * Math.log(Math.max(1e-9, 1 - previous.certainty)) : 0;
  const totalWeight = positiveWeight + negativeWeight + priorUncitedWeight;
  const priorNet = previous && !hasPreviousEvidence
    ? previous.evaluation * priorUncitedWeight : 0;
  const netWeight = positiveWeight - negativeWeight + priorNet;
  const belief = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.belief,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    beliefId: previous?.beliefId || String(world.seed) + ':epoch:' + evidence.worldEpoch + ':belief:' + evidence.nextBeliefNumber++,
    ownerId: String(person.id),
    topic,
    aboutId,
    evaluation: totalWeight > 0 ? Math.max(-1, Math.min(1, netWeight / totalWeight)) : input.polarity,
    certainty: Math.max(0, Math.min(1, 1 - Math.exp(-totalWeight / 3))),
    supportingEventIds,
    opposingEventIds,
    lastReviewedDay: world.day,
    revision: (previous?.revision || 0) + 1,
    evidenceWeight: totalWeight
  });
  if (beliefIndex < 0) person.socialBeliefs.push(belief);
  else person.socialBeliefs[beliefIndex] = belief;
  pruneSocialEvidence(world);
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

/** Apply a once-per-event directional relationship change using evidence both people know. */
export function updateDirectedSocialRelationship(world, observerId, targetId, input = {}) {
  const evidence = ensureEvidence(world);
  const observer = personById(world, observerId);
  const target = personById(world, targetId);
  if (!observer || !target || observer === target) fail('a relação dirigida requer duas pessoas distintas e existentes.');
  const eventId = idKey(input.eventId, 'eventId');
  const fact = evidence.facts.find(item => item.eventId === eventId);
  if (!fact || !fact.participantIds.includes(String(observer.id)) || !fact.participantIds.includes(String(target.id))) {
    fail('a evidência da relação precisa envolver as duas pessoas.');
  }
  if (!(observer.socialMemories || []).some(memory => memory.rootEventId === eventId)) {
    fail('a pessoa ainda não conhece a evidência da relação.');
  }
  const relations = observer.socialRelations || (observer.socialRelations = []);
  const index = relations.findIndex(item => item.targetId === String(target.id));
  const previous = index >= 0 ? relations[index] : null;
  if (previous?.evidenceIds.includes(eventId)) return previous;
  if (!previous && relations.length >= SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT) return null;
  if (input.familiarityDelta !== undefined && (!Number.isFinite(input.familiarityDelta) || input.familiarityDelta < 0)) {
    fail('familiarityDelta deve ser finito e não negativo.');
  }
  if (input.trustDelta !== undefined && !Number.isFinite(input.trustDelta)) fail('trustDelta deve ser finito.');
  const relationship = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.relationship,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    observerId: String(observer.id),
    targetId: String(target.id),
    familiarity: unitInterval(Math.min(1, (previous?.familiarity || 0) + (input.familiarityDelta || 0)), 'familiarity'),
    trust: unitInterval(Math.max(0, Math.min(1, (previous?.trust || 0) + (input.trustDelta || 0))), 'trust'),
    affinity: previous?.affinity || 0,
    fear: previous?.fear || 0,
    evidenceIds: [...(previous?.evidenceIds || []), eventId],
    lastReviewedDay: world.day
  });
  if (index < 0) relations.push(relationship);
  else relations[index] = relationship;
  return relationship;
}

export function proposeSocialCommitment(world, input = {}) {
  const evidence = ensureEvidence(world);
  const parties = uniqueKnownIds(world, input.parties || [], 'parties');
  if (parties.length < 2 || parties.some(id => !personById(world, id))) fail('um compromisso requer ao menos duas pessoas.');
  const proposedBy = idKey(input.proposedBy ?? parties[0], 'proposedBy');
  if (!parties.includes(proposedBy)) fail('proposedBy precisa ser uma das partes do compromisso.');
  const object = typeof input.object === 'string' ? input.object.trim() : '';
  if (!object) fail('object deve descrever o que foi prometido.');
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) fail('quantity deve ser finita e positiva.');
  if (!Number.isSafeInteger(input.dueDay) || input.dueDay < world.day) fail('dueDay não pode anteceder a proposta.');
  if (input.resourceReferences !== undefined && !Array.isArray(input.resourceReferences)) fail('resourceReferences deve ser uma lista.');
  const resourceReferences = (input.resourceReferences || []).map(reference => {
    if (!reference || !REFERENCE_COLLECTIONS[reference.kind]) fail('resourceReferences contém um kind inválido.');
    const id = idKey(reference.id, 'resourceReferences.id');
    if (!REFERENCE_COLLECTIONS[reference.kind].some(collection =>
      (world[collection] || []).some(entity => String(entity.id) === id))) fail('resourceReferences aponta para entidade inexistente.');
    return { kind: reference.kind, id };
  });
  if (input.evidenceEventIds !== undefined && !Array.isArray(input.evidenceEventIds)) fail('evidenceEventIds deve ser uma lista.');
  const evidenceEventIds = [...new Set((input.evidenceEventIds || []).map(value => idKey(value, 'evidenceEventIds')))];
  for (const eventId of evidenceEventIds) {
    if (!evidence.facts.some(fact => fact.eventId === eventId)) fail('evidenceEventIds referencia um fato inexistente.');
    for (const partyId of parties) {
      const party = personById(world, partyId);
      if (!(party.socialMemories || []).some(memory => memory.rootEventId === eventId)) {
        fail('cada parte precisa conhecer a evidência do compromisso.');
      }
    }
  }
  if (input.idempotencyKey == null) fail('idempotencyKey é obrigatório para propor um compromisso.');
  const idempotencyKey = idKey(input.idempotencyKey, 'idempotencyKey');
  const data = {
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.commitment,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    day: world.day,
    proposedBy,
    parties,
    object,
    quantity: input.quantity,
    dueDay: input.dueDay,
    status: 'proposed', deliveredQuantity: 0, deliveryEventIds: [], transitionEventIds: [],
    resourceReferences,
    evidenceEventIds
  };
  const fingerprint = cloneJson(data, 'commitment');
  const existing = evidence.commitments.find(item => item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (JSON.stringify(existing.fingerprint) !== JSON.stringify(fingerprint)) fail('a chave do compromisso foi reutilizada com outro conteúdo.');
    return existing.record;
  }
  const openByParty = evidence.commitments.filter(item => !TERMINAL_COMMITMENT_STATUSES.has(item.record?.status)
    && item.record?.parties?.includes(proposedBy)).length;
  if (openByParty >= SOCIAL_OPEN_COMMITMENT_PER_PERSON_LIMIT) fail('a pessoa atingiu o limite de compromissos abertos.');
  const record = freezeRecursively({ ...data, commitmentId: String(world.seed) + ':epoch:' + evidence.worldEpoch
    + ':commitment:' + evidence.nextCommitmentNumber++ });
  evidence.commitments.push({ idempotencyKey, fingerprint, record });
  return record;
}

function commitmentEntry(world, commitmentId) {
  const evidence = ensureEvidence(world);
  const id = idKey(commitmentId, 'commitmentId');
  return evidence.commitments.find(item => item.record?.commitmentId === id) || null;
}

export function getSocialCommitment(world, commitmentId) {
  if (commitmentId == null || !world?.socialEvidence) return null;
  return commitmentEntry(world, commitmentId)?.record || null;
}

function commitmentTransition(world, entry, { status, type, outcome, details = {} }) {
  const current = entry.record;
  const linkedEvidenceIds = [...new Set([...(current.evidenceEventIds || []), ...(current.transitionEventIds || []),
    ...(current.deliveryEventIds || []), ...(details.evidenceEventIds || []), ...(details.transitionEventIds || []),
    ...(details.deliveryEventIds || [])].filter(Boolean).map(String))];
  const witnessIds = current.parties.filter(partyId => personById(world, partyId)?.alive
    && (current.status !== 'proposed' || !['social_commitment_expired', 'social_commitment_cancelled'].includes(type)
      || partyId === current.proposedBy));
  const fact = recordSocialFact(world, {
    idempotencyKey: 'social-commitment:' + current.commitmentId + ':' + type + ':' + world.day + ':' + JSON.stringify(outcome),
    type,
    participantIds: current.parties,
    witnessIds,
    outcome: { commitmentId: current.commitmentId, object: current.object,
      quantity: current.quantity, result: status, ...outcome }
  }, { preserveEventIds: linkedEvidenceIds });
  // A transition fact must remain available until every living party has
  // received it. Pruning after the first memory can evict an unreferenced new
  // fact when the global ledger and both parties' pinned memories are full.
  for (const partyId of witnessIds) {
    rememberSocialFact(world, partyId, fact.eventId, { source: 'direct', deferPrune: true });
  }
  entry.record = freezeRecursively({ ...current, ...details, status, updatedDay: world.day,
    transitionEventIds: [...new Set([...(current.transitionEventIds || []), fact.eventId])],
    lastTransitionEventId: fact.eventId });
  pruneSocialEvidence(world, world.day, [fact.eventId, ...linkedEvidenceIds]);
  return entry.record;
}

export function acceptSocialCommitment(world, accepterId, commitmentId) {
  const entry = commitmentEntry(world, commitmentId);
  if (!entry) fail('o compromisso não existe.');
  const record = entry.record;
  const accepter = idKey(accepterId, 'accepterId');
  if (record.status === 'accepted' && record.acceptedBy === accepter) return record;
  if (record.status !== 'proposed') fail('somente uma proposta aberta pode ser aceita.');
  if (!record.parties.includes(accepter) || accepter === (record.proposedBy || record.parties[0])) {
    fail('a aceitação precisa vir de outra parte da proposta.');
  }
  if (world.day > record.dueDay) fail('a proposta venceu antes da aceitação.');
  return commitmentTransition(world, entry, { status: 'accepted', type: 'social_commitment_accepted',
    outcome: { acceptedBy: accepter }, details: { acceptedBy: accepter, acceptedDay: world.day } });
}

export function rejectSocialCommitment(world, actorId, commitmentId) {
  const entry = commitmentEntry(world, commitmentId);
  if (!entry) fail('o compromisso não existe.');
  const record = entry.record, actor = idKey(actorId, 'actorId');
  if (record.status !== 'proposed') fail('somente uma proposta aberta pode ser recusada.');
  if (!record.parties.includes(actor) || actor === (record.proposedBy || record.parties[0])) {
    fail('a recusa precisa vir de outra parte da proposta.');
  }
  return commitmentTransition(world, entry, { status: 'rejected', type: 'social_commitment_rejected',
    outcome: { rejectedBy: actor }, details: { resolvedDay: world.day, resolvedBy: actor } });
}

export function cancelSocialCommitment(world, actorId, commitmentId) {
  const entry = commitmentEntry(world, commitmentId);
  if (!entry) fail('o compromisso não existe.');
  const record = entry.record, actor = idKey(actorId, 'actorId');
  if (!['proposed', 'accepted'].includes(record.status)) fail('o compromisso já foi resolvido.');
  if (!record.parties.includes(actor)) fail('somente uma parte pode cancelar o compromisso.');
  return commitmentTransition(world, entry, { status: 'cancelled', type: 'social_commitment_cancelled',
    outcome: { cancelledBy: actor, deliveredQuantity: record.deliveredQuantity || 0 },
    details: { resolvedDay: world.day, resolvedBy: actor } });
}

export function fulfillSocialCommitment(world, commitmentId, evidenceEventId) {
  const entry = commitmentEntry(world, commitmentId);
  if (!entry) fail('o compromisso não existe.');
  const record = entry.record, sourceEventId = idKey(evidenceEventId, 'evidenceEventId');
  if (record.deliveryEventIds?.includes(sourceEventId)) return record;
  if (record.status !== 'accepted') fail('uma entrega só pode cumprir um compromisso aceito.');
  if (world.day > record.dueDay) fail('a entrega ocorreu depois do prazo.');
  const evidence = ensureEvidence(world);
  const source = evidence.facts.find(fact => fact.eventId === sourceEventId);
  if (!source || record.parties.some(partyId => !source.participantIds.includes(partyId))) {
    fail('a entrega precisa de um fato conhecido que envolva todas as partes.');
  }
  if (record.parties.some(partyId => !(personById(world, partyId)?.socialMemories || [])
      .some(memory => memory.rootEventId === sourceEventId))) {
    fail('todas as partes precisam conhecer a evidência da entrega.');
  }
  const result = source.outcome?.result;
  const amount = source.outcome?.amount;
  if (record.object === 'food') {
    if (source.type !== 'food_aid_request_resolved' || source.outcome?.commitmentId !== record.commitmentId
        || source.outcome?.resource !== 'food'
        || result !== 'accepted' || !Number.isFinite(amount) || amount <= 0) {
      fail('alimento só pode ser entregue por uma transferência real registrada.');
    }
  } else if (source.outcome?.commitmentId !== record.commitmentId
      || !['completed', 'delivered', 'fulfilled'].includes(result)
      || record.quantity > 0 && (!Number.isFinite(amount) || amount <= 0)) {
    fail('a evidência de entrega não corresponde ao objeto e ao compromisso.');
  }
  const deliveredAmount = Number.isFinite(amount) ? amount : 0;
  if (record.quantity > 0 && deliveredAmount <= 0) fail('a entrega precisa registrar quantidade positiva.');
  const deliveredQuantity = Number(((record.deliveredQuantity || 0) + deliveredAmount).toFixed(4));
  const deliveryEventIds = [...(record.deliveryEventIds || []), sourceEventId];
  const complete = deliveredQuantity + 1e-9 >= record.quantity;
  return commitmentTransition(world, entry, { status: complete ? 'fulfilled' : 'accepted',
    type: complete ? 'social_commitment_fulfilled' : 'social_commitment_delivery',
    outcome: { evidenceEventId: sourceEventId, deliveredAmount, deliveredQuantity },
    details: { deliveredQuantity, deliveryEventIds,
      ...(complete ? { resolvedDay: world.day, resolutionEventId: sourceEventId } : {}) } });
}

export function advanceSocialCommitmentDeadlines(world) {
  if (!world?.socialEvidence?.commitments?.length) return 0;
  const evidence = ensureEvidence(world);
  let resolved = 0;
  for (const entry of evidence.commitments.slice()) {
    const record = entry.record;
    if (!record || world.day <= record.dueDay) continue;
    if (record.status === 'proposed') {
      commitmentTransition(world, entry, { status: 'expired', type: 'social_commitment_expired',
        outcome: { deliveredQuantity: 0 }, details: { resolvedDay: world.day } });
      resolved++;
    } else if (record.status === 'accepted') {
      commitmentTransition(world, entry, { status: 'breached', type: 'social_commitment_breached',
        outcome: { deliveredQuantity: record.deliveredQuantity || 0,
          remainingQuantity: Math.max(0, record.quantity - (record.deliveredQuantity || 0)) },
        details: { resolvedDay: world.day } });
      resolved++;
    }
  }
  return resolved;
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
  const commitmentId = input.commitmentId == null ? null : idKey(input.commitmentId, 'commitmentId');
  const linkedCommitment = commitmentId == null ? null : getSocialCommitment(world, commitmentId);
  if (commitmentId != null && (!linkedCommitment || !linkedCommitment.parties.includes(String(person.id)))) {
    fail('commitmentId precisa apontar para um compromisso de que a pessoa seja parte.');
  }
  const dueDay = input.dueDay ?? world.day + 30;
  if (!Number.isSafeInteger(dueDay) || dueDay < world.day) fail('dueDay da intenção não pode anteceder a criação.');
  const destination = input.destination == null ? null : normalizeIntentionDestination(input.destination);
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
  if (!Array.isArray(blockers) || blockers.some(item => typeof item !== 'string' || !item.trim())) {
    fail('blockers deve conter apenas textos não vazios.');
  }
  const evidenceIds = localEvidenceIds(person, input.evidenceIds || []);
  const endsWhen = typeof input.endsWhen === 'string' ? input.endsWhen.trim() : '';
  if (!endsWhen) fail('endsWhen deve explicar a condição de encerramento.');
  person.socialIntentions ||= [];
  if (person.socialIntentions.filter(item => !TERMINAL_INTENTION_STATUSES.has(item.status)).length >= SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) {
    fail('a pessoa atingiu o limite de intenções ativas.');
  }
  const intention = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.intention,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    dueDay,
    createdDay: world.day,
    updatedDay: world.day,
    intentionId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':intention:' + evidence.nextIntentionNumber++,
    ownerId: String(person.id),
    type,
    priority,
    targetId,
    commitmentId,
    destination,
    steps,
    progress,
    blockers: blockers.map(item => item.trim()),
    evidenceIds,
    endsWhen,
    status: blockers.length ? 'suspended' : 'active', transitionEventIds: []
  });
  person.socialIntentions.push(intention);
  return intention;
}

export function advanceSocialIntention(world, ownerId, intentionId, update = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, ownerId);
  if (!person) fail('a pessoa dona da intenção não existe.');
  const index = (person.socialIntentions || []).findIndex(item => item.intentionId === String(intentionId));
  if (index < 0) fail('a intenção não pertence à pessoa informada.');
  const current = person.socialIntentions[index];
  if (TERMINAL_INTENTION_STATUSES.has(current.status)) fail('uma intenção encerrada não pode avançar.');
  const progress = update.progress ?? current.progress;
  if (!Number.isSafeInteger(progress) || progress < current.progress || progress > current.steps.length) {
    fail('progress deve avançar monotonicamente até o último passo.');
  }
  let blockers = update.blockers === undefined ? current.blockers.slice() : update.blockers;
  if (!Array.isArray(blockers) || blockers.some(item => typeof item !== 'string' || !item.trim())) {
    fail('blockers deve conter textos não vazios.');
  }
  blockers = blockers.map(item => item.trim());
  const status = update.status ?? current.status;
  if (!['active', 'suspended', 'completed', 'abandoned'].includes(status)) fail('status da intenção inválido.');
  if (status === 'active' && update.status === 'active' && update.blockers === undefined) blockers = [];
  if (status === 'suspended' && !blockers.length) fail('uma intenção suspensa precisa registrar o impedimento.');
  if (status === 'active' && blockers.length) fail('uma intenção ativa não pode manter impedimentos não resolvidos.');
  if (status === 'completed' && progress !== current.steps.length) fail('a intenção só termina após o último passo.');
  const commitmentId = update.commitmentId === undefined ? current.commitmentId : update.commitmentId == null
    ? null : idKey(update.commitmentId, 'commitmentId');
  const destination = update.destination === undefined ? current.destination ?? null
    : update.destination == null ? null : normalizeIntentionDestination(update.destination);
  if (commitmentId !== null) {
    const linkedCommitment = getSocialCommitment(world, commitmentId);
    if (!linkedCommitment || !linkedCommitment.parties.includes(String(person.id))) {
      fail('commitmentId precisa apontar para um compromisso de que a pessoa seja parte.');
    }
  }
  if (['completed', 'abandoned'].includes(status) && !(update.terminationReason ?? current.terminationReason)) {
    fail('uma intenção encerrada precisa registrar sua condição de término.');
  }
  const newEvidence = localEvidenceIds(person, update.evidenceIds || []);
  const evidenceIds = [...new Set([...(current.evidenceIds || []), ...newEvidence])];
  const terminationReason = update.terminationReason == null ? current.terminationReason : String(update.terminationReason).trim();
  const changed = progress !== current.progress || status !== current.status
    || JSON.stringify(blockers) !== JSON.stringify(current.blockers)
    || JSON.stringify(evidenceIds) !== JSON.stringify(current.evidenceIds || [])
    || terminationReason !== current.terminationReason
    || JSON.stringify(destination) !== JSON.stringify(current.destination ?? null);
  if (!changed) return current;
  const type = ['completed', 'abandoned'].includes(status) ? 'social_intention_resolved' : 'social_intention_progressed';
  const keyState = JSON.stringify({ progress, status, blockers, evidenceIds, destination, terminationReason });
  const fact = recordSocialFact(world, {
    idempotencyKey: 'social-intention:' + current.intentionId + ':' + world.day + ':' + keyState,
    type, participantIds: [person.id], witnessIds: person.alive ? [person.id] : [],
    outcome: { intentionId: current.intentionId, type: current.type, progress, status, blockers,
      destination, terminationReason: terminationReason ?? null }
  }, { preserveEventIds: evidenceIds });
  if (person.alive) rememberSocialFact(world, person.id, fact.eventId, { source: 'direct', deferPrune: true });
  const next = freezeRecursively({ ...current, schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.intention,
    progress, blockers, evidenceIds, status, updatedDay: world.day, terminationReason,
    commitmentId, destination,
    transitionEventIds: [...new Set([...(current.transitionEventIds || []), fact.eventId])] });
  person.socialIntentions[index] = next;
  pruneSocialEvidence(world, world.day, [fact.eventId, ...evidenceIds]);
  return next;
}

function normalizeIntentionDestination(destination) {
  if (!destination || typeof destination !== 'object'
      || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) {
    fail('destination precisa de coordenadas finitas.');
  }
  return { x: destination.x, y: destination.y };
}

export function physicalIntentionBlockers(person, currentDay) {
  const blockers = [];
  if (Number.isFinite(person?.foodReserve) && person.foodReserve <= 8) blockers.push('critical_hunger');
  if (Number.isFinite(person?.hydration) && person.hydration <= 9) blockers.push('critical_thirst');
  if (Number.isFinite(person?.health) && person.health <= 18) blockers.push('critical_health');
  if (Number.isFinite(person?.energy) && person.energy <= 8) blockers.push('critical_energy');
  if (Number.isFinite(person?.lastAttackedDay) && currentDay - person.lastAttackedDay <= 1) blockers.push('recent_attack');
  return blockers;
}

function cancelIntentionCommitment(world, person, intention) {
  const commitment = getSocialCommitment(world, intention.commitmentId);
  if (commitment && ['proposed', 'accepted'].includes(commitment.status)
      && commitment.parties.includes(String(person.id))) {
    cancelSocialCommitment(world, person.id, commitment.commitmentId);
  }
}

export function maintainSocialIntentions(world, person) {
  if (!person || !Array.isArray(person.socialIntentions)) return 0;
  let changes = 0;
  for (const current of person.socialIntentions.slice()) {
    if (TERMINAL_INTENTION_STATUSES.has(current.status)) continue;
    const dueDay = Number.isSafeInteger(current.dueDay) ? current.dueDay : world.day + 30;
    if (world.day > dueDay) {
      advanceSocialIntention(world, person.id, current.intentionId, { status: 'abandoned',
        blockers: ['deadline_expired'], terminationReason: 'deadline_expired' });
      changes++;
      continue;
    }
    if (!person.alive) {
      cancelIntentionCommitment(world, person, current);
      advanceSocialIntention(world, person.id, current.intentionId, { status: 'abandoned',
        blockers: ['owner_dead'], terminationReason: 'owner_dead' });
      changes++;
      continue;
    }
    if (current.type === 'seek_food_aid' && Number.isFinite(person.foodReserve) && person.foodReserve >= 40) {
      const commitment = getSocialCommitment(world, current.commitmentId);
      if (commitment?.status === 'fulfilled') {
        advanceSocialIntention(world, person.id, current.intentionId, { progress: current.steps.length,
          status: 'completed', blockers: [], terminationReason: 'aid_delivered' });
      } else {
        if (commitment && ['proposed', 'accepted'].includes(commitment.status)) {
          cancelSocialCommitment(world, person.id, commitment.commitmentId);
        }
        advanceSocialIntention(world, person.id, current.intentionId, { status: 'abandoned',
          blockers: ['need_satisfied'], terminationReason: 'need_satisfied' });
      }
      changes++;
      continue;
    }
    if (current.type === 'seek_food_aid' && current.targetId != null) {
      const target = personById(world, current.targetId);
      if (!target?.alive) {
        cancelIntentionCommitment(world, person, current);
        advanceSocialIntention(world, person.id, current.intentionId, { status: 'abandoned',
          blockers: ['target_unavailable'], terminationReason: 'target_unavailable' });
        changes++;
        continue;
      }
      const sighting = (person.perception?.people || []).find(item => String(item.id) === String(target.id) && item.visible);
      const canHelp = sighting?.visibleSignals?.foodSurplus === true;
      if (!sighting || !canHelp) {
        const blocker = sighting ? 'helper_without_visible_surplus' : 'target_not_visible';
        if (current.status !== 'suspended' || !current.blockers.includes(blocker)) {
          const physical = physicalIntentionBlockers(person, world.day);
          advanceSocialIntention(world, person.id, current.intentionId, { status: 'suspended',
            blockers: [...new Set([...(current.blockers || []).filter(value => !['target_not_visible', 'helper_without_visible_surplus', 'aid_temporarily_unavailable'].includes(value)), blocker, ...physical])] });
          changes++;
        }
        continue;
      }
      if (current.status === 'suspended' && (current.blockers.includes('target_not_visible')
          || current.blockers.includes('helper_without_visible_surplus')
          || current.blockers.includes('aid_temporarily_unavailable'))) {
        const blockers = current.blockers.filter(value => !['target_not_visible', 'helper_without_visible_surplus', 'aid_temporarily_unavailable'].includes(value));
        const emergency = physicalIntentionBlockers(person, world.day);
        if (emergency.length) {
          advanceSocialIntention(world, person.id, current.intentionId, { status: 'suspended', blockers: [...new Set([...blockers, ...emergency])] });
        } else if (!blockers.length) advanceSocialIntention(world, person.id, current.intentionId, { status: 'active', blockers: [] });
        else advanceSocialIntention(world, person.id, current.intentionId, { status: 'suspended', blockers });
        changes++;
        continue;
      }
    }
    const emergency = physicalIntentionBlockers(person, world.day);
    if (emergency.length && current.status === 'active') {
      advanceSocialIntention(world, person.id, current.intentionId, { status: 'suspended',
        blockers: [...new Set([...(current.blockers || []), ...emergency])] });
      changes++;
    } else if (!emergency.length && current.status === 'suspended') {
      const remaining = (current.blockers || []).filter(blocker => !PHYSICAL_INTENTION_BLOCKERS.has(blocker));
      if (!remaining.length) {
        advanceSocialIntention(world, person.id, current.intentionId, { status: 'active', blockers: [] });
        changes++;
      } else if (remaining.length !== current.blockers.length) {
        advanceSocialIntention(world, person.id, current.intentionId, { status: 'suspended', blockers: remaining });
        changes++;
      }
    }
  }
  return changes;
}

export function abandonSocialIntentionsForPerson(world, person, reason = 'owner_dead') {
  if (!person || !Array.isArray(person.socialIntentions)) return 0;
  let abandoned = 0;
  for (const current of person.socialIntentions.slice()) {
    if (TERMINAL_INTENTION_STATUSES.has(current.status)) continue;
    cancelIntentionCommitment(world, person, current);
    advanceSocialIntention(world, person.id, current.intentionId, { status: 'abandoned',
      blockers: [reason], terminationReason: reason });
    abandoned++;
  }
  return abandoned;
}

export function pruneSocialEvidence(world, currentDay = world.day, preserveEventIds = []) {
  const evidence = ensureEvidence(world);
  if (!Number.isSafeInteger(currentDay) || currentDay < world.day) fail('currentDay não pode anteceder o mundo.');
  if (!Array.isArray(preserveEventIds)) fail('preserveEventIds deve ser uma lista.');
  const pendingEvents = new Set(preserveEventIds.map(value => String(value)));
  const cutoff = currentDay - SOCIAL_FACT_RETENTION_DAYS;
  const protectedEventsByPerson = new Map();
  const protect = (person, ids) => {
    if (!person || !Array.isArray(ids)) return;
    const protectedIds = new Set([...(protectedEventsByPerson.get(String(person.id)) || []), ...pendingEvents]);
    for (const id of ids) protectedIds.add(id);
    protectedEventsByPerson.set(String(person.id), protectedIds);
  };
  for (const person of world.people || []) {
    for (const belief of person.socialBeliefs || []) {
      protect(person, [...(belief.supportingEventIds || []), ...(belief.opposingEventIds || [])]);
    }
    for (const relation of person.socialRelations || []) protect(person, relation.evidenceIds || []);
    for (const intention of person.socialIntentions || []) {
      if (!TERMINAL_INTENTION_STATUSES.has(intention.status)) protect(person, intention.evidenceIds || []);
    }
  }
  const commitmentEventIds = new Set();
  for (const item of evidence.commitments || []) {
    const commitment = item.record;
    if (!commitment) continue;
    const isOpen = !TERMINAL_COMMITMENT_STATUSES.has(commitment.status);
    const hasRecentTransition = Number.isSafeInteger(commitment.updatedDay) && commitment.updatedDay >= cutoff;
    if (!isOpen && !hasRecentTransition) continue;
    const eventIds = [...(commitment.evidenceEventIds || []), ...(commitment.transitionEventIds || []),
      ...(commitment.deliveryEventIds || []), commitment.resolutionEventId].filter(Boolean).map(String);
    for (const eventId of eventIds) commitmentEventIds.add(eventId);
    for (const partyId of commitment.parties || []) {
      const party = personById(world, partyId);
      protect(party, eventIds);
    }
  }
  for (const person of world.people || []) {
    if (!Array.isArray(person.socialMemories)) continue;
    const protectedIds = protectedEventsByPerson.get(String(person.id)) || new Set();
    const protectedMemories = person.socialMemories.filter(memory => protectedIds.has(memory.rootEventId));
    const recentMemories = person.socialMemories
      .filter(memory => !protectedIds.has(memory.rootEventId) && memory.acquiredDay >= cutoff)
      .sort((a, b) => b.acquiredDay - a.acquiredDay || b.sequence - a.sequence || b.memoryId.localeCompare(a.memoryId));
    // The 32-record budget applies to consolidatable episodes. Evidence still
    // cited by a belief, active intention, relationship or open commitment is pinned.
    const unpinnedCapacity = Math.max(0, SOCIAL_MEMORY_PER_PERSON_LIMIT - protectedMemories.length);
    person.socialMemories = [...protectedMemories, ...recentMemories.slice(0, unpinnedCapacity)]
      .sort((a, b) => a.acquiredDay - b.acquiredDay || a.sequence - b.sequence || a.memoryId.localeCompare(b.memoryId));
  }
  const referenced = new Set((world.people || []).flatMap(person =>
    (person.socialMemories || []).map(memory => memory.rootEventId)));
  for (const eventId of commitmentEventIds) referenced.add(eventId);
  evidence.facts = evidence.facts.filter(fact => fact.day >= cutoff || referenced.has(fact.eventId)
    || pendingEvents.has(fact.eventId));
  evidence.facts.sort((a, b) => a.day - b.day || a.sequence - b.sequence);
  while (evidence.facts.length > SOCIAL_FACT_LIMIT) {
    const expendableIndex = evidence.facts.findIndex(fact => !referenced.has(fact.eventId)
      && !pendingEvents.has(fact.eventId));
    if (expendableIndex < 0) break;
    const [expired] = evidence.facts.splice(expendableIndex, 1);
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
